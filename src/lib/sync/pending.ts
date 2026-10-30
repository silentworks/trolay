import type Dexie from 'dexie';
import { SYNC_FIELDS, SYNC_TABLES } from './schema.ts';

// Local changes waiting to be sent live on the record itself, as `pending`: each changed field
// and the time it changed. They are written in the same IndexedDB transaction as the change, so
// a change and its entry in the "outbox" can neither be separated nor lost, and the outbox
// needs no table of its own. `pendingAt` (the newest of them) is indexed, so finding every
// record with something to send is one query.

export interface Pending {
	pending?: Record<string, number>;
	pendingAt?: number;
}

const REMOTE = 'trolayRemote';

/** Marks the running transaction as applying the server's data, which is not a local change. */
export function markRemote(transaction: unknown): void {
	(transaction as Record<string, unknown>)[REMOTE] = true;
}

const isRemote = (transaction: unknown) =>
	(transaction as Record<string, unknown> | undefined)?.[REMOTE] === true;

/** Makes every write to a synced table record what changed, unless it is the server's data. */
export function installPendingHooks(db: Dexie): void {
	for (const name of SYNC_TABLES) {
		const fields = SYNC_FIELDS[name];
		const table = db.table(name);

		table.hook('creating', (_key, obj: Record<string, unknown> & Pending, transaction) => {
			if (isRemote(transaction)) return;
			const at = typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now();
			obj.pending = Object.fromEntries(
				Object.keys(fields)
					.filter((field) => obj[field] !== undefined)
					.map((field) => [field, at])
			);
			obj.pendingAt = at;
		});

		table.hook('updating', (modifications, _key, obj: Pending, transaction) => {
			if (isRemote(transaction)) return;
			const changes = modifications as Record<string, unknown>;
			const changed = Object.keys(changes).filter((field) => field in fields);
			if (!changed.length) return;
			const at = typeof changes.updatedAt === 'number' ? changes.updatedAt : Date.now();
			return {
				pending: { ...obj.pending, ...Object.fromEntries(changed.map((field) => [field, at])) },
				pendingAt: at
			};
		});
	}
}
