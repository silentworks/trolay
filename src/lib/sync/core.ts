import type { TrolleyDB } from '#lib/data/db.ts';
import { letGoOfTrip } from './letgo.ts';
import { markRemote, type Pending } from './pending.ts';
import {
	FIELD_DEFAULTS,
	PARENTS,
	SYNC_FIELDS,
	SYNC_TABLES,
	type PullResponse,
	type PushedChange,
	type PushResult,
	type SyncTable
} from './schema.ts';

export type Fetcher = (path: string, init?: RequestInit) => Promise<Response>;

/** The server says nobody is signed in: sync stops until they sign in again. */
export class SignedOutError extends Error {}

type Record_ = Record<string, unknown> & Pending & { id: string; updatedAt: number };

/** What a push sent for one record, so only that is cleared once the server has it. */
interface Sent {
	change: PushedChange;
	times: Record<string, number>;
}

const BATCH = 50;
const CURSOR = 'cursor';
/** Records the server refused as another account's, as `table/id`. */
const REFUSED = 'refused';

/**
 * Syncing without a screen: send what changed here, fetch what changed elsewhere. Settling
 * conflicts is the server's job (newest change to each field wins); this side only has to be
 * careful never to lose a change it has not yet sent, and never to send one twice by mistake.
 */
export class SyncCore {
	constructor(
		private readonly db: TrolleyDB,
		private readonly send: Fetcher = (path, init) => fetch(path, init),
		/** Told the names of the stores of open trips that this account was taken off. */
		private readonly onLetGo: (stores: string[]) => void = () => {}
	) {}

	private table(name: SyncTable) {
		return this.db.table<Record_, string>(name);
	}

	/** How many records have changes waiting to be sent. */
	async pendingCount(): Promise<number> {
		const counts = await Promise.all(
			SYNC_TABLES.map((name) => this.table(name).where('pendingAt').above(0).count())
		);
		return counts.reduce((a, b) => a + b, 0);
	}

