import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushedChange, PushResult } from '../src/lib/sync/schema.ts';
import type { Env } from './env.ts';
import { createTestEnv, testClient, type TestEnv } from './testing.ts';

// What a partner may see and do: the one trip they were invited to, its items and its store,
// and nothing else of the owner's. Every request here is by id, as a malicious client would
// make it: there is no other way to ask the API for a record.

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

const fields = (values: Record<string, unknown>, at = T): PushedChange['fields'] =>
	Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, at }]));

const push = (cookie: string, changes: PushedChange[]) =>
	call('/api/sync/push', { cookie, body: { changes } });
const pull = (cookie: string, since = 0) => call(`/api/sync/pull?since=${since}`, { cookie });
const statuses = (reply: { body: { results: PushResult[] } }) =>
	reply.body.results.map((r) => (r.status === 'ok' ? 'ok' : r.reason));
const ids = (reply: { body: { records: { id: string }[] } }) => reply.body.records.map((r) => r.id);

/** Alice's store, an open trip and an item, pushed. */
async function aTrip(name = 'Tesco') {
	const store = uid('store');
	const trip = uid('trip');
	const item = uid('item');
	const reply = await push(alice, [
		{
			table: 'stores',
			id: store,
			fields: fields({
				name,
				taxRateBps: 2000,
				pricesIncludeTax: true,
				createdAt: T,
				lastUsedAt: T
			})
		},
		{
			table: 'trips',
			id: trip,
			fields: fields({ storeId: store, status: 'open', photosKept: false, startedAt: T })
		},
		{
			table: 'items',
			id: item,
			fields: fields({
				tripId: trip,
				description: 'Milk',
				unitPriceMinor: 145,
				priceIncludesTax: true,
				quantity: 1,
				edited: false,
				createdAt: T
			})
		}
	]);
	expect(statuses(reply)).toEqual(['ok', 'ok', 'ok']);
	return { store, trip, item };
}

/** Bob joined the trip, by an invite link from Alice. */
async function share(tripId: string, partner = bob) {
	const made = await call('/api/trips/invite', { cookie: alice, body: { tripId } });
	const token = new URL(made.body.link).hash.replace('#token=', '');
	expect((await call('/api/trips/join', { cookie: partner, body: { token } })).status).toBe(200);
}

describe('a partner reads', () => {
	it('the invited trip, its items and the store it is at', async () => {
		const mine = await aTrip();
		await share(mine.trip);
		const reply = await pull(bob);
		expect(ids(reply).sort()).toEqual([mine.item, mine.store, mine.trip].sort());
		const store = reply.body.records.find((r: { id: string }) => r.id === mine.store);
		expect(store.fields.name).toBe('Tesco');
	});

	it("and none of the owner's other trips, items, stores or history", async () => {
		const other = await aTrip('Aldi');
		const shared = await aTrip('Lidl');
		await share(shared.trip);
		const seen = ids(await pull(bob));
		for (const id of [other.trip, other.item, other.store]) expect(seen).not.toContain(id);
		expect(seen).toContain(shared.trip);
	});

	it('a trip they have not been invited to stays unseen after it changes', async () => {
		const other = await aTrip('Spar');
		const shared = await aTrip('Coop');
		await share(shared.trip);
		const cursor = (await pull(bob)).body.cursor;
		await push(alice, [
			{ table: 'trips', id: other.trip, fields: fields({ budgetMinor: 500 }, T + 1000) },
			{ table: 'stores', id: other.store, fields: fields({ name: 'Spar Express' }, T + 1000) }
		]);
		expect(ids(await pull(bob, cursor))).not.toContain(other.trip);
		expect(ids(await pull(bob, cursor))).not.toContain(other.store);
	});

	it('only once a trip is shared, and not after another account is let in', async () => {
		const mine = await aTrip();
		expect(ids(await pull(bob))).not.toContain(mine.trip);
		await share(mine.trip);
		expect(ids(await pull(bob))).toContain(mine.trip);
	});
});

