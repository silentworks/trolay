import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CEREMONIES_PER_HOUR, CEREMONIES_PER_SOURCE_HOUR } from './auth/passkeys.ts';
import type { Env } from './env.ts';
import { sha256 } from './auth/tokens.ts';
import { HOUR, sourceOf } from './rate.ts';
import { MAX_ITEMS_PER_TRIP, MAX_STORES } from './sync/push.ts';
import { createTestEnv, ORIGIN, testClient, type TestEnv } from './testing.ts';
import { handleApi } from './api.ts';
import { MAX_PHOTOS_PER_TRIP } from './trips/photos.ts';

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
const at = (value: unknown) => ({ value, at: T });
const options = (ip: string, path = '/api/auth/login/options') =>
	call(path, { body: {}, headers: { 'CF-Connecting-IP': ip } });
/** `count` rows put straight into a table in one statement; `i` in the values counts from 0. */
const fill = (count: number, insert: string, values: string, ...binds: unknown[]) =>
	env.DB.prepare(
		`${insert} WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		 SELECT ${values} FROM n`
	)
		.bind(count - 1, ...binds)
		.run();

/** A source's ceremonies, all but `left` of its hour's allowance, as if already started. */
const used = async (ip: string, left = 1) =>
	fill(
		CEREMONIES_PER_SOURCE_HOUR - left,
		'INSERT INTO rate_events (key, at)',
		'?, ?',
		`ceremony:${await sha256(sourceOf(ip))}`,
		Date.now()
	);

describe('starting a passkey ceremony', () => {
	it('is limited per source each hour, signing in and signing up alike', async () => {
		await used('203.0.113.1', 2);
		expect((await options('203.0.113.1', '/api/auth/register/options')).status).toBe(200);
		expect((await options('203.0.113.1')).status).toBe(200);
		const refused = await options('203.0.113.1');
		expect(refused.status).toBe(429);
		expect(refused.body.error).toBe('too_many_requests');
		expect((await options('203.0.113.1', '/api/auth/register/options')).status).toBe(429);
		// Another source is not held up; and an hour on, this one can go again.
		expect((await options('203.0.113.2')).status).toBe(200);
		await env.DB.prepare('UPDATE rate_events SET at = at - ?').bind(HOUR).run();
		expect((await options('203.0.113.1')).status).toBe(200);
	});

	it('counts an IPv6 source by its /64, however the address is written', async () => {
		expect(sourceOf('2001:db8:0:1:aaaa::1')).toBe('2001:db8:0:1::/64');
		expect(sourceOf('2001:DB8:0000:0001:ffff:1:2:3')).toBe('2001:db8:0:1::/64');
		expect(sourceOf('2001:db8::')).toBe('2001:db8:0:0::/64');
		expect(sourceOf('::1')).toBe('0:0:0:0::/64');
		expect(sourceOf('203.0.113.9')).toBe('203.0.113.9');
		expect(sourceOf(null)).toBe('unknown');
		// Addresses all over one /64 share its allowance.
		await used('2001:db8:5:6::1', 2);
		expect((await options('2001:db8:5:6:aaaa::7')).status).toBe(200);
		expect((await options('2001:0db8:0005:0006:ffff:1:2:3')).status).toBe(200);
		expect((await options('2001:db8:5:6:ffff::9')).status).toBe(429);
		expect((await options('2001:db8:5:7::1')).status).toBe(200);
	});

	it('is limited over everyone too', async () => {
		await env.DB.prepare('DELETE FROM rate_events').run();
		await fill(
			CEREMONIES_PER_HOUR - 1,
			'INSERT INTO rate_events (key, at)',
			"'ceremony', ?",
			Date.now()
		);
		expect((await options('203.0.113.50')).status).toBe(200);
		expect((await options('203.0.113.51')).status).toBe(429);
		await env.DB.prepare('DELETE FROM rate_events').run();
	});
});

