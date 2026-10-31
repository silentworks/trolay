import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../../../worker/api.ts';
import { createTestEnv, ORIGIN, testClient, type TestEnv } from '../../../worker/testing.ts';
import { TrolleyDB } from '#lib/data/db.ts';
import { markRemote } from './pending.ts';
import { SignedOutError, SyncCore, type Fetcher } from './core.ts';

// Two phones, each with its own IndexedDB, syncing through the real Worker and a real local D1.

let server: TestEnv;
beforeAll(async () => {
	server = await createTestEnv();
});
afterAll(() => server.dispose());

let cookie: string;
let userId: string;
let clock: number;
let n = 0;
/** Ids are global on the server, so every test gets its own (in use they are random UUIDs). */
let ids: { store: string; trip: string; item: string };
let a: TrolleyDB;
let b: TrolleyDB;
let phoneA: SyncCore;
let phoneB: SyncCore;

/** A fetch that goes to the Worker in-process as the signed-in user. */
const toServer =
	(whose: () => string): Fetcher =>
	(path, init = {}) =>
		handleApi(
			new Request(ORIGIN + path, {
				...init,
				headers: { ...init.headers, Cookie: whose(), Origin: ORIGIN }
			}),
			server.env
		);

beforeEach(async () => {
	// A new account each time, so what one test leaves on the server cannot reach another.
	const account = (await testClient(server.env).register()).done;
	cookie = account.cookie!;
	userId = account.body.user.id;
	clock = 1_790_000_000_000;
	ids = { store: `store-${n}`, trip: `trip-${n}`, item: `item-${n}` };
	a = new TrolleyDB(`a-${++n}`);
	b = new TrolleyDB(`b-${n}`);
	phoneA = new SyncCore(
		a,
		toServer(() => cookie)
	);
	phoneB = new SyncCore(
		b,
		toServer(() => cookie)
	);
});

const tick = () => ++clock;

type Device = TrolleyDB;
const store = (id = ids.store) => ({
	id,
	name: 'Tesco',
	taxRateBps: 2000,
	pricesIncludeTax: true,
	createdAt: tick(),
	lastUsedAt: tick(),
	updatedAt: tick()
});
const trip = (storeId = ids.store, id = ids.trip) => ({
	id,
	storeId,
	status: 'open' as const,
	photosKept: false,
	startedAt: tick(),
	updatedAt: tick()
});
const item = (tripId = ids.trip, id = ids.item) => ({
	id,
	tripId,
	description: 'Milk',
	unitPriceMinor: 145,
	priceIncludesTax: true,
	quantity: 1,
	edited: false,
	createdAt: tick(),
	updatedAt: tick()
});

async function aTripOn(device: Device) {
	await device.stores.add(store());
	await device.trips.add(trip());
	await device.items.add(item());
}

/** An edit as the app makes one: the changed fields and a fresh updatedAt. */
const edit = (device: Device, table: 'stores' | 'trips' | 'items', id: string, changes: object) =>
	device.table(table).update(id, { ...changes, updatedAt: tick() });

/** What a phone holds, without the bookkeeping of what is still to be sent. */
async function data(device: Device) {
	const clean = <T extends { id: string; pending?: unknown; pendingAt?: unknown }>(records: T[]) =>
		records
			.map(({ pending: _p, pendingAt: _a, ...rest }) => rest)
			.sort((x, y) => x.id.localeCompare(y.id));
	return {
		stores: clean(await device.stores.toArray()),
		trips: clean(await device.trips.toArray()),
		items: clean(await device.items.toArray())
	};
}

describe('the first sync', () => {
	it('uploads everything on the phone, and another phone receives it', async () => {
		await aTripOn(a);
		expect(await phoneA.pendingCount()).toBe(3);
		await phoneA.run();
		expect(await phoneA.pendingCount()).toBe(0);

		await phoneB.run();
		expect(await data(b)).toEqual(await data(a));
		expect(await phoneB.pendingCount()).toBe(0);
	});

	it('uploads what was on the phone before syncing existed', async () => {
		// A phone from before this version: records with no pending bookkeeping at all.
		const name = `legacy-${++n}`;
		const old = new Dexie(name);
		old.version(1).stores({
			stores: 'id, lastUsedAt',
			trips: 'id, status, storeId, startedAt',
			items: 'id, tripId, [tripId+createdAt], barcode',
			photos: 'id, itemId',
			productCache: 'barcode'
		});
		old.version(2).stores({ pendingLookups: 'barcode' });
		await old.table('stores').add(store());
		await old.table('trips').add(trip());
		await old.table('items').add({ ...item(), barcode: '5391511420780' });
		old.close();

		const upgraded = new TrolleyDB(name);
		const core = new SyncCore(
			upgraded,
			toServer(() => cookie)
		);
		expect(await core.pendingCount()).toBe(3);
		await core.run();
		await phoneB.run();
		expect((await b.items.get(ids.item))!.barcode).toBe('5391511420780');
	});

	it('merges rather than overwrites when a second phone already has its own data', async () => {
		await a.stores.add(store(`store-a-${n}`));
		await b.stores.add(store(`store-b-${n}`));
		await phoneA.run();
		await phoneB.run();
		await phoneA.run();
		const names = async (d: Device) => (await d.stores.toArray()).map((s) => s.id).sort();
		expect(await names(a)).toEqual([`store-a-${n}`, `store-b-${n}`]);
		expect(await names(b)).toEqual([`store-a-${n}`, `store-b-${n}`]);
	});
});

