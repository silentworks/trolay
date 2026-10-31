import {
	SYNC_FIELDS,
	type LeftTrip,
	type PullResponse,
	type PulledRecord,
	type SyncTable
} from '../../src/lib/sync/schema.ts';
import { error, json } from '../http.ts';
import type { Env } from '../env.ts';
import { sessionUser } from '../auth/session.ts';
import { column, toRecord } from './records.ts';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const columns = (table: SyncTable, alias: string) =>
	['id', 'updated_at', ...Object.keys(SYNC_FIELDS[table]).map(column)]
		.map((name) => `${alias}.${name}`)
		.join(', ');

// What a user may read: their own stores, the trips (and those trips' items) they are a member
// of, and the stores of those trips. A partner sees the one trip they were invited to and the
// store it is at, and nothing else of the owner's. Each query takes the records that changed after `since`, oldest change first.
const QUERIES: Record<SyncTable, string> = {
	stores: `SELECT ${columns('stores', 's')}, c.seq FROM changes c
		JOIN stores s ON s.id = c.record_id
		WHERE c.table_name = 'stores' AND c.seq > ?
		  AND (s.owner_id = ? OR EXISTS (
		    SELECT 1 FROM trips t
		    JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? AND m.deleted_at IS NULL
		    WHERE t.store_id = s.id AND t.deleted_at IS NULL))
		ORDER BY c.seq LIMIT ?`,
	trips: `SELECT ${columns('trips', 't')}, c.seq FROM changes c
		JOIN trips t ON t.id = c.record_id
		JOIN trip_members m ON m.trip_id = t.id AND m.user_id = ? AND m.deleted_at IS NULL
		WHERE c.table_name = 'trips' AND c.seq > ?
		ORDER BY c.seq LIMIT ?`,
	items: `SELECT ${columns('items', 'i')}, c.seq FROM changes c
		JOIN items i ON i.id = c.record_id
		JOIN trip_members m ON m.trip_id = i.trip_id AND m.user_id = ? AND m.deleted_at IS NULL
		WHERE c.table_name = 'items' AND c.seq > ?
		ORDER BY c.seq LIMIT ?`
};

// The trips this user was taken off (or left): their membership row was deleted. The phone is
// told so it can let go of an open trip it holds a copy of.
const LEFT = `SELECT t.id AS trip_id, t.store_id, c.seq FROM changes c
	JOIN trip_members m ON c.record_id = m.trip_id || ':' || m.user_id
	JOIN trips t ON t.id = m.trip_id
	WHERE c.table_name = 'trip_members' AND c.seq > ? AND m.user_id = ? AND m.deleted_at IS NOT NULL
	ORDER BY c.seq LIMIT ?`;

/** What changed after `since`, in the order the server accepted it, a page at a time. */
export async function pull(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	const params = new URL(request.url).searchParams;
	const since = Number(params.get('since') ?? 0);
	const limit = Math.min(Number(params.get('limit') ?? DEFAULT_LIMIT), MAX_LIMIT);
	if (!Number.isSafeInteger(since) || since < 0 || !Number.isSafeInteger(limit) || limit < 1) {
		return error(400, 'bad_request');
	}

	// A page is the first `limit` changes across all three tables, so each query asks for that
	// many and the results are merged by seq.
	const found = await Promise.all(
		(Object.keys(QUERIES) as SyncTable[]).map(async (table) => {
			// stores binds (since, user, user); the other two bind (user, since): see the queries.
			const binds =
				table === 'stores' ? [since, userId, userId, limit + 1] : [userId, since, limit + 1];
			const { results } = await env.DB.prepare(QUERIES[table])
				.bind(...binds)
				.all<Record<string, unknown>>();
			return results.map((row) => ({
				seq: row.seq as number,
				record: toRecord(table, row) as PulledRecord | undefined,
				left: undefined as LeftTrip | undefined
			}));
		})
	);
	const goneRows = (
		await env.DB.prepare(LEFT)
			.bind(since, userId, limit + 1)
			.all<{ trip_id: string; store_id: string; seq: number }>()
	).results.map((row) => ({
		seq: row.seq,
		record: undefined as PulledRecord | undefined,
		left: { tripId: row.trip_id, storeId: row.store_id } as LeftTrip | undefined
	}));
	const merged = [...found.flat(), ...goneRows].sort((a, b) => a.seq - b.seq);
	const page = merged.slice(0, limit);
	const records = page.flatMap(({ record }) => (record ? [record] : []));
	const left = page.flatMap((entry) => (entry.left ? [entry.left] : []));
	const body: PullResponse = {
		records,
		...(left.length ? { left } : {}),
		cursor: page.length ? page[page.length - 1].seq : since,
		more: merged.length > limit
	};
	return json(body);
}
