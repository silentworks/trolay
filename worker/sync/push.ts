import {
	SYNC_FIELDS,
	SYNC_TABLES,
	type PushedChange,
	type PushResult,
	type SyncTable
} from '../../src/lib/sync/schema.ts';
import type { Env } from '../env.ts';
import { BadRequest, error, json, readJson } from '../http.ts';
import { sessionUser } from '../auth/session.ts';
import { beats, column, encode, validValue } from './records.ts';

const MAX_CHANGES = 100;
const MAX_PUSH_BYTES = 512 * 1024;
/** A change dated far ahead would beat every later edit, so clocks are only trusted so far. */
const MAX_CLOCK_AHEAD = 24 * 60 * 60 * 1000;
const ID = /^[\w-]{1,64}$/;

type Row = Record<string, unknown>;
type Times = Record<string, { value: unknown; at: number }>;

/** The parsed change, or undefined when it is not one the app could have sent. */
function parse(raw: unknown, now: number): PushedChange | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const { table, id, fields } = raw as Record<string, unknown>;
	if (!SYNC_TABLES.includes(table as SyncTable) || typeof id !== 'string' || !ID.test(id)) {
		return undefined;
	}
	if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return undefined;
	const specs = SYNC_FIELDS[table as SyncTable];
	const entries = Object.entries(fields);
	if (!entries.length || entries.length > Object.keys(specs).length) return undefined;
	for (const [field, change] of entries) {
		const spec = specs[field];
		if (!spec || typeof change !== 'object' || change === null) return undefined;
		const { value, at } = change as { value: unknown; at: unknown };
		if (
			!Number.isSafeInteger(at) ||
			(at as number) <= 0 ||
			(at as number) > now + MAX_CLOCK_AHEAD
		) {
			return undefined;
		}
		if (!validValue(spec, value)) return undefined;
	}
	return { table: table as SyncTable, id, fields: fields as PushedChange['fields'] };
}

const isMember = async (env: Env, tripId: string, userId: string) =>
	(await env.DB.prepare(
		'SELECT 1 AS ok FROM trip_members WHERE trip_id = ? AND user_id = ? AND deleted_at IS NULL'
	)
		.bind(tripId, userId)
		.first()) !== null;

/** Whether this user may write this record, given the row it will end up as. */
async function allowed(
	env: Env,
	userId: string,
	table: SyncTable,
	existing: Row | null,
	resulting: Row
): Promise<PushResult['reason'] | undefined> {
	if (table === 'stores') {
		return existing && existing.owner_id !== userId ? 'forbidden' : undefined;
	}
	if (table === 'trips') {
		if (existing && !(await isMember(env, existing.id as string, userId))) return 'forbidden';
		const store = await env.DB.prepare('SELECT owner_id FROM stores WHERE id = ?')
			.bind(resulting.store_id)
			.first<{ owner_id: string }>();
		if (!store) return 'missing_parent';
		return store.owner_id === userId ? undefined : 'forbidden';
	}
	const trip = await env.DB.prepare('SELECT id FROM trips WHERE id = ?')
		.bind(resulting.trip_id)
		.first();
	if (!trip) return 'missing_parent';
	return (await isMember(env, resulting.trip_id as string, userId)) ? undefined : 'forbidden';
}

/**
 * Merges one change into its row, field by field. Returns the outcome. When two devices write
 * the same row at once the write that lost the race is retried against the new state.
 */
