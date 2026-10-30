import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushedChange, PushResult } from '../src/lib/sync/schema.ts';
import type { Env } from './env.ts';
import { createTestEnv, testClient, type TestEnv } from './testing.ts';

let test: TestEnv;
let env: Env;
let call: ReturnType<typeof testClient>['call'];
let register: ReturnType<typeof testClient>['register'];
let alice: string;
let bob: string;
beforeAll(async () => {
	test = await createTestEnv();
	env = test.env;
	({ call, register } = testClient(env));
	alice = (await register()).done.cookie!;
	bob = (await register()).done.cookie!;
});
afterAll(() => test.dispose());

const T = 1_700_000_000_000;
let n = 0;
const uid = (prefix: string) => `${prefix}-${++n}`;

/** A change to one record, every field set at `at` unless a field is given its own time. */
function change(
	table: PushedChange['table'],
	id: string,
	fields: Record<string, unknown>,
	at: number
): PushedChange {
	return {
		table,
		id,
		fields: Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, { value, at }]))
	};
}

const storeFields = {
	name: 'Tesco',
	taxRateBps: 2000,
	pricesIncludeTax: true,
	createdAt: T,
	lastUsedAt: T
};
const tripFields = (storeId: string) => ({
	storeId,
	status: 'open',
	photosKept: false,
	startedAt: T
});
const itemFields = (tripId: string) => ({
	tripId,
	description: 'Milk',
	unitPriceMinor: 145,
	priceIncludesTax: true,
	quantity: 1,
	edited: false,
	createdAt: T
});

const push = (cookie: string, changes: unknown) =>
	call('/api/sync/push', { body: { changes }, cookie });
const pull = (cookie: string, since = 0, limit?: number) =>
	call(`/api/sync/pull?since=${since}${limit ? `&limit=${limit}` : ''}`, { cookie });

/** A store, a trip and an item of Alice's, pushed; the ids are returned. */
async function aSmallTrip(cookie = alice, at = T) {
	const store = uid('store');
	const trip = uid('trip');
	const item = uid('item');
	const reply = await push(cookie, [
		change('stores', store, storeFields, at),
		change('trips', trip, tripFields(store), at),
		change('items', item, itemFields(trip), at)
	]);
	expect(reply.body.results.map((r: PushResult) => r.status)).toEqual(['ok', 'ok', 'ok']);
	return { store, trip, item };
}

const recordOf = async (cookie: string, table: string, id: string) =>
	(await pull(cookie)).body.records.find(
		(r: { table: string; id: string }) => r.table === table && r.id === id
	);

describe('who may sync', () => {
	it('needs a session', async () => {
		expect((await call('/api/sync/push', { body: { changes: [] } })).status).toBe(401);
		expect((await call('/api/sync/pull')).status).toBe(401);
	});
});

