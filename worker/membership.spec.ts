import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import { createTestEnv, testClient, type TestEnv } from './testing.ts';

let test: TestEnv;
let env: Env;
let call: ReturnType<typeof testClient>['call'];
let register: ReturnType<typeof testClient>['register'];
let alice: string;
let bob: string;
let carol: string;
beforeAll(async () => {
	test = await createTestEnv();
	env = test.env;
	({ call, register } = testClient(env));
	alice = (await register()).done.cookie!;
	bob = (await register()).done.cookie!;
	carol = (await register()).done.cookie!;
});
afterAll(() => test.dispose());

const T = 1_700_000_000_000;
let n = 0;
const at = (value: unknown, time = T) => ({ value, at: time });

/** Alice's open trip with an item of hers, shared with Bob, who has added one too. */
async function sharedTrip() {
	const id = ++n;
	const ids = {
		store: `store-${id}`,
		trip: `trip-${id}`,
		mine: `mine-${id}`,
		theirs: `theirs-${id}`
	};
	const item = (tripId: string, description: string) => ({
		tripId: at(tripId),
		description: at(description),
		unitPriceMinor: at(100),
		priceIncludesTax: at(true),
		quantity: at(1),
		edited: at(false),
		createdAt: at(T)
	});
	await call('/api/sync/push', {
		cookie: alice,
		body: {
			changes: [
				{
					table: 'stores',
					id: ids.store,
					fields: {
						name: at('Tesco'),
						taxRateBps: at(2000),
						pricesIncludeTax: at(true),
						createdAt: at(T),
						lastUsedAt: at(T)
					}
				},
				{
					table: 'trips',
					id: ids.trip,
					fields: {
						storeId: at(ids.store),
						status: at('open'),
						photosKept: at(false),
						startedAt: at(T)
					}
				},
				{ table: 'items', id: ids.mine, fields: item(ids.trip, 'Milk') }
			]
		}
	});
	await join(ids.trip, bob);
	await call('/api/sync/push', {
		cookie: bob,
		body: { changes: [{ table: 'items', id: ids.theirs, fields: item(ids.trip, 'Bread') }] }
	});
	return ids;
}

async function join(tripId: string, cookie: string) {
	const made = await call('/api/trips/invite', { cookie: alice, body: { tripId } });
	const token = new URL(made.body.link).hash.replace('#token=', '');
	expect((await call('/api/trips/join', { cookie, body: { token } })).status).toBe(200);
}

const leave = (cookie: string | undefined, tripId: string) =>
	call('/api/trips/leave', { cookie, body: { tripId } });
const remove = (cookie: string | undefined, tripId: string) =>
	call('/api/trips/remove-partner', { cookie, body: { tripId } });
const pull = (cookie: string, since = 0) => call(`/api/sync/pull?since=${since}`, { cookie });
const ids = (reply: { body: { records: { id: string }[] } }) => reply.body.records.map((r) => r.id);
const people = async (trip: string) =>
	(await call(`/api/trips/members?trip=${trip}`, { cookie: alice })).body.members.map(
		(m: { role: string }) => m.role
	);
const finish = (trip: string) =>
	call('/api/sync/push', {
		cookie: alice,
		body: {
			changes: [
				{
					table: 'trips',
					id: trip,
					fields: { status: at('finished', T + 1000), finishedAt: at(T + 1000, T + 1000) }
				}
			]
		}
	});