	private async request<T>(path: string, body?: unknown): Promise<T> {
		const response = await this.send(path, {
			method: body === undefined ? 'GET' : 'POST',
			headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		if (response.status === 401) throw new SignedOutError();
		if (!response.ok) throw new Error(`Sync failed (${response.status}).`);
		// Where there is no API the app's own page comes back instead, and this throws.
		return (await response.json()) as T;
	}

	/**
	 * Tells the core whose account this phone is syncing with. The first time, nothing changes
	 * (what is on the phone is already waiting to be sent). If it is a different account from
	 * before, the position in the server's history is that other account's, so it starts again
	 * from the beginning, and everything on the phone is sent: signing in merges, never replaces.
	 */
	async adopt(userId: string): Promise<void> {
		const known = (await this.db.syncState.get('userId'))?.value;
		if (known === userId) return;
		await this.db.syncState.bulkPut([
			{ key: 'userId', value: userId },
			{ key: CURSOR, value: 0 },
			// What the last account was refused says nothing about this one.
			{ key: REFUSED, value: [] }
		]);
		if (known !== undefined) await this.markAllPending();
	}

	/** Queues every record on the phone to be sent, as if it had just been made. */
	private async markAllPending(): Promise<void> {
		await this.db.transaction('rw', this.db.stores, this.db.trips, this.db.items, async (tx) => {
			markRemote(tx);
			for (const name of SYNC_TABLES) {
				await this.table(name)
					.toCollection()
					.modify((record) => {
						const at = record.updatedAt;
						record.pending = Object.fromEntries(
							Object.keys(SYNC_FIELDS[name])
								.filter((field) => record[field] !== undefined)
								.map((field) => [field, at])
						);
						record.pendingAt = at;
					});
			}
		});
	}

	/** Sends everything waiting, then fetches everything new. */
	async run(): Promise<void> {
		await this.push();
		await this.pull();
	}

	// ---- sending --------------------------------------------------------------------------

	/** The next records with something to send, parents before children, skipping `skip`. */
	private async collect(skip: Set<string>): Promise<Sent[]> {
		const batch: Sent[] = [];
		for (const name of SYNC_TABLES) {
			if (batch.length >= BATCH) break;
			const records = await this.table(name)
				.where('pendingAt')
				.above(0)
				.filter((record) => !skip.has(`${name}/${record.id}`))
				.limit(BATCH - batch.length)
				.toArray();
			for (const record of records) {
				const times: Record<string, number> = {};
				const fields: PushedChange['fields'] = {};
				for (const [field, at] of Object.entries(record.pending ?? {})) {
					if (!(field in SYNC_FIELDS[name])) continue;
					times[field] = at;
					fields[field] = { value: record[field] ?? this.defaultFor(name, record, field), at };
				}
				if (Object.keys(fields).length) {
					// A record older than a required field lacks it, and the server would refuse the
					// record for that; send the default too, as old as the record so that any real
					// value the server has wins.
					for (const field of Object.keys(FIELD_DEFAULTS[name])) {
						if (record[field] == null && !(field in fields))
							fields[field] = { value: this.defaultFor(name, record, field), at: record.updatedAt };
					}
				}
				if (Object.keys(fields).length)
					batch.push({ change: { table: name, id: record.id, fields }, times });
			}
		}
		return batch;
	}

	/** What a record lacking a required field is sent for it: see FIELD_DEFAULTS; null if unknown. */
	private defaultFor(name: SyncTable, record: Record_, field: string): unknown {
		const fill = FIELD_DEFAULTS[name][field];
		return fill === 'updatedAt' ? record.updatedAt : (fill ?? null);
	}

	async push(): Promise<void> {
		// Records the server could not take yet (its store or trip has not arrived): left for
		// the next run, and not asked about again in this one.
		const waiting = new Set<string>();
		// Parents sent again because a child could not find them, once each per run.
		const resent = new Set<string>();
		for (;;) {
			const batch = await this.collect(waiting);
			if (!batch.length) return;
			const { results } = await this.request<{ results: PushResult[] }>('/api/sync/push', {
				changes: batch.map(({ change }) => change)
			});
			let settled = 0;
			const refused = new Set(await this.refusedKeys());
			await this.db.transaction('rw', this.db.stores, this.db.trips, this.db.items, async (tx) => {
				markRemote(tx);
				for (const [index, sent] of batch.entries()) {
					const result = results[index];
					const key = `${sent.change.table}/${sent.change.id}`;
					if (result?.status === 'rejected' && result.reason === 'missing_parent') {
						waiting.add(key);
						// With its parent on the way again, the child is worth another try this run.
						if (await this.resendParent(sent.change, resent)) {
							waiting.delete(key);
							settled++;
						}
						continue;
					}
					if (result?.status === 'rejected') console.warn('Sync refused a change', result);
					// A record that belongs to another account is refused for good; remember it, so
					// the app can say why it will never reach this account. One the server takes later
					// (it was refused for another reason) is forgotten.
					if (result?.status === 'rejected' && result.reason === 'forbidden') refused.add(key);
					else if (result?.status === 'ok') refused.delete(key);
					await this.clearSent(sent);
					settled++;
				}
			});
			await this.db.syncState.put({ key: REFUSED, value: [...refused] });
			if (!settled) return;
		}
	}

	/**
	 * A child the server cannot place is waiting for its parent. Usually the parent is still to be
	 * sent and that settles it; but if the parent was sent before and lost (refused, say), nothing
	 * will send it again, and the child would wait for ever. So the parent is queued afresh, once
	 * per run. Returns whether it was.
	 */
	private async resendParent({ table, id }: PushedChange, resent: Set<string>): Promise<boolean> {
		const link = PARENTS[table];
		if (!link) return false;
		const parentId = (await this.table(table).get(id))?.[link.field];
		if (typeof parentId !== 'string') return false;
		const key = `${link.table}/${parentId}`;
		const parent = await this.table(link.table).get(parentId);
		if (!parent || parent.pendingAt || resent.has(key)) return false;
		resent.add(key);
		await this.queueAll(link.table, parent);
		return true;
	}

	/** Queues every field of one record to be sent. */
	private async queueAll(name: SyncTable, record: Record_): Promise<void> {
		const at = record.updatedAt;
		await this.table(name).update(record.id, {
			pending: Object.fromEntries(
				Object.keys(SYNC_FIELDS[name])
					.filter((field) => record[field] !== undefined)
					.map((field) => [field, at])
			),
			pendingAt: at
		});
	}

	private async refusedKeys(): Promise<string[]> {
		return ((await this.db.syncState.get(REFUSED))?.value as string[] | undefined) ?? [];
	}

	/**
	 * Whether the server refused this record because it belongs to another account: it is on this
	 * phone (from before this account signed in) and can never reach this account.
	 */
	async wasRefused(table: SyncTable, id: string): Promise<boolean> {
		return (await this.refusedKeys()).includes(`${table}/${id}`);
	}

	/** Takes the fields that were sent off the record's pending list, unless changed again since. */
	private async clearSent({ change, times }: Sent): Promise<void> {
		const table = this.table(change.table);
		const record = await table.get(change.id);
		if (!record?.pending) return;
		const pending = { ...record.pending };
		for (const [field, at] of Object.entries(times))
			if (pending[field] === at) delete pending[field];
		const left = Object.values(pending);
		await table.update(change.id, {
			pending: left.length ? pending : undefined,
			pendingAt: left.length ? Math.max(...left) : undefined
		});
	}

	// ---- receiving ------------------------------------------------------------------------

	async pull(): Promise<void> {
		let since = ((await this.db.syncState.get(CURSOR))?.value as number | undefined) ?? 0;
		for (;;) {
			const page = await this.request<PullResponse>(`/api/sync/pull?since=${since}`);
			await this.apply(page.records);
			const dropped: string[] = [];
			for (const trip of page.left ?? []) {
				const store = await letGoOfTrip(this.db, trip);
				if (store !== undefined) dropped.push(store);
			}
			if (dropped.length) this.onLetGo(dropped);
			since = page.cursor;
			await this.db.syncState.put({ key: CURSOR, value: since });
			if (!page.more) return;
		}
	}

	/**
	 * Writes the server's records here. For each field the server's value is taken, except where
	 * this phone has an edit it has not sent yet: that is kept, and the server settles it when it
	 * is sent (the newer change wins, and the next pull brings the winner back).
	 */
	private async apply(records: PullResponse['records']): Promise<void> {
		await this.db.transaction('rw', this.db.stores, this.db.trips, this.db.items, async (tx) => {
			markRemote(tx);
			for (const remote of records) {
				const table = this.table(remote.table);
				const local = await table.get(remote.id);
				const next: Record_ = local ?? { id: remote.id, updatedAt: remote.updatedAt };
				for (const [field, value] of Object.entries(remote.fields)) {
					if (local?.pending && field in local.pending) continue;
					if (value === null) delete next[field];
					else next[field] = value;
				}
				next.updatedAt = local?.pendingAt
					? Math.max(local.updatedAt, remote.updatedAt)
					: remote.updatedAt;
				await table.put(next);
			}
		});
	}
}