describe('two phones edit', () => {
	beforeEach(async () => {
		await aTripOn(a);
		await phoneA.run();
		await phoneB.run();
	});

	it('different fields of one item while offline, and both edits are kept', async () => {
		await edit(a, 'items', ids.item, { quantity: 3 });
		await edit(b, 'items', ids.item, { description: 'Oat milk' });
		await phoneA.run();
		await phoneB.run();
		await phoneA.run();
		for (const device of [a, b]) {
			expect(await device.items.get(ids.item)).toMatchObject({
				quantity: 3,
				description: 'Oat milk'
			});
		}
		expect(await data(a)).toEqual(await data(b));
	});

	it('the same field: the newer edit wins on both, whichever phone syncs first', async () => {
		await edit(a, 'items', ids.item, { unitPriceMinor: 150 });
		await edit(b, 'items', ids.item, { unitPriceMinor: 175 }); // later
		// The phone with the older edit syncs last.
		await phoneB.run();
		await phoneA.run();
		await phoneB.run();
		for (const device of [a, b])
			expect((await device.items.get(ids.item))!.unitPriceMinor).toBe(175);
	});

	it('a delete on one phone reaches the other', async () => {
		await edit(a, 'items', ids.item, { deletedAt: clock + 1 });
		await phoneA.run();
		await phoneB.run();
		expect((await b.items.get(ids.item))!.deletedAt).toBeGreaterThan(0);
	});

	it('an undone delete reaches the other phone too', async () => {
		await edit(a, 'items', ids.item, { deletedAt: clock + 1 });
		await phoneA.run();
		await phoneB.run();
		await edit(b, 'items', ids.item, { deletedAt: undefined });
		await phoneB.run();
		await phoneA.run();
		expect((await a.items.get(ids.item))!.deletedAt).toBeUndefined();
	});

	it('a trip finished on one phone shows as finished on the other, with its totals', async () => {
		const totals = { inclMinor: 145, exclMinor: 121, itemCount: 1, taxRateBps: 2000 };
		await edit(a, 'trips', ids.trip, { status: 'finished', finishedAt: clock + 1, totals });
		await phoneA.run();
		await phoneB.run();
		expect(await b.trips.get(ids.trip)).toMatchObject({ status: 'finished', totals });
	});

	it('an edit not yet sent survives what the other phone sent in the meantime', async () => {
		await edit(b, 'items', ids.item, { quantity: 5 });
		await phoneB.run();
		await edit(a, 'items', ids.item, { quantity: 2 }); // newer, and not sent yet
		await phoneA.pull();
		// The pull did not overwrite what is still waiting to be sent.
		expect((await a.items.get(ids.item))!.quantity).toBe(2);
		expect(await phoneA.pendingCount()).toBe(1);
		await phoneA.run();
		await phoneB.run();
		for (const device of [a, b]) expect((await device.items.get(ids.item))!.quantity).toBe(2);
	});

	it('an older unsent edit loses to a newer one, and the phone then shows the winner', async () => {
		await edit(a, 'items', ids.item, { quantity: 2 });
		await edit(b, 'items', ids.item, { quantity: 5 }); // newer
		await phoneB.run();
		await phoneA.run();
		expect((await a.items.get(ids.item))!.quantity).toBe(5);
		expect(await phoneA.pendingCount()).toBe(0);
	});

	it('many edits to many records from both phones settle on the same data', async () => {
		for (let i = 0; i < 12; i++) await a.items.add(item(ids.trip, `bulk-${n}-${i}`));
		await phoneA.run();
		await phoneB.run();
		for (let i = 0; i < 12; i++) {
			const winner = i % 2 === 0 ? a : b;
			await edit(winner, 'items', `bulk-${n}-${i}`, {
				description: `edited on ${winner === a ? 'a' : 'b'} ${i}`
			});
			await edit(i % 3 === 0 ? a : b, 'items', `bulk-${n}-${i}`, { quantity: i + 2 });
		}
		await phoneA.run();
		await phoneB.run();
		await phoneA.run();
		await phoneB.run();
		expect(await data(a)).toEqual(await data(b));
	});
});

