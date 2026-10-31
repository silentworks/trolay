import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import { createTestEnv, ORIGIN, testClient, type TestEnv } from './testing.ts';
import { handleApi } from './api.ts';

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

/** Alice's open trip, shared with Bob. */
async function sharedTrip() {
	const id = ++n;
	const [store, trip] = [`store-${id}`, `trip-${id}`];
	await call('/api/sync/push', {
		cookie: alice,
		body: {
			changes: [
				{
					table: 'stores',
					id: store,
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
					id: trip,
					fields: {
						storeId: at(store),
						status: at('open'),
						photosKept: at(false),
						startedAt: at(T)
					}
				}
			]
		}
	});
	const made = await call('/api/trips/invite', { cookie: alice, body: { tripId: trip } });
	const token = new URL(made.body.link).hash.replace('#token=', '');
	await call('/api/trips/join', { cookie: bob, body: { token } });
	return trip;
}

/** The raw call: photos are bytes, not JSON. */
async function bytes(
	method: string,
	path: string,
	cookie: string | undefined,
	body?: BodyInit,
	type = 'image/jpeg'
) {
	const headers: Record<string, string> = { Origin: ORIGIN };
	if (cookie) headers.Cookie = cookie;
	if (body !== undefined) headers['Content-Type'] = type;
	return handleApi(new Request(ORIGIN + path, { method, headers, body }), env);
}
const put = (trip: string, photo: string, cookie: string | undefined, body: BodyInit = 'jpeg') =>
	bytes('PUT', `/api/trips/${trip}/photos/${photo}`, cookie, body);
const get = (trip: string, photo: string, cookie: string | undefined) =>
	bytes('GET', `/api/trips/${trip}/photos/${photo}`, cookie);
const stored = async (trip: string) =>
	(await env.PHOTOS!.list({ prefix: `trips/${trip}/` })).objects.map((o) => o.key);
const finish = (trip: string, kept: boolean, time = T + 1000) =>
	call('/api/sync/push', {
		cookie: alice,
		body: {
			changes: [
				{
					table: 'trips',
					id: trip,
					fields: {
						status: at('finished', time),
						finishedAt: at(time, time),
						photosKept: at(kept, time)
					}
				}
			]
		}
	});

describe('photos of a shared trip', () => {
	it('are uploaded by one member and fetched by the other, byte for byte', async () => {
		const trip = await sharedTrip();
		expect((await put(trip, 'photo-1', alice, new Uint8Array([1, 2, 3, 255]))).status).toBe(201);
		const reply = await get(trip, 'photo-1', bob);
		expect(reply.status).toBe(200);
		expect(reply.headers.get('Content-Type')).toBe('image/jpeg');
		expect([...new Uint8Array(await reply.arrayBuffer())]).toEqual([1, 2, 3, 255]);
		// Either member can add one.
		expect((await put(trip, 'photo-2', bob)).status).toBe(201);
		expect((await get(trip, 'photo-2', alice)).status).toBe(200);
	});

	it('are for members only', async () => {
		const trip = await sharedTrip();
		await put(trip, 'photo-1', alice);
		expect((await get(trip, 'photo-1', undefined)).status).toBe(401);
		expect((await put(trip, 'photo-9', undefined)).status).toBe(401);
		expect((await get(trip, 'photo-1', carol)).status).toBe(404);
		expect((await put(trip, 'photo-9', carol)).status).toBe(404);
		expect(await stored(trip)).toEqual([`trips/${trip}/photo-1`]);
		expect((await get(trip, 'nothing', alice)).status).toBe(404);
	});

	it('are limited to images of a sensible size', async () => {
		const trip = await sharedTrip();
		const text = await bytes('PUT', `/api/trips/${trip}/photos/p`, alice, 'x', 'text/html');
		expect(text.status).toBe(415);
		expect((await put(trip, 'p', alice, new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(413);
		expect((await put(trip, 'p', alice, new Uint8Array(0))).status).toBe(400);
		expect((await put(trip, 'bad id!', alice)).status).toBe(400);
		expect(await stored(trip)).toEqual([]);
	});

	it('are not accepted once the trip has finished', async () => {
		const trip = await sharedTrip();
		await finish(trip, true);
		expect((await put(trip, 'late', alice)).status).toBe(409);
	});
});

describe('when the trip finishes', () => {
	it('its photos are deleted from R2', async () => {
		const trip = await sharedTrip();
		await put(trip, 'a', alice);
		await put(trip, 'b', bob);
		expect(await stored(trip)).toHaveLength(2);
		await finish(trip, false);
		expect(await stored(trip)).toEqual([]);
	});

	it('they stay when kept as receipt evidence, until the evidence is deleted', async () => {
		const trip = await sharedTrip();
		await put(trip, 'a', alice);
		await finish(trip, true);
		expect(await stored(trip)).toEqual([`trips/${trip}/a`]);
		// Both can still look at them.
		expect((await get(trip, 'a', bob)).status).toBe(200);
		// Deleting the evidence on the phone syncs as photosKept = false.
		await call('/api/sync/push', {
			cookie: alice,
			body: {
				changes: [{ table: 'trips', id: trip, fields: { photosKept: at(false, T + 5000) } }]
			}
		});
		expect(await stored(trip)).toEqual([]);
	});

	it('one trip finishing leaves another trip’s photos alone', async () => {
		const [one, other] = [await sharedTrip(), await sharedTrip()];
		await put(one, 'a', alice);
		await put(other, 'a', alice);
		await finish(one, false);
		expect(await stored(one)).toEqual([]);
		expect(await stored(other)).toEqual([`trips/${other}/a`]);
	});

	it('they go too when the trip is deleted', async () => {
		const trip = await sharedTrip();
		await put(trip, 'a', alice);
		await call('/api/sync/push', {
			cookie: alice,
			body: {
				changes: [{ table: 'trips', id: trip, fields: { deletedAt: at(T + 2000, T + 2000) } }]
			}
		});
		expect(await stored(trip)).toEqual([]);
	});
});

describe('who is on a trip', () => {
	it('lists the owner and the partner to either of them, and to nobody else', async () => {
		const trip = await sharedTrip();
		const asBob = await call(`/api/trips/members?trip=${trip}`, { cookie: bob });
		expect(asBob.body.members.map((m: { role: string }) => m.role)).toEqual(['partner', 'owner']);
		expect(
			(await call(`/api/trips/members?trip=${trip}`, { cookie: alice })).body.members
		).toHaveLength(2);
		expect((await call(`/api/trips/members?trip=${trip}`, { cookie: carol })).status).toBe(404);
		expect((await call(`/api/trips/members?trip=${trip}`)).status).toBe(401);
		expect((await call('/api/trips/members?trip=bad id!', { cookie: alice })).status).toBe(400);
	});
});
