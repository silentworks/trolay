import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleApi } from './api.ts';
import type { Env } from './env.ts';
import { createTestEnv, type TestEnv } from './testing.ts';

let test: TestEnv;
let env: Env;
beforeAll(async () => {
	test = await createTestEnv();
	env = test.env;
});
afterAll(() => test.dispose());

const call = (path: string, method = 'GET') =>
	handleApi(new Request(`https://trolay.test${path}`, { method }), env);

describe('the API', () => {
	it('answers /api/health from the database', async () => {
		const response = await call('/api/health');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(response.headers.get('Cache-Control')).toBe('no-store');
	});

	it('answers unknown paths with 404 and wrong methods with 405', async () => {
		expect((await call('/api/nope')).status).toBe(404);
		const wrong = await call('/api/health', 'DELETE');
		expect(wrong.status).toBe(405);
		expect(wrong.headers.get('Allow')).toBe('GET');
	});
});

describe('the schema', () => {
	const columns = async (table: string) =>
		(await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()).results.map(
			(column) => column.name
		);

	it('has the five tables, each with the sync columns', async () => {
		for (const table of ['users', 'stores', 'trips', 'trip_members', 'items']) {
			expect(await columns(table), table).toEqual(
				expect.arrayContaining(['updated_at', 'updated_by', 'deleted_at'])
			);
		}
	});

	it('stores a user, a store, a trip, its members and an item', async () => {
		const now = Date.now();
		await env.DB.batch([
			env.DB.prepare(
				'INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)'
			).bind('u1', 'a@example.com', now, now),
			env.DB.prepare(
				'INSERT INTO stores (id, owner_id, name, tax_rate_bps, prices_include_tax, created_at, last_used_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			).bind('s1', 'u1', 'Tesco', 2000, 1, now, now, now),
			env.DB.prepare(
				"INSERT INTO trips (id, owner_id, store_id, status, started_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)"
			).bind('t1', 'u1', 's1', now, now),
			env.DB.prepare(
				"INSERT INTO trip_members (trip_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)"
			).bind('t1', 'u1', now, now),
			env.DB.prepare(
				'INSERT INTO items (id, trip_id, description, unit_price_minor, price_includes_tax, quantity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			).bind('i1', 't1', 'Milk', 150, 1, 2, now, now)
		]);
		const item = await env.DB.prepare(
			'SELECT description, quantity, deleted_at FROM items WHERE trip_id = ?'
		)
			.bind('t1')
			.first();
		expect(item).toEqual({ description: 'Milk', quantity: 2, deleted_at: null });
	});

	it('refuses what the app would never send', async () => {
		const now = Date.now();
		const insert = (sql: string, ...values: unknown[]) =>
			env.DB.prepare(sql)
				.bind(...values)
				.run();
		// An unknown trip status, a trip for a store that does not exist, a second owner row.
		await expect(
			insert(
				"INSERT INTO trips (id, owner_id, store_id, status, started_at, updated_at) VALUES ('t2', 'u1', 's1', 'paused', ?, ?)",
				now,
				now
			)
		).rejects.toThrow();
		await expect(
			insert(
				"INSERT INTO trips (id, owner_id, store_id, status, started_at, updated_at) VALUES ('t3', 'u1', 'nope', 'open', ?, ?)",
				now,
				now
			)
		).rejects.toThrow();
		await expect(
			insert(
				"INSERT INTO trip_members (trip_id, user_id, role, created_at, updated_at) VALUES ('t1', 'u1', 'owner', ?, ?)",
				now,
				now
			)
		).rejects.toThrow();
	});
});
