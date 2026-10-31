import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import { createTestEnv, testClient, type TestEnv } from './testing.ts';

// The live connection's door: who may listen to a trip. The socket itself is a Durable Object,
// which the end-to-end tests exercise against a real local Worker.

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

async function aTrip(status = 'open') {
	const id = ++n;
	const [store, trip] = [`store-${id}`, `trip-${id}`];
	const at = (value: unknown) => ({ value, at: T });
	const reply = await call('/api/sync/push', {
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
						status: at(status),
						photosKept: at(false),
						startedAt: at(T)
					}
				}
			]
		}
	});
	expect(reply.status).toBe(200);
	return trip;
}

const live = (
	cookie: string | undefined,
	trip: string,
	headers: Record<string, string> = {},
	origin?: string
) => call(`/api/trips/live?trip=${trip}`, { cookie, headers, origin });
const socket = { Upgrade: 'websocket' };

describe('the live connection', () => {
	it('is only for a signed-in member of an open trip', async () => {
		const trip = await aTrip();
		expect((await live(undefined, trip, socket)).status).toBe(401);
		expect(await live(bob, trip, socket)).toMatchObject({
			status: 404,
			body: { error: 'trip_not_found' }
		});
		expect((await live(alice, 'no-such-trip', socket)).status).toBe(404);
		expect((await live(alice, 'bad id!', socket)).status).toBe(400);
		const finished = await aTrip('finished');
		expect(await live(alice, finished, socket)).toMatchObject({
			status: 409,
			body: { error: 'trip_finished' }
		});
	});

	it('refuses a handshake from another site, since cookies go with it', async () => {
		const trip = await aTrip();
		expect(await live(alice, trip, socket, 'https://evil.test')).toMatchObject({
			status: 403,
			body: { error: 'cross_site' }
		});
	});

	it('needs a WebSocket upgrade', async () => {
		const trip = await aTrip();
		expect((await live(alice, trip)).status).toBe(426);
	});

	it('lets a partner in, and a stranger not', async () => {
		const trip = await aTrip();
		const made = await call('/api/trips/invite', { cookie: alice, body: { tripId: trip } });
		const token = new URL(made.body.link).hash.replace('#token=', '');
		await call('/api/trips/join', { cookie: bob, body: { token } });
		// Without a room a member gets as far as the door.
		expect((await live(bob, trip, socket)).status).toBe(503);
		expect((await live(carol, trip, socket)).status).toBe(404);
	});
});