describe('how much one account can keep', () => {
	it('is a ceiling on stores, and on items in a trip', async () => {
		const { done } = await register();
		const cookie = done.cookie!;
		const owner = done.body.user.id;
		await fill(
			MAX_STORES - 1,
			`INSERT INTO stores (id, owner_id, name, tax_rate_bps, prices_include_tax, created_at,
			   last_used_at, updated_at)`,
			"'filler-store-' || i, ?, 'Shop', 0, 1, 0, 0, 0",
			owner
		);
		const store = (id: string) => ({
			table: 'stores',
			id,
			fields: {
				name: at('Tesco'),
				taxRateBps: at(0),
				pricesIncludeTax: at(true),
				createdAt: at(T),
				lastUsedAt: at(T)
			}
		});
		const trip = {
			table: 'trips',
			id: 'full-trip',
			fields: {
				storeId: at('last-store'),
				status: at('open'),
				photosKept: at(false),
				startedAt: at(T)
			}
		};
		const pushed = await call('/api/sync/push', {
			cookie,
			body: { changes: [store('last-store'), store('one-too-many'), trip] }
		});
		expect(pushed.body.results.map((r: { status: string; reason?: string }) => r.reason)).toEqual([
			undefined,
			'limit',
			undefined
		]);
		// A store it already has can still be changed.
		const renamed = await call('/api/sync/push', {
			cookie,
			body: { changes: [{ table: 'stores', id: 'last-store', fields: { name: at('Aldi') } }] }
		});
		expect(renamed.body.results[0].status).toBe('ok');

		await fill(
			MAX_ITEMS_PER_TRIP,
			`INSERT INTO items (id, trip_id, description, unit_price_minor, price_includes_tax, quantity,
			   created_at, updated_at)`,
			"'filler-item-' || i, 'full-trip', 'Milk', 100, 1, 1, 0, 0"
		);
		const item = await call('/api/sync/push', {
			cookie,
			body: {
				changes: [
					{
						table: 'items',
						id: 'item-too-many',
						fields: {
							tripId: at('full-trip'),
							description: at('Bread'),
							unitPriceMinor: at(100),
							priceIncludesTax: at(true),
							quantity: at(1),
							edited: at(false),
							createdAt: at(T)
						}
					}
				]
			}
		});
		expect(item.body.results[0]).toMatchObject({ status: 'rejected', reason: 'limit' });
	});
});

describe('photos on a trip', () => {
	it('stop at a ceiling, though one the trip has can be replaced', async () => {
		const { done } = await register();
		const cookie = done.cookie!;
		await call('/api/sync/push', {
			cookie,
			body: {
				changes: [
					{
						table: 'stores',
						id: 'photo-store',
						fields: {
							name: at('Tesco'),
							taxRateBps: at(0),
							pricesIncludeTax: at(true),
							createdAt: at(T),
							lastUsedAt: at(T)
						}
					},
					{
						table: 'trips',
						id: 'photo-trip',
						fields: {
							storeId: at('photo-store'),
							status: at('open'),
							photosKept: at(false),
							startedAt: at(T)
						}
					}
				]
			}
		});
		for (let i = 0; i < MAX_PHOTOS_PER_TRIP; i++) {
			await env.PHOTOS!.put(`trips/photo-trip/held-${i}`, 'x', {
				customMetadata: { by: done.body.user.id }
			});
		}
		const put = (photo: string) =>
			handleApi(
				new Request(`${ORIGIN}/api/trips/photo-trip/photos/${photo}`, {
					method: 'PUT',
					headers: { Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'image/jpeg' },
					body: new Uint8Array([0xff, 0xd8, 0xff, 1])
				}),
				env
			);
		const refused = await put('one-more');
		expect(refused.status).toBe(413);
		expect(await refused.json()).toEqual({ error: 'too_many_photos' });
		expect((await put('held-3')).status).toBe(201);
	});
});