async function applyChange(env: Env, userId: string, change: PushedChange): Promise<PushResult> {
	const { table, id } = change;
	const specs = SYNC_FIELDS[table];
	const result = (status: PushResult['status'], reason?: PushResult['reason']): PushResult => ({
		table,
		id,
		status,
		reason
	});

	for (let attempt = 0; attempt < 4; attempt++) {
		const existing = await env.DB.prepare(`SELECT * FROM ${table} WHERE id = ?`)
			.bind(id)
			.first<Row>();
		const known: Times = existing
			? Object.fromEntries(
					Object.entries(JSON.parse(existing.field_times as string) as Record<string, number>).map(
						([field, at]) => [field, { at, value: existing[column(field)] }]
					)
				)
			: {};

		// What the row holds after the winning fields are applied.
		const accepted: string[] = [];
		const resulting: Row = { ...existing };
		const times: Record<string, number> = Object.fromEntries(
			Object.entries(known).map(([field, { at }]) => [field, at])
		);
		for (const [field, incoming] of Object.entries(change.fields)) {
			// The row's own value is already in its stored form, as the incoming one is made to be.
			const current = known[field];
			if (beats({ value: encode(specs[field], incoming.value), at: incoming.at }, current)) {
				accepted.push(field);
				resulting[column(field)] = encode(specs[field], incoming.value);
				times[field] = incoming.at;
			}
		}
		if (!existing) {
			const missing = Object.entries(specs).filter(
				([field, spec]) => spec.required && resulting[column(field)] == null
			);
			if (missing.length) return result('rejected', 'invalid');
		}
		const reason = await allowed(env, userId, table, existing, resulting);
		if (reason) return result('rejected', reason);
		// Nothing here is newer than what the row holds. Asked after permission, so another
		// person's record is refused the same whether or not the change would have won.
		if (existing && !accepted.length) return result('ok');

		const now = Date.now();
		const stamp = Math.max(...accepted.map((field) => change.fields[field].at));
		const fieldTimes = JSON.stringify(times);
		const sets = accepted.map((field) => `${column(field)} = ?`);
		const values = accepted.map((field) => encode(specs[field], change.fields[field].value));

		const statements: D1PreparedStatement[] = [];
		if (existing) {
			statements.push(
				env.DB.prepare(
					`UPDATE ${table} SET ${sets.join(', ')}, field_times = ?, updated_at = MAX(updated_at, ?), updated_by = ?
					 WHERE id = ? AND field_times = ?`
				).bind(...values, fieldTimes, stamp, userId, id, existing.field_times)
			);
		} else {
			const owner = table === 'items' ? [] : ['owner_id'];
			const columns = [...owner, ...accepted.map(column)];
			statements.push(
				env.DB.prepare(
					`INSERT INTO ${table} (id, ${columns.join(', ')}, field_times, updated_at, updated_by)
					 VALUES (?, ${columns.map(() => '?').join(', ')}, ?, ?, ?)`
				).bind(id, ...(table === 'items' ? [] : [userId]), ...values, fieldTimes, stamp, userId)
			);
			if (table === 'trips') {
				// The owner is a member like anyone else, so reading a trip is one membership check.
				statements.push(
					env.DB.prepare(
						`INSERT INTO trip_members (trip_id, user_id, role, created_at, updated_at, updated_by)
						 VALUES (?, ?, 'owner', ?, ?, ?)`
					).bind(id, userId, now, now, userId)
				);
			}
		}
		// Record the change in the order accepted, only if this write is the one that landed.
		statements.push(
			env.DB.prepare(
				`DELETE FROM changes WHERE table_name = ? AND record_id = ?
				 AND EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND field_times = ?)`
			).bind(table, id, id, fieldTimes),
			env.DB.prepare(
				`INSERT INTO changes (table_name, record_id)
				 SELECT ?, ? WHERE EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND field_times = ?)`
			).bind(table, id, id, fieldTimes)
		);
		try {
			const outcome = await env.DB.batch(statements);
			if (!existing || outcome[0].meta.changes === 1) return result('ok');
		} catch (cause) {
			// Another device created this record a moment ago: merge into it on the next pass.
			if (existing) throw cause;
		}
	}
	throw new Error(`Could not settle ${table}/${id}: it kept changing`);
}

/** Merges the app's changes into the server's records. */
export async function push(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	const { changes } = await readJson(request, MAX_PUSH_BYTES);
	if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new BadRequest('bad_changes');

	const now = Date.now();
	const results: PushResult[] = [];
	for (const raw of changes) {
		const change = parse(raw, now);
		if (!change) {
			const { table, id } = (raw ?? {}) as Record<string, unknown>;
			results.push({
				table: table as SyncTable,
				id: String(id),
				status: 'rejected',
				reason: 'invalid'
			});
			continue;
		}
		results.push(await applyChange(env, userId, change));
	}
	return json({ results });
}