describe('a partner leaving', () => {
	it('stops being on the trip, and the trip stays with the owner, partner’s items and all', async () => {
		const trip = await sharedTrip();
		const cursor = (await pull(bob)).body.cursor;
		expect(await leave(bob, trip.trip)).toMatchObject({ status: 200, body: { left: true } });
		expect(await people(trip.trip)).toEqual(['owner']);

		// Bob can no longer read or write it.
		expect(ids(await pull(bob))).not.toContain(trip.trip);
		const write = await call('/api/sync/push', {
			cookie: bob,
			body: {
				changes: [{ table: 'items', id: trip.mine, fields: { quantity: at(9, T + 5000) } }]
			}
		});
		expect(write.body.results[0]).toMatchObject({ status: 'rejected', reason: 'forbidden' });
		expect((await call(`/api/trips/members?trip=${trip.trip}`, { cookie: bob })).status).toBe(404);

		// Alice still has everything, including what Bob added.
		expect(ids(await pull(alice))).toEqual(
			expect.arrayContaining([trip.trip, trip.mine, trip.theirs])
		);

		// Bob's phone is told to let go of the trip and its store.
		const told = await pull(bob, cursor);
		expect(told.body.left).toEqual([{ tripId: trip.trip, storeId: trip.store }]);
	});

	it('is only for a partner of an open trip', async () => {
		const trip = await sharedTrip();
		expect((await leave(undefined, trip.trip)).status).toBe(401);
		// The owner, a stranger and a trip that is not there all get the same answer.
		for (const cookie of [alice, carol]) {
			expect(await leave(cookie, trip.trip)).toMatchObject({
				status: 404,
				body: { error: 'trip_not_found' }
			});
		}
		expect((await leave(bob, 'no-such-trip')).status).toBe(404);
		expect((await call('/api/trips/leave', { cookie: bob, body: { tripId: 5 } })).status).toBe(400);
		expect(await people(trip.trip)).toEqual(['partner', 'owner']);
	});

	it('is not possible once the trip has finished, which stays in both histories', async () => {
		const trip = await sharedTrip();
		await finish(trip.trip);
		expect(await leave(bob, trip.trip)).toMatchObject({
			status: 409,
			body: { error: 'trip_finished' }
		});
		expect(await remove(alice, trip.trip)).toMatchObject({
			status: 409,
			body: { error: 'trip_finished' }
		});
		expect(await people(trip.trip)).toEqual(['partner', 'owner']);
		for (const cookie of [alice, bob]) {
			const view = (await pull(cookie)).body.records.find(
				(r: { id: string }) => r.id === trip.trip
			);
			expect(view.fields.status).toBe('finished');
		}
	});

	it('can join again, and is then not told they have left', async () => {
		const trip = await sharedTrip();
		const cursor = (await pull(bob)).body.cursor;
		await leave(bob, trip.trip);
		await join(trip.trip, bob);
		expect(await people(trip.trip)).toEqual(['partner', 'owner']);
		const told = await pull(bob, cursor);
		expect(told.body.left).toBeUndefined();
		expect(ids(told)).toContain(trip.trip);
	});
});

describe('an owner removing the partner', () => {
	it('takes them off the trip, and tells their phone', async () => {
		const trip = await sharedTrip();
		const cursor = (await pull(bob)).body.cursor;
		expect(await remove(alice, trip.trip)).toMatchObject({ status: 200, body: { removed: true } });
		expect(await people(trip.trip)).toEqual(['owner']);
		expect((await pull(bob, cursor)).body.left).toEqual([
			{ tripId: trip.trip, storeId: trip.store }
		]);
		expect(ids(await pull(bob))).not.toContain(trip.trip);
	});

	it('lets the owner invite someone else afterwards', async () => {
		const trip = await sharedTrip();
		await remove(alice, trip.trip);
		await join(trip.trip, carol);
		expect(await people(trip.trip)).toEqual(['partner', 'owner']);
		expect(ids(await pull(carol))).toContain(trip.trip);
	});

	it('is only for the owner, and only with a partner to remove', async () => {
		const trip = await sharedTrip();
		expect((await remove(undefined, trip.trip)).status).toBe(401);
		expect((await remove(bob, trip.trip)).status).toBe(404);
		expect((await remove(carol, trip.trip)).status).toBe(404);
		await remove(alice, trip.trip);
		expect(await remove(alice, trip.trip)).toMatchObject({
			status: 409,
			body: { error: 'no_partner' }
		});
	});
});
