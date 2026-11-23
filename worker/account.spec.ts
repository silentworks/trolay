import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PushedChange } from '../src/lib/sync/schema.ts';
import type { Env } from './env.ts';
import { FakeAuthenticator } from './fake-authenticator.ts';
import { createTestEnv, testClient, type TestEnv } from './testing.ts';

// Deleting an account: only with one of its own passkeys, and then everything it synced goes.

let test: TestEnv;
let env: Env;
let call: ReturnType<typeof testClient>['call'];
let register: ReturnType<typeof testClient>['register'];
let signIn: ReturnType<typeof testClient>['signIn'];
beforeAll(async () => {
	test = await createTestEnv();
	env = test.env;
	({ call, register, signIn } = testClient(env));
});
afterAll(() => test.dispose());

const T = 1_700_000_000_000;
let n = 0;
const uid = (prefix: string) => `${prefix}-${++n}`;
const fields = (values: Record<string, unknown>): PushedChange['fields'] =>
	Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, at: T }]));

interface Person {
	id: string;
	cookie: string;
	authenticator: FakeAuthenticator;
}

async function person(): Promise<Person> {
	const { authenticator, done } = await register();
	return { id: done.body.user.id, cookie: done.cookie!, authenticator };
}

/** A store, a trip at it and an item in it, pushed by this person. */
async function aTrip(who: Person, status: 'open' | 'finished' = 'open') {
	const store = uid('store');
	const trip = uid('trip');
	const item = uid('item');
	const reply = await call('/api/sync/push', {
		cookie: who.cookie,
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
					fields: fields({
						storeId: store,
						status,
						photosKept: false,
						startedAt: T,
						budgetMinor: 5000,
						...(status === 'finished' ? { finishedAt: T, receiptTotalMinor: 145 } : {})
					})
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

async function share(owner: Person, tripId: string, partner: Person) {
	const made = await call('/api/trips/invite', { cookie: owner.cookie, body: { tripId } });
	const token = new URL(made.body.link).hash.replace('#token=', '');
	const joined = await call('/api/trips/join', { cookie: partner.cookie, body: { token } });
	expect(joined.status).toBe(200);
}

/** Asks to delete the account, and answers with this authenticator's passkey. */
async function deleteAccount(cookie: string, authenticator: FakeAuthenticator) {
	const start = await call('/api/account/delete/options', { cookie, body: {} });
	expect(start.status).toBe(200);
	const credential = await authenticator.get(start.body.options);
	return call('/api/account/delete', {
		cookie,
		body: { challengeId: start.body.challengeId, credential }
	});
}

const count = async (sql: string, ...binds: unknown[]) =>
	(await env.DB.prepare(sql)
		.bind(...binds)
		.first<{ n: number }>())!.n;

describe('deleting an account', () => {
	it('needs someone signed in', async () => {
		const options = await call('/api/account/delete/options', { body: {} });
		expect(options.status).toBe(401);
		const done = await call('/api/account/delete', { body: { challengeId: 'x', credential: {} } });
		expect(done.status).toBe(401);
	});

	it("needs one of the account's own passkeys, not another account's", async () => {
		const alice = await person();
		const bob = await person();
		const reply = await deleteAccount(alice.cookie, bob.authenticator);
		expect(reply.status).toBe(401);
		expect(reply.body.error).toBe('verification_failed');
		expect((await call('/api/auth/me', { cookie: alice.cookie })).body.user.id).toBe(alice.id);
	});

	it('is not done by answering a plain sign-in challenge', async () => {
		const alice = await person();
		const start = await call('/api/auth/login/options', { body: {} });
		const credential = await alice.authenticator.get(start.body.options);
		const reply = await call('/api/account/delete', {
			cookie: alice.cookie,
			body: { challengeId: start.body.challengeId, credential }
		});
		expect(reply.status).toBe(400);
		expect((await call('/api/auth/me', { cookie: alice.cookie })).body.user.id).toBe(alice.id);
	});

	it('is not done with a tampered signature', async () => {
		const alice = await person();
		const start = await call('/api/account/delete/options', { cookie: alice.cookie, body: {} });
		const credential = await alice.authenticator.get(start.body.options, { tamper: true });
		const reply = await call('/api/account/delete', {
			cookie: alice.cookie,
			body: { challengeId: start.body.challengeId, credential }
		});
		expect(reply.status).toBe(401);
		expect((await call('/api/auth/me', { cookie: alice.cookie })).body.user.id).toBe(alice.id);
	});

	it('deletes everything it synced, signs out every phone, and leaves others alone', async () => {
		const alice = await person();
		const other = await person();
		const secondPhone = (await signIn(alice.authenticator)).done.cookie!;
		await aTrip(alice);
		await aTrip(alice, 'finished');
		const theirs = await aTrip(other);

		const reply = await deleteAccount(alice.cookie, alice.authenticator);
		expect(reply.status).toBe(200);
		expect(reply.body).toEqual({ deleted: true, passkeys: [alice.authenticator.id] });
		expect(reply.setCookie).toMatch(/Max-Age=0/);

		for (const table of ['stores', 'trips']) {
			expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_id = ?`, alice.id)).toBe(
				0
			);
		}
		for (const table of ['trip_members', 'sessions', 'passkeys', 'challenges']) {
			expect(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, alice.id)).toBe(0);
		}
		expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?', alice.id)).toBe(0);
		expect(
			await count(`SELECT COUNT(*) AS n FROM items WHERE trip_id NOT IN (SELECT id FROM trips)`)
		).toBe(0);

		// Both phones are signed out, and the passkey signs nobody in.
		expect((await call('/api/auth/me', { cookie: alice.cookie })).body.user).toBeNull();
		expect((await call('/api/auth/me', { cookie: secondPhone })).body.user).toBeNull();
		expect((await call('/api/sync/pull', { cookie: secondPhone })).status).toBe(401);
		expect((await signIn(alice.authenticator)).done.status).toBe(401);

		// Another account's things are untouched.
		const pulled = await call('/api/sync/pull', { cookie: other.cookie });
		expect(pulled.body.records.map((r: { id: string }) => r.id).sort()).toEqual(
			[theirs.store, theirs.trip, theirs.item].sort()
		);
	});

	it('takes the partner off a shared trip, and empties what is left of it', async () => {
		const alice = await person();
		const bob = await person();
		const open = await aTrip(alice);
		const finished = await aTrip(alice);
		await share(alice, open.trip, bob);
		await share(alice, finished.trip, bob);
		await call('/api/sync/push', {
			cookie: alice.cookie,
			body: {
				changes: [
					{
						table: 'trips',
						id: finished.trip,
						fields: Object.fromEntries(
							Object.entries({ status: 'finished', finishedAt: T + 1 }).map(([k, v]) => [
								k,
								{ value: v, at: T + 1 }
							])
						)
					}
				]
			}
		});
		await env.PHOTOS!.put(`trips/${open.trip}/photo-1`, new Uint8Array([0xff, 0xd8, 0xff, 0]));
		const before = (await call('/api/sync/pull', { cookie: bob.cookie })).body.cursor;

		expect((await deleteAccount(alice.cookie, alice.authenticator)).status).toBe(200);

		// Bob's phone is told he is off both trips, as when he is taken off one.
		const pulled = await call(`/api/sync/pull?since=${before}`, { cookie: bob.cookie });
		expect(pulled.body.left).toEqual(
			expect.arrayContaining([
				{ tripId: open.trip, storeId: open.store },
				{ tripId: finished.trip, storeId: finished.store }
			])
		);
		expect(pulled.body.records).toEqual([]);

		// What stays is ids and dates: no names, prices, totals, items or photos.
		const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?')
			.bind(open.trip)
			.first<Record<string, unknown>>();
		expect(trip).toMatchObject({ budget_minor: null, totals: null, field_times: '{}' });
		expect(trip!.deleted_at).not.toBeNull();
		const store = await env.DB.prepare('SELECT name, branch FROM stores WHERE id = ?')
			.bind(open.store)
			.first();
		expect(store).toEqual({ name: '', branch: null });
		expect(await count('SELECT COUNT(*) AS n FROM items WHERE trip_id = ?', open.trip)).toBe(0);
		expect((await env.PHOTOS!.list({ prefix: `trips/${open.trip}/` })).objects).toEqual([]);
		expect(
			await count(
				'SELECT COUNT(*) AS n FROM users WHERE id = ? AND email IS NULL AND deleted_at IS NOT NULL',
				alice.id
			)
		).toBe(1);
		expect(await count('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', alice.id)).toBe(0);

		// Bob's own account works as before.
		expect((await call('/api/auth/me', { cookie: bob.cookie })).body.user.id).toBe(bob.id);
		expect((await aTrip(bob)).trip).toBeTruthy();
	});

	it("as a partner, leaves the owner's trip with the items it added", async () => {
		const alice = await person();
		const bob = await person();
		const mine = await aTrip(alice);
		await share(alice, mine.trip, bob);
		const bread = uid('item');
		await call('/api/sync/push', {
			cookie: bob.cookie,
			body: {
				changes: [
					{
						table: 'items',
						id: bread,
						fields: fields({
							tripId: mine.trip,
							description: 'Bread',
							unitPriceMinor: 95,
							priceIncludesTax: true,
							quantity: 1,
							edited: false,
							createdAt: T
						})
					}
				]
			}
		});

		expect((await deleteAccount(bob.cookie, bob.authenticator)).status).toBe(200);

		const members = await call(`/api/trips/members?trip=${mine.trip}`, { cookie: alice.cookie });
		expect(members.body.members).toHaveLength(1);
		const pulled = await call('/api/sync/pull', { cookie: alice.cookie });
		expect(pulled.body.records.map((r: { id: string }) => r.id)).toContain(bread);
		expect(await count('SELECT COUNT(*) AS n FROM users WHERE id = ?', bob.id)).toBe(0);
	});
});