describe('keeping what has not been sent', () => {
	it('keeps the changes when there is no signal, and sends them when there is', async () => {
		await aTripOn(a);
		const offline = new SyncCore(a, () => Promise.reject(new TypeError('Failed to fetch')));
		await expect(offline.run()).rejects.toThrow(TypeError);
		expect(await offline.pendingCount()).toBe(3);

		await phoneA.run();
		expect(await phoneA.pendingCount()).toBe(0);
		await phoneB.run();
		expect((await b.items.get(ids.item))!.description).toBe('Milk');
	});

	it('does not lose an edit made while the previous one was being sent', async () => {
		await aTripOn(a);
		await phoneA.run();
		await edit(a, 'items', ids.item, { quantity: 2 });
		const sent: number[] = [];
		let edited = false;
		const slow: Fetcher = async (path, init) => {
			const reply = await toServer(() => cookie)(path, init);
			if (path === '/api/sync/push') {
				const body = JSON.parse(init!.body as string);
				sent.push(body.changes[0].fields.quantity.value);
				// The shopper taps "+" again while the first request is in flight.
				if (!edited) {
					edited = true;
					await edit(a, 'items', ids.item, { quantity: 3 });
				}
			}
			return reply;
		};
		const core = new SyncCore(a, slow);
		await core.push();
		// The first request carried 2; clearing it did not wipe the newer 3, which went next.
		expect(sent).toEqual([2, 3]);
		expect(await core.pendingCount()).toBe(0);
		await phoneB.run();
		expect((await b.items.get(ids.item))!.quantity).toBe(3);
	});

	it('waits for a parent that has not arrived, without blocking the rest', async () => {
		// An item whose trip this phone has not sent (it is held back below), and a store that can go.
		await a.items.add(item(`trip-elsewhere-${n}`, `orphan-${n}`));
		await a.stores.add(store(`store-fine-${n}`));
		await phoneA.run();
		expect(await phoneA.pendingCount()).toBe(1);
		expect((await a.items.get(`orphan-${n}`))!.pendingAt).toBeDefined();
		// The trip turns up (made on the other phone), and the item can go.
		await b.stores.add(store());
		await b.trips.add(trip(ids.store, `trip-elsewhere-${n}`));
		await phoneB.run();
		await phoneA.run();
		expect(await phoneA.pendingCount()).toBe(0);
	});

	it('does not send what it just received back to the server as news', async () => {
		await aTripOn(a);
		await phoneA.run();
		await phoneB.run();
		expect(await phoneB.pendingCount()).toBe(0);
		const requests: string[] = [];
		const spy = new SyncCore(
			b,
			async (path, init) => (requests.push(path), toServer(() => cookie)(path, init))
		);
		await spy.run();
		expect(requests.every((path) => path.startsWith('/api/sync/pull'))).toBe(true);
	});
});

describe('where the last pull got to', () => {
	it('is remembered, so the next pull asks only for what is new', async () => {
		await aTripOn(a);
		await phoneA.run();
		const cursor = (await a.syncState.get('cursor'))!.value as number;
		expect(cursor).toBeGreaterThan(0);

		const asked: string[] = [];
		const watched = new SyncCore(
			a,
			(path, init) => (asked.push(path), toServer(() => cookie)(path, init))
		);
		await watched.pull();
		expect(asked).toEqual([`/api/sync/pull?since=${cursor}`]);

		// A phone that has never synced starts from the beginning, then remembers where it got to.
		const fresh = new SyncCore(
			b,
			(path, init) => (asked.push(path), toServer(() => cookie)(path, init))
		);
		await fresh.pull();
		expect(asked[1]).toBe('/api/sync/pull?since=0');
		expect((await b.syncState.get('cursor'))!.value).toBe(cursor);
	});

	it('pages through a long history', async () => {
		await a.stores.add(store());
		await a.trips.add(trip());
		for (let i = 0; i < 130; i++) await a.items.add(item(ids.trip, `many-${n}-${i}`));
		await phoneA.run();
		await phoneB.run();
		expect(await b.items.count()).toBe(130);
	});
});

describe('being signed out', () => {
	it('stops, and loses nothing', async () => {
		await aTripOn(a);
		const out = new SyncCore(
			a,
			toServer(() => '')
		);
		await expect(out.run()).rejects.toThrow(SignedOutError);
		expect(await out.pendingCount()).toBe(3);
	});
});