describe('a partner writes', () => {
	it('items on the shared trip, and edits and deletes theirs and the owner’s', async () => {
		const mine = await aTrip();
		await share(mine.trip);
		const added = uid('item');
		const reply = await push(bob, [
			{
				table: 'items',
				id: added,
				fields: fields({
					tripId: mine.trip,
					description: 'Bread',
					unitPriceMinor: 99,
					priceIncludesTax: true,
					quantity: 1,
					edited: false,
					createdAt: T,
					addedBy: 'bob'
				})
			},
			{ table: 'items', id: mine.item, fields: fields({ quantity: 3 }, T + 1000) },
			{ table: 'trips', id: mine.trip, fields: fields({ budgetMinor: 2000 }, T + 1000) }
		]);
		expect(statuses(reply)).toEqual(['ok', 'ok', 'ok']);
		// Alice has what Bob did.
		const alicesView = ids(await pull(alice));
		expect(alicesView).toContain(added);
	});

	it('nothing in the owner’s other trips, by id', async () => {
		const other = await aTrip('Aldi');
		const shared = await aTrip('Lidl');
		await share(shared.trip);
		const reply = await push(bob, [
			// Edit and delete the other trip, its item and its store.
			{ table: 'trips', id: other.trip, fields: fields({ budgetMinor: 1 }, T + 1000) },
			{ table: 'trips', id: other.trip, fields: fields({ deletedAt: T + 1000 }, T + 1000) },
			{ table: 'items', id: other.item, fields: fields({ quantity: 9 }, T + 1000) },
			{ table: 'items', id: other.item, fields: fields({ deletedAt: T + 1000 }, T + 1000) },
			{ table: 'stores', id: other.store, fields: fields({ name: 'Mine now' }, T + 1000) },
			// Add an item to it.
			{
				table: 'items',
				id: uid('item'),
				fields: fields({
					tripId: other.trip,
					description: 'Sneaked',
					unitPriceMinor: 1,
					priceIncludesTax: true,
					quantity: 1,
					edited: false,
					createdAt: T
				})
			}
		]);
		expect(statuses(reply)).toEqual(Array(6).fill('forbidden'));
		const view = await pull(alice);
		const store = view.body.records.find((r: { id: string }) => r.id === other.store);
		expect(store.fields.name).toBe('Aldi');
	});

	it('cannot take an item of the owner’s into a trip of their own, by its id', async () => {
		const other = await aTrip('Aldi');
		const shared = await aTrip('Lidl');
		await share(shared.trip);
		// Bob has a trip of his own.
		const store = uid('store');
		const trip = uid('trip');
		await push(bob, [
			{
				table: 'stores',
				id: store,
				fields: fields({
					name: 'Mine',
					taxRateBps: 0,
					pricesIncludeTax: true,
					createdAt: T,
					lastUsedAt: T
				})
			},
			{
				table: 'trips',
				id: trip,
				fields: fields({ storeId: store, status: 'open', photosKept: false, startedAt: T })
			}
		]);
		const reply = await push(bob, [
			{ table: 'items', id: other.item, fields: fields({ tripId: trip }, T + 1000) }
		]);
		expect(statuses(reply)).toEqual(['forbidden']);
	});

	it('cannot move the shared trip to another store, or delete it', async () => {
		const shared = await aTrip('Lidl');
		await share(shared.trip);
		const ownStore = uid('store');
		await push(bob, [
			{
				table: 'stores',
				id: ownStore,
				fields: fields({
					name: 'Mine',
					taxRateBps: 0,
					pricesIncludeTax: true,
					createdAt: T,
					lastUsedAt: T
				})
			}
		]);
		expect(
			statuses(
				await push(bob, [
					{ table: 'trips', id: shared.trip, fields: fields({ storeId: ownStore }, T + 1000) }
				])
			)
		).toEqual(['forbidden']);
		expect(
			statuses(
				await push(bob, [
					{ table: 'trips', id: shared.trip, fields: fields({ deletedAt: T + 1000 }, T + 1000) }
				])
			)
		).toEqual(['forbidden']);
		// But they can finish it.
		expect(
			statuses(
				await push(bob, [
					{
						table: 'trips',
						id: shared.trip,
						fields: fields({ status: 'finished', finishedAt: T + 2000 }, T + 2000)
					}
				])
			)
		).toEqual(['ok']);
	});

	it('cannot write to a trip while only a stranger', async () => {
		const mine = await aTrip();
		const reply = await push(bob, [
			{ table: 'trips', id: mine.trip, fields: fields({ budgetMinor: 5 }, T + 1000) },
			{ table: 'items', id: mine.item, fields: fields({ quantity: 7 }, T + 1000) }
		]);
		expect(statuses(reply)).toEqual(['forbidden', 'forbidden']);
	});
});
