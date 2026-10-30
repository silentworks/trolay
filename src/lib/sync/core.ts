import type { TrolleyDB } from '#lib/data/db.ts';
import { markRemote, type Pending } from './pending.ts';
import {
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

/**
 * Syncing without a screen: send what changed here, fetch what changed elsewhere. Settling
 * conflicts is the server's job (newest change to each field wins); this side only has to be
 * careful never to lose a change it has not yet sent, and never to send one twice by mistake.
 */
export class SyncCore {
	constructor(
		private readonly db: TrolleyDB,
		private readonly send: Fetcher = (path, init) => fetch(path, init)
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
			{ key: CURSOR, value: 0 }
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
					fields[field] = { value: record[field] ?? null, at };
				}
				if (Object.keys(fields).length)
					batch.push({ change: { table: name, id: record.id, fields }, times });
			}
		}
		return batch;
	}

	async push(): Promise<void> {
		// Records the server could not take yet (its store or trip has not arrived): left for
		// the next run, and not asked about again in this one.
		const waiting = new Set<string>();
		for (;;) {
			const batch = await this.collect(waiting);
			if (!batch.length) return;
			const { results } = await this.request<{ results: PushResult[] }>('/api/sync/push', {
				changes: batch.map(({ change }) => change)
			});
			let settled = 0;
			await this.db.transaction('rw', this.db.stores, this.db.trips, this.db.items, async (tx) => {
				markRemote(tx);
				for (const [index, sent] of batch.entries()) {
					const result = results[index];
					const key = `${sent.change.table}/${sent.change.id}`;
					if (result?.status === 'rejected' && result.reason === 'missing_parent') {
						waiting.add(key);
						continue;
					}
					if (result?.status === 'rejected') console.warn('Sync refused a change', result);
					await this.clearSent(sent);
					settled++;
				}
			});
			if (!settled) return;
		}
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