describe('signing in on a phone that already has data', () => {
	it('uploads a big history in batches, and the count still to send falls as it goes', async () => {
		await a.stores.add(store());
		await a.trips.add(trip());
		for (let i = 0; i < 128; i++) await a.items.add(item(ids.trip, `big-${n}-${i}`));
		const left: number[] = [];
		const watched = new SyncCore(a, async (path, init) => {
			if (path === '/api/sync/push') left.push(await watched.pendingCount());
			return toServer(() => cookie)(path, init);
		});
		await watched.run();
		// 130 records, 50 at a time: 130, then 80, then 30 still to send at each request.
		expect(left).toEqual([130, 80, 30]);
		expect(await watched.pendingCount()).toBe(0);
		await phoneB.run();
		expect(await b.items.count()).toBe(128);
	});

	it('does not send everything again when the same account signs in again', async () => {
		await aTripOn(a);
		await phoneA.adopt(userId);
		await phoneA.run();
		await phoneA.adopt(userId);
		expect(await phoneA.pendingCount()).toBe(0);
	});

	it('gives a different account that signs in there the data the first never had, and keeps the rest local', async () => {
		await aTripOn(a);
		await phoneA.adopt(userId);
		await phoneA.run();
		// Signed out, the shopper makes a new store; then someone else signs in on this phone.
		await a.stores.add(store(`new-store-${n}`));
		const other = (await testClient(server.env).register()).done;
		const theirs = new TrolleyDB(`theirs-${n}`);
		await theirs.stores.add(store(`their-store-${n}`));
		await new SyncCore(
			theirs,
			toServer(() => other.cookie!)
		).run();

		// What is already the first account's cannot be claimed by another: it is refused, and stays
		// on the phone. The new store is the second account's to have.
		const refused = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const core = new SyncCore(
			a,
			toServer(() => other.cookie!)
		);
		await core.adopt(other.body.user.id);
		expect(await core.pendingCount()).toBe(4);
		await core.run();
		expect(await core.pendingCount()).toBe(0);
		expect(refused).toHaveBeenCalled();
		refused.mockRestore();
		// What was refused is remembered, so the app can say why it will never reach this account.
		expect(await core.wasRefused('stores', ids.store)).toBe(true);
		expect(await core.wasRefused('trips', ids.trip)).toBe(true);
		expect(await core.wasRefused('stores', `new-store-${n}`)).toBe(false);
		// Back in the first account, which owns them, nothing is refused: the marker belonged to
		// the other account's turn on this phone.
		await phoneA.adopt(userId);
		expect(await phoneA.wasRefused('trips', ids.trip)).toBe(false);
		expect(await phoneA.wasRefused('stores', ids.store)).toBe(false);

		const ids_ = async (d: Device) => (await d.stores.toArray()).map((x) => x.id).sort();
		expect(await ids_(a)).toEqual([`new-store-${n}`, ids.store, `their-store-${n}`].sort());
		const second = new TrolleyDB(`second-${n}`);
		await new SyncCore(
			second,
			toServer(() => other.cookie!)
		).run();
		expect(await ids_(second)).toEqual([`new-store-${n}`, `their-store-${n}`].sort());
		// The first account has what it always had, and none of the new store.
		await phoneB.run();
		expect(await ids_(b)).toEqual([ids.store]);
	});

	describe('records from before a required field existed', () => {
		it('sends a trip that lacks photosKept, and its items follow', async () => {
			await a.stores.add(store());
			await a.trips.add(trip());
			await a.items.add(item());
			// As an older version of the app left it.
			await a.trips
				.where('id')
				.equals(ids.trip)
				.modify((record) => {
					delete (record as { photosKept?: boolean }).photosKept;
				});
			await phoneA.run();
			expect(await phoneA.pendingCount()).toBe(0);
			await phoneB.run();
			expect((await b.trips.get(ids.trip))?.photosKept).toBe(false);
			expect(await b.items.get(ids.item)).toBeDefined();
		});

		it('sends a parent again when its child cannot find it', async () => {
			await aTripOn(a);
			// The trip was marked as sent, but the server never got it (a refusal that was cleared).
			await a.transaction('rw', a.trips, async (tx) => {
				markRemote(tx);
				await a.trips.update(ids.trip, { pending: undefined, pendingAt: undefined });
			});
			await phoneA.run();
			expect(await phoneA.pendingCount()).toBe(0);
			await phoneB.run();
			expect(await b.trips.get(ids.trip)).toBeDefined();
			expect(await b.items.get(ids.item)).toBeDefined();
		});
	});
});
