import { handleApi } from '../../../worker/api.ts';
import { createTestEnv, ORIGIN, testClient, type TestEnv } from '../../../worker/testing.ts';
import { TrolleyDB } from '#lib/data/db.ts';
import { SyncCore } from './core.ts';
import { SYNC_FIELDS, SYNC_TABLES, type SyncTable } from './schema.ts';

// A harness for testing sync the way it goes wrong: several phones, each with its own
// IndexedDB, that go offline, edit, and come back, against the real Worker and a real local D1,
// all in this process, with no browser and no network. Time is a virtual clock, so every edit
// has a known moment and a test can say exactly which one should win.

/** Time for the phones' edits. Each tick is a later moment than the last, on any phone. */
export class Clock {
	constructor(private now = 1_790_000_000_000) {}
	tick(): number {
		return ++this.now;
	}
}

export interface Account {
	cookie: string;
	userId: string;
}

export class SimulatedServer {
	private constructor(readonly test: TestEnv) {}

	static async start(): Promise<SimulatedServer> {
		return new SimulatedServer(await createTestEnv());
	}

	/** A new account, signed in. Everything one account syncs is private to it. */
	async account(): Promise<Account> {
		const { done } = await testClient(this.test.env).register();
		return { cookie: done.cookie!, userId: done.body.user.id };
	}

	dispose(): Promise<void> {
		return this.test.dispose();
	}
}

type Table = SyncTable;
type Fields = Record<string, unknown>;
/** Every synced record on a phone by "table/id", with just the synced fields. */
export type State = Record<string, Fields>;

let phones = 0;

export class SimulatedPhone {
	online = true;
	readonly db: TrolleyDB;
	readonly core: SyncCore;

	constructor(
		readonly name: string,
		private readonly server: SimulatedServer,
		private readonly account: Account,
		readonly clock: Clock
	) {
		this.db = new TrolleyDB(`phone-${name}-${++phones}`);
		this.core = new SyncCore(this.db, (path, init) => this.fetch(path, init));
	}

	/** Without a signal a request fails the way a browser's does, with a TypeError. */
	private fetch(path: string, init: RequestInit = {}): Promise<Response> {
		if (!this.online) return Promise.reject(new TypeError('Failed to fetch'));
		return handleApi(
			new Request(ORIGIN + path, {
				...init,
				headers: { ...init.headers, Cookie: this.account.cookie, Origin: ORIGIN }
			}),
			this.server.test.env
		);
	}

	goOffline(): this {
		this.online = false;
		return this;
	}

	goOnline(): this {
		this.online = true;
		return this;
	}

	/** One round of syncing. With no signal nothing happens, as in the app; returns whether it ran. */
	async sync(): Promise<boolean> {
		try {
			await this.core.run();
			return true;
		} catch (error) {
			if (error instanceof TypeError) return false;
			throw error;
		}
	}

	pending(): Promise<number> {
		return this.core.pendingCount();
	}

	// ---- what the shopper does, stamped with the virtual clock ----------------------------

	/** Creates a record. Returns the moment it was made, which is the time of each of its fields. */
	async create(table: Table, id: string, fields: Fields, at = this.clock.tick()): Promise<number> {
		await this.db.table(table).add({ id, ...fields, updatedAt: at });
		return at;
	}

	/** Changes fields of a record, as the app does: the changes plus a fresh updatedAt. */
	async edit(table: Table, id: string, changes: Fields, at = this.clock.tick()): Promise<number> {
		await this.db.table(table).update(id, { ...changes, updatedAt: at });
		return at;
	}

	/** Deletes (a tombstone) at a moment. */
	remove(table: Table, id: string, at = this.clock.tick()): Promise<number> {
		return this.edit(table, id, { deletedAt: at }, at);
	}

	/** Undoes a delete. */
	restore(table: Table, id: string, at = this.clock.tick()): Promise<number> {
		return this.edit(table, id, { deletedAt: undefined }, at);
	}

	// ---- what is on the phone ------------------------------------------------------------

	/** Every synced record, without the bookkeeping of what is still to send. */
	async state(): Promise<State> {
		const state: State = {};
		for (const table of SYNC_TABLES) {
			for (const record of await this.db.table(table).toArray()) {
				const fields: Fields = {};
				for (const field of Object.keys(SYNC_FIELDS[table])) {
					if (record[field] !== undefined) fields[field] = record[field];
				}
				state[`${table}/${record.id}`] = fields;
			}
		}
		return Object.fromEntries(Object.entries(state).sort(([a], [b]) => a.localeCompare(b)));
	}

	async get(table: Table, id: string): Promise<Fields | undefined> {
		return (await this.state())[`${table}/${id}`];
	}
}

/**
 * Syncs every phone that has a signal, again and again, until each has nothing left to send and
 * all of them hold the same data. Returns that data; throws, saying who differs, if it never
 * settles.
 */
export async function converge(phones: SimulatedPhone[], rounds = 8): Promise<State> {
	let states: State[] = [];
	for (let round = 0; round < rounds; round++) {
		for (const phone of phones) if (phone.online) await phone.sync();
		const waiting = await Promise.all(phones.map((phone) => phone.pending()));
		states = await Promise.all(phones.map((phone) => phone.state()));
		const agreed = states.every((state) => JSON.stringify(state) === JSON.stringify(states[0]));
		if (agreed && waiting.every((count) => count === 0)) return states[0];
	}
	throw new Error(
		`The phones did not settle in ${rounds} rounds.\n` +
			phones.map((phone, i) => `${phone.name}: ${JSON.stringify(states[i])}`).join('\n')
	);
}

/** A store, a trip and an item of one account, made on a phone and synced to the server. */
export async function startWithAnItem(phone: SimulatedPhone, label = 'x') {
	const ids = { store: `store-${label}`, trip: `trip-${label}`, item: `item-${label}` };
	await phone.create('stores', ids.store, {
		name: 'Tesco',
		taxRateBps: 2000,
		pricesIncludeTax: true,
		createdAt: 1,
		lastUsedAt: 1
	});
	await phone.create('trips', ids.trip, {
		storeId: ids.store,
		status: 'open',
		photosKept: false,
		startedAt: 1
	});
	await phone.create('items', ids.item, itemFields(ids.trip));
	await phone.sync();
	return ids;
}

export const itemFields = (tripId: string, description = 'Milk'): Fields => ({
	tripId,
	description,
	unitPriceMinor: 145,
	priceIncludesTax: true,
	quantity: 1,
	edited: false,
	createdAt: 1
});
