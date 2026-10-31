import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushedChange } from '../src/lib/sync/schema.ts';
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
const uid = (prefix: string) => `${prefix}-${++n}`;

const fields = (values: Record<string, unknown>): PushedChange['fields'] =>
	Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, at: T }]));

/** Alice's store with an open trip holding one item, pushed through sync. */
async function aTrip(cookie = alice, status = 'open') {
	const store = uid('store');
	const trip = uid('trip');
	const item = uid('item');
	const reply = await call('/api/sync/push', {
		cookie,
		body: {
			changes: [
				{
					table: 'stores',
					id: store,
					fields: fields({
						name: 'Tesco',
						branch: 'Watford',
						taxRateBps: 2000,
						pricesIncludeTax: true,
						createdAt: T,
						lastUsedAt: T
					})
				},
				{
					table: 'trips',
					id: trip,
					fields: fields({ storeId: store, status, photosKept: false, startedAt: T })
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
			]
		}
	});
	expect(reply.body.results.map((r: { status: string }) => r.status)).toEqual(['ok', 'ok', 'ok']);
	return { store, trip, item };
}

const invite = (cookie: string | undefined, tripId: unknown) =>
	call('/api/trips/invite', { body: { tripId }, cookie });
const join = (cookie: string | undefined, token: unknown) =>
	call('/api/trips/join', { body: { token }, cookie });
const tokenOf = (link: string) => new URL(link).hash.replace('#token=', '');

const members = async (tripId: string) =>
	(
		await env.DB.prepare(
			'SELECT user_id, role, deleted_at FROM trip_members WHERE trip_id = ? ORDER BY role'
		)
			.bind(tripId)
			.all()
	).results;

describe('inviting a partner', () => {
	it('makes a link for an open trip of yours, with the token in the fragment', async () => {
		const { trip } = await aTrip();
		const reply = await invite(alice, trip);
		expect(reply.status).toBe(201);
		expect(reply.body.link).toMatch(/^https:\/\/trolay\.test\/join#token=[\w-]{20,}$/);
		expect(reply.body.expiresAt).toBeGreaterThan(Date.now());
	});

	it('needs a signed-in user, and a trip that is theirs, open and known to the server', async () => {
		const { trip } = await aTrip();
		expect((await invite(undefined, trip)).status).toBe(401);
		// Not the owner: told the trip is not found, as for one that does not exist.
		expect(await invite(bob, trip)).toMatchObject({
			status: 404,
			body: { error: 'trip_not_found' }
		});
		expect(await invite(alice, 'no-such-trip')).toMatchObject({ status: 404 });
		expect((await invite(alice, { $: 1 })).status).toBe(400);

		const finished = await aTrip(alice, 'finished');
		expect(await invite(alice, finished.trip)).toMatchObject({
			status: 409,
			body: { error: 'trip_finished' }
		});
	});

	it('keeps only the newest link for a trip', async () => {
		const { trip } = await aTrip();
		const first = tokenOf((await invite(alice, trip)).body.link);
		const second = tokenOf((await invite(alice, trip)).body.link);
		expect(await join(bob, first)).toMatchObject({
			status: 400,
			body: { error: 'invite_invalid' }
		});
		expect((await join(bob, second)).status).toBe(200);
	});

	it('stores only a hash of the token', async () => {
		const { trip } = await aTrip();
		const token = tokenOf((await invite(alice, trip)).body.link);
		const rows = (
			await env.DB.prepare('SELECT * FROM trip_invites WHERE trip_id = ?').bind(trip).all()
		).results;
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain(token);
	});
});

describe('accepting an invite', () => {
	it('adds the signed-in person as the trip’s partner, once', async () => {
		const { trip } = await aTrip();
		const token = tokenOf((await invite(alice, trip)).body.link);
		const reply = await join(bob, token);
		expect(reply).toMatchObject({
			status: 200,
			body: { tripId: trip, store: { name: 'Tesco', branch: 'Watford' } }
		});
		expect(await members(trip)).toMatchObject([
			{ role: 'owner', deleted_at: null },
			{ role: 'partner', deleted_at: null }
		]);
		// The link is used up.
		expect(await join(carol, token)).toMatchObject({
			status: 400,
			body: { error: 'invite_invalid' }
		});
	});

	it('refuses a second partner with a clear reason, and an invite for a full trip', async () => {
		const { trip } = await aTrip();
		const first = tokenOf((await invite(alice, trip)).body.link);
		const later = tokenOf((await invite(alice, trip)).body.link);
		expect((await join(bob, later)).status).toBe(200);
		expect(await invite(alice, trip)).toMatchObject({ status: 409, body: { error: 'trip_full' } });
		// A link made before the partner joined no longer works for anyone else.
		expect(await join(carol, first)).toMatchObject({ status: 400 });
		expect(await members(trip)).toHaveLength(2);
	});

	it('lets only one of two people accepting the same link in', async () => {
		const { trip } = await aTrip();
		const token = tokenOf((await invite(alice, trip)).body.link);
		const [a, b] = await Promise.all([join(bob, token), join(carol, token)]);
		expect([a.status, b.status].sort()).toEqual([200, 409]);
		expect(await members(trip)).toHaveLength(2);
	});

	it('needs a signed-in person, and not the owner', async () => {
		const { trip } = await aTrip();
		const token = tokenOf((await invite(alice, trip)).body.link);
		expect(await join(undefined, token)).toMatchObject({ status: 401 });
		expect(await join(alice, token)).toMatchObject({ status: 400, body: { error: 'own_trip' } });
		expect(await members(trip)).toHaveLength(1);
		// Neither attempt used the link up.
		expect((await join(bob, token)).status).toBe(200);
	});

	it('refuses an unknown or malformed token, an expired link, and a trip that has finished', async () => {
		expect((await join(bob, 'nonsense')).status).toBe(400);
		expect((await join(bob, 5)).status).toBe(400);
		expect((await join(bob, 'x'.repeat(201))).status).toBe(400);

		const expired = await aTrip();
		const old = tokenOf((await invite(alice, expired.trip)).body.link);
		await env.DB.prepare('UPDATE trip_invites SET expires_at = ? WHERE trip_id = ?')
			.bind(Date.now() - 1, expired.trip)
			.run();
		expect(await join(bob, old)).toMatchObject({ status: 400, body: { error: 'invite_invalid' } });

		const open = await aTrip();
		const token = tokenOf((await invite(alice, open.trip)).body.link);
		await call('/api/sync/push', {
			cookie: alice,
			body: {
				changes: [
					{ table: 'trips', id: open.trip, fields: { status: { value: 'finished', at: T + 1000 } } }
				]
			}
		});
		expect(await join(bob, token)).toMatchObject({ status: 409, body: { error: 'trip_finished' } });
	});

	it('puts the trip and its items after every position, so the partner’s phone pulls them', async () => {
		const { trip, item, store } = await aTrip();
		const before = (await call('/api/sync/pull?since=0', { cookie: alice })).body.cursor;
		const token = tokenOf((await invite(alice, trip)).body.link);
		await join(bob, token);
		// Bob's phone, up to date as of now, is told about the trip, its item and its store.
		const pulled = await call(`/api/sync/pull?since=${before}`, { cookie: bob });
		expect(pulled.body.records.map((r: { id: string }) => r.id).sort()).toEqual(
			[item, store, trip].sort()
		);
	});

	it('does not hand the partner anything else of the owner’s', async () => {
		const other = await aTrip();
		const { trip } = await aTrip();
		await join(bob, tokenOf((await invite(alice, trip)).body.link));
		const pulled = await call('/api/sync/pull?since=0', { cookie: bob });
		const ids = pulled.body.records.map((r: { id: string }) => r.id);
		expect(ids).toContain(trip);
		expect(ids).not.toContain(other.trip);
		expect(ids).not.toContain(other.item);
	});
});

describe('the invite endpoints', () => {
	it('refuse requests from another site', async () => {
		const { trip } = await aTrip();
		expect(
			(
				await call('/api/trips/invite', {
					body: { tripId: trip },
					cookie: alice,
					origin: 'https://evil.test'
				})
			).status
		).toBe(403);
	});
});
