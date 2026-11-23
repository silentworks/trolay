import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApi } from './api.ts';
import type { Env } from './env.ts';
import { createTestEnv, ORIGIN, testClient, type TestEnv } from './testing.ts';
import { MAX_PHOTOS_PER_TRIP } from './trips/photos.ts';

// Price tag photos kept in the cloud: each is its taker's alone, outlives its trip, and goes
// only with the account.

let test: TestEnv;
let env: Env;
let call: ReturnType<typeof testClient>['call'];
let register: ReturnType<typeof testClient>['register'];
beforeAll(async () => {
	test = await createTestEnv();
	env = test.env;
	({ call, register } = testClient(env));
});
afterAll(() => test.dispose());

const T = 1_700_000_000_000;
let n = 0;
const at = (value: unknown, time = T) => ({ value, at: time });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

async function person() {
	const { authenticator, done } = await register();
	return { id: done.body.user.id as string, cookie: done.cookie!, authenticator };
}

/** An open trip of this person's, on the server. */
async function aTrip(cookie: string) {
	const id = ++n;
	const [store, trip] = [`store-${id}`, `trip-${id}`];
	await call('/api/sync/push', {
		cookie,
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
	return trip;
}

async function raw(method: string, path: string, cookie?: string, body?: BodyInit) {
	const headers: Record<string, string> = { Origin: ORIGIN };
	if (cookie) headers.Cookie = cookie;
	if (body !== undefined) headers['Content-Type'] = 'image/jpeg';
	return handleApi(new Request(ORIGIN + path, { method, headers, body }), env);
}
const keep = (photo: string, trip: string, cookie?: string, body: BodyInit = JPEG) =>
	raw('PUT', `/api/kept-photos/${photo}?trip=${trip}`, cookie, body);
const read = (photo: string, cookie?: string) => raw('GET', `/api/kept-photos/${photo}`, cookie);

describe('a kept photo', () => {
	it('is uploaded and read back by the account that took it', async () => {
		const alice = await person();
		const trip = await aTrip(alice.cookie);
		expect((await keep('photo-a', trip, alice.cookie)).status).toBe(201);
		const back = await read('photo-a', alice.cookie);
		expect(back.status).toBe(200);
		expect(back.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([...JPEG]);
	});

	it('needs someone signed in', async () => {
		const alice = await person();
		const trip = await aTrip(alice.cookie);
		expect((await keep('photo-b', trip)).status).toBe(401);
		expect((await read('photo-b')).status).toBe(401);
	});

	it('is only for a trip the account is on, and that the server has', async () => {
		const alice = await person();
		const bob = await person();
		const hers = await aTrip(alice.cookie);
		expect((await keep('photo-c', hers, bob.cookie)).status).toBe(404);
		expect((await keep('photo-c', 'not-synced-yet', alice.cookie)).status).toBe(404);
	});

	it('is not seen by another account, even a partner on the trip', async () => {
		const alice = await person();
		const bob = await person();
		const trip = await aTrip(alice.cookie);
		const made = await call('/api/trips/invite', { cookie: alice.cookie, body: { tripId: trip } });
		const token = new URL(made.body.link).hash.replace('#token=', '');
		await call('/api/trips/join', { cookie: bob.cookie, body: { token } });
		await keep('photo-d', trip, alice.cookie);
		expect((await read('photo-d', bob.cookie)).status).toBe(404);
		// Nor can another account's upload of the same id overwrite it.
		await keep('photo-d', trip, bob.cookie, new Uint8Array([0xff, 0xd8, 0xff, 9]));
		const back = await read('photo-d', alice.cookie);
		expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([...JPEG]);
	});

	it('must be an image', async () => {
		const alice = await person();
		const trip = await aTrip(alice.cookie);
		const reply = await keep('photo-e', trip, alice.cookie, new TextEncoder().encode('<html>'));
		expect(reply.status).toBe(415);
	});

	it('stays when the trip finishes and when it is deleted', async () => {
		const alice = await person();
		const trip = await aTrip(alice.cookie);
		await keep('photo-f', trip, alice.cookie);
		const later = (fields: Record<string, unknown>, time: number) =>
			call('/api/sync/push', {
				cookie: alice.cookie,
				body: {
					changes: [
						{
							table: 'trips',
							id: trip,
							fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, at(v, time)]))
						}
					]
				}
			});
		await later({ status: 'finished', finishedAt: T + 1 }, T + 1);
		expect((await read('photo-f', alice.cookie)).status).toBe(200);
		await later({ deletedAt: T + 2 }, T + 2);
		expect((await read('photo-f', alice.cookie)).status).toBe(200);
	});
});

describe('the cap', () => {
	it(`is ${MAX_PHOTOS_PER_TRIP} kept photos a trip; one of them can still be replaced`, async () => {
		const alice = await person();
		const trip = await aTrip(alice.cookie);
		await env.DB.batch(
			Array.from({ length: MAX_PHOTOS_PER_TRIP }, (_, i) =>
				env.DB.prepare(
					`INSERT INTO kept_photos (user_id, photo_id, trip_id, size, content_type, created_at)
					 VALUES (?, ?, ?, 7, 'image/jpeg', ?)`
				).bind(alice.id, `full-${i}`, trip, T)
			)
		);
		const over = await keep('one-more', trip, alice.cookie);
		expect(over.status).toBe(413);
		expect(await over.json()).toEqual({ error: 'too_many_photos' });
		expect((await keep('full-0', trip, alice.cookie)).status).toBe(201);
		// Another trip has room of its own.
		expect((await keep('one-more', await aTrip(alice.cookie), alice.cookie)).status).toBe(201);
	});
});

describe('deleting the account', () => {
	it('deletes every photo it kept', async () => {
		const alice = await person();
		const trip = await aTrip(alice.cookie);
		await keep('photo-g', trip, alice.cookie);
		await keep('photo-h', trip, alice.cookie);
		const start = await call('/api/account/delete/options', { cookie: alice.cookie, body: {} });
		const credential = await alice.authenticator.get(start.body.options);
		const done = await call('/api/account/delete', {
			cookie: alice.cookie,
			body: { challengeId: start.body.challengeId, credential }
		});
		expect(done.status).toBe(200);
		expect((await env.PHOTOS!.list({ prefix: `users/${alice.id}/` })).objects).toEqual([]);
		const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM kept_photos WHERE user_id = ?')
			.bind(alice.id)
			.first<{ n: number }>();
		expect(rows!.n).toBe(0);
	});
});