describe('pushing and pulling', () => {
	it("stores what is pushed and gives it back as the app's records", async () => {
		const { store, trip, item } = await aSmallTrip();
		const reply = await pull(alice);
		expect(reply.status).toBe(200);
		const ours = reply.body.records.filter((r: { id: string }) =>
			[store, trip, item].includes(r.id)
		);
		expect(ours.map((r: { table: string }) => r.table)).toEqual(['stores', 'trips', 'items']);
		expect(ours[0]).toMatchObject({
			table: 'stores',
			id: store,
			updatedAt: T,
			fields: {
				name: 'Tesco',
				branch: null,
				taxRateBps: 2000,
				pricesIncludeTax: true,
				deletedAt: null
			}
		});
		expect(ours[1].fields).toMatchObject({
			storeId: store,
			status: 'open',
			photosKept: false,
			budgetMinor: null
		});
		expect(ours[2].fields).toMatchObject({
			tripId: trip,
			description: 'Milk',
			quantity: 1,
			edited: false
		});
	});

	it('round-trips JSON fields and unsets a field with null', async () => {
		const { trip, item } = await aSmallTrip();
		await push(alice, [
			change(
				'items',
				item,
				{ extracted: { confidence: 0.9, unitPriceMinor: 145 }, barcode: '5391511420780' },
				T + 1
			),
			change(
				'trips',
				trip,
				{
					totals: { inclMinor: 145, exclMinor: 121, itemCount: 1, taxRateBps: 2000 },
					budgetMinor: 5000
				},
				T + 1
			)
		]);
		expect((await recordOf(alice, 'items', item)).fields.extracted).toEqual({
			confidence: 0.9,
			unitPriceMinor: 145
		});
		expect((await recordOf(alice, 'trips', trip)).fields.totals.inclMinor).toBe(145);
		await push(alice, [change('trips', trip, { budgetMinor: null }, T + 2)]);
		expect((await recordOf(alice, 'trips', trip)).fields.budgetMinor).toBeNull();
	});

	it('makes the owner a member of a new trip', async () => {
		const { trip } = await aSmallTrip();
		const rows = await env.DB.prepare('SELECT role FROM trip_members WHERE trip_id = ?')
			.bind(trip)
			.all();
		expect(rows.results).toEqual([{ role: 'owner' }]);
	});

	it('pages through what changed, in the order the server accepted it', async () => {
		const stores = Array.from({ length: 5 }, () => uid('page'));
		await push(
			alice,
			stores.map((id, i) => change('stores', id, storeFields, T + i))
		);
		const seen: string[] = [];
		let since = (await pull(alice, 0, 500)).body.cursor - 5;
		for (let pages = 0; pages < 10; pages++) {
			const page = (await pull(alice, since, 2)).body;
			expect(page.records.length).toBeLessThanOrEqual(2);
			seen.push(...page.records.map((r: { id: string }) => r.id));
			since = page.cursor;
			if (!page.more) break;
		}
		expect(seen).toEqual(stores);
	});

	it('hands a late change out even though its own clock is old', async () => {
		const { cursor } = (await pull(alice)).body;
		// A phone that was offline for days pushes an edit made long ago.
		const late = uid('late');
		await push(alice, [change('stores', late, storeFields, T - 5 * 24 * 60 * 60 * 1000)]);
		const reply = (await pull(alice, cursor)).body;
		expect(reply.records.map((r: { id: string }) => r.id)).toContain(late);
	});

	it('sends a record once, as it is now, however often it changed', async () => {
		const store = uid('busy');
		const { cursor } = (await pull(alice)).body;
		for (let i = 0; i < 3; i++)
			await push(alice, [change('stores', store, { ...storeFields, name: `Name ${i}` }, T + i)]);
		const records = (await pull(alice, cursor)).body.records;
		expect(records).toHaveLength(1);
		expect(records[0].fields.name).toBe('Name 2');
	});
});

describe('settling conflicts, field by field, newest first', () => {
	it('keeps both edits when two devices change different fields', async () => {
		const { item } = await aSmallTrip();
		await Promise.all([
			push(alice, [change('items', item, { quantity: 3 }, T + 10)]),
			push(alice, [change('items', item, { description: 'Oat milk' }, T + 11)])
		]);
		expect((await recordOf(alice, 'items', item)).fields).toMatchObject({
			quantity: 3,
			description: 'Oat milk'
		});
	});

	it('keeps the newer value of one field, whichever arrives first', async () => {
		const { item } = await aSmallTrip();
		await push(alice, [change('items', item, { unitPriceMinor: 150 }, T + 50)]);
		const stale = await push(alice, [change('items', item, { unitPriceMinor: 120 }, T + 20)]);
		expect(stale.body.results[0].status).toBe('ok');
		expect((await recordOf(alice, 'items', item)).fields.unitPriceMinor).toBe(150);

		const { item: other } = await aSmallTrip();
		await push(alice, [change('items', other, { unitPriceMinor: 120 }, T + 20)]);
		await push(alice, [change('items', other, { unitPriceMinor: 150 }, T + 50)]);
		expect((await recordOf(alice, 'items', other)).fields.unitPriceMinor).toBe(150);
	});

	it('settles two changes made at the same moment the same way in either order', async () => {
		const first = await aSmallTrip();
		const second = await aSmallTrip();
		await push(alice, [change('items', first.item, { description: 'Apple' }, T + 5)]);
		await push(alice, [change('items', first.item, { description: 'Banana' }, T + 5)]);
		await push(alice, [change('items', second.item, { description: 'Banana' }, T + 5)]);
		await push(alice, [change('items', second.item, { description: 'Apple' }, T + 5)]);
		const a = (await recordOf(alice, 'items', first.item)).fields.description;
		const b = (await recordOf(alice, 'items', second.item)).fields.description;
		expect(a).toBe(b);
	});

	it('lets a delete and an undo be settled like any other field', async () => {
		const { item } = await aSmallTrip();
		await push(alice, [change('items', item, { deletedAt: T + 100 }, T + 100)]);
		expect((await recordOf(alice, 'items', item)).fields.deletedAt).toBe(T + 100);
		// An edit made before the delete is kept, and is not undone by it.
		await push(alice, [change('items', item, { quantity: 4 }, T + 90)]);
		expect((await recordOf(alice, 'items', item)).fields).toMatchObject({
			deletedAt: T + 100,
			quantity: 4
		});
		// An older undo loses; a newer one wins.
		await push(alice, [change('items', item, { deletedAt: null }, T + 80)]);
		expect((await recordOf(alice, 'items', item)).fields.deletedAt).toBe(T + 100);
		await push(alice, [change('items', item, { deletedAt: null }, T + 200)]);
		expect((await recordOf(alice, 'items', item)).fields.deletedAt).toBeNull();
	});

	it('does not count a change that lost as news', async () => {
		const { item } = await aSmallTrip();
		await push(alice, [change('items', item, { quantity: 9 }, T + 300)]);
		const { cursor } = (await pull(alice)).body;
		await push(alice, [change('items', item, { quantity: 2 }, T + 100)]);
		expect((await pull(alice, cursor)).body.records).toHaveLength(0);
	});
});

describe('privacy', () => {
	it("keeps one person's records from another, in both directions", async () => {
		const mine = await aSmallTrip(alice);
		const theirs = await aSmallTrip(bob);
		const aliceSees = (await pull(alice)).body.records.map((r: { id: string }) => r.id);
		const bobSees = (await pull(bob)).body.records.map((r: { id: string }) => r.id);
		expect(aliceSees).toContain(mine.item);
		expect(aliceSees).not.toContain(theirs.item);
		expect(bobSees).toContain(theirs.item);
		expect(bobSees).not.toContain(mine.item);
	});

	it("refuses to change, or build on, another person's records", async () => {
		const mine = await aSmallTrip(alice);
		const attempts = await push(bob, [
			change('stores', mine.store, { name: 'Hijacked' }, T + 999),
			change('trips', mine.trip, { status: 'finished' }, T + 999),
			change('items', mine.item, { description: 'Hijacked' }, T + 999),
			change('trips', uid('trip'), tripFields(mine.store), T),
			change('items', uid('item'), itemFields(mine.trip), T)
		]);
		expect(attempts.body.results.map((r: PushResult) => [r.status, r.reason])).toEqual(
			Array(5).fill(['rejected', 'forbidden'])
		);
		expect((await recordOf(alice, 'stores', mine.store)).fields.name).toBe('Tesco');
		expect((await recordOf(alice, 'items', mine.item)).fields.description).toBe('Milk');
	});
});

describe('refusing what the app would never send', () => {
	it('asks for the parent first when a trip or item has none yet', async () => {
		const reply = await push(alice, [
			change('trips', uid('trip'), tripFields('no-such-store'), T),
			change('items', uid('item'), itemFields('no-such-trip'), T)
		]);
		expect(reply.body.results.map((r: PushResult) => r.reason)).toEqual([
			'missing_parent',
			'missing_parent'
		]);
	});

	it('refuses malformed changes one by one, and still applies the good ones', async () => {
		const good = uid('store');
		const reply = await push(alice, [
			change('stores', uid('store'), { ...storeFields, colour: 'red' }, T),
			change('stores', uid('store'), { ...storeFields, taxRateBps: 20.5 }, T),
			change('stores', uid('store'), { ...storeFields, name: null }, T),
			change('stores', uid('store'), { name: 'Only a name' }, T),
			// Dated a year ahead of the real clock, which would beat every later edit.
			change('stores', uid('store'), storeFields, Date.now() + 365 * 24 * 60 * 60 * 1000),
			change('stores', 'bad id!', storeFields, T),
			{ table: 'users', id: 'x', fields: {} },
			'nonsense',
			change('stores', good, storeFields, T)
		]);
		expect(reply.status).toBe(200);
		const statuses = reply.body.results.map((r: PushResult) => r.status);
		expect(statuses.slice(0, -1)).toEqual(Array(8).fill('rejected'));
		expect(statuses.at(-1)).toBe('ok');
		expect(await recordOf(alice, 'stores', good)).toBeDefined();
	});

	it('refuses a request that is not a list of at most 100 changes', async () => {
		expect((await call('/api/sync/push', { body: {}, cookie: alice })).status).toBe(400);
		expect((await push(alice, 'nope')).status).toBe(400);
		const many = Array.from({ length: 101 }, () => change('stores', uid('store'), storeFields, T));
		expect((await push(alice, many)).status).toBe(400);
	});

	it('refuses a bad pull request', async () => {
		expect((await call('/api/sync/pull?since=-1', { cookie: alice })).status).toBe(400);
		expect((await call('/api/sync/pull?since=abc', { cookie: alice })).status).toBe(400);
		expect((await call('/api/sync/pull?limit=0', { cookie: alice })).status).toBe(400);
	});
});
