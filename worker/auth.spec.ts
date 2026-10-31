import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import { FakeAuthenticator } from './fake-authenticator.ts';
import { createTestEnv, ORIGIN, RP_ID, testClient, type TestEnv } from './testing.ts';

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

describe('registering with a passkey', () => {
	it('makes an account and signs in, with an HttpOnly Secure SameSite cookie', async () => {
		const { done } = await register();
		expect(done.status).toBe(201);
		expect(done.body.user.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(done.setCookie).toMatch(/^__Host-session=[\w-]{40,};/);
		for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) {
			expect(done.setCookie).toContain(attribute);
		}
		expect(done.setCookie).not.toContain('Domain');

		const me = await call('/api/auth/me', { cookie: done.cookie });
		expect(me.body).toEqual({ user: { id: done.body.user.id } });
	});

	it('stores only a hash of the session token', async () => {
		const { done } = await register();
		const token = done.cookie!.split('=')[1];
		const rows = await env.DB.prepare('SELECT token_hash FROM sessions').all<{
			token_hash: string;
		}>();
		expect(rows.results.length).toBeGreaterThan(0);
		expect(rows.results.some((row) => row.token_hash === token)).toBe(false);
	});

	it('uses a challenge only once', async () => {
		const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
		const start = await call('/api/auth/register/options', { method: 'POST', body: {} });
		const credential = await authenticator.create(start.body.options);
		const body = { challengeId: start.body.challengeId, credential };
		expect((await call('/api/auth/register/verify', { body })).status).toBe(201);
		const replay = await call('/api/auth/register/verify', { body });
		expect(replay.status).toBe(400);
		expect(replay.body.error).toBe('challenge_expired');
	});

	it('refuses an expired challenge', async () => {
		const authenticator = new FakeAuthenticator(RP_ID, ORIGIN);
		const start = await call('/api/auth/register/options', { method: 'POST', body: {} });
		await env.DB.prepare('UPDATE challenges SET expires_at = ? WHERE id = ?')
			.bind(Date.now() - 1, start.body.challengeId)
			.run();
		const credential = await authenticator.create(start.body.options);
		const done = await call('/api/auth/register/verify', {
			body: { challengeId: start.body.challengeId, credential }
		});
		expect(done.status).toBe(400);
	});

	it('accepts a passkey from an authenticator that never verifies the user, to make and to use', async () => {
		const authenticator = new FakeAuthenticator(RP_ID, ORIGIN, false);
		const made = await register(authenticator);
		expect(made.done.status).toBe(201);
		const again = await signIn(authenticator);
		expect(again.done.status).toBe(200);
		expect(again.done.body.user.id).toBe(made.done.body.user.id);
		expect(again.done.cookie).toBeDefined();
	});

	it('still refuses a passkey made for another site', async () => {
		const start = await call('/api/auth/register/options', { method: 'POST', body: {} });
		const credential = await new FakeAuthenticator(RP_ID, ORIGIN).create(start.body.options, {
			origin: 'https://evil.test'
		});
		const done = await call('/api/auth/register/verify', {
			body: { challengeId: start.body.challengeId, credential }
		});
		expect(done.status).toBe(400);
		expect(done.body.error).toBe('verification_failed');
		expect(done.setCookie).toBeUndefined();
	});

	it('adds a second passkey to the account you are signed in to', async () => {
		const first = await register();
		const second = new FakeAuthenticator(RP_ID, ORIGIN);
		const { start, done } = await register(second, first.done.cookie);
		// The first device is excluded, so it is not offered again.
		expect(start.body.options.excludeCredentials.map((key: { id: string }) => key.id)).toEqual([
			first.authenticator.id
		]);
		expect(done.status).toBe(200);
		expect(done.body.user.id).toBe(first.done.body.user.id);
		const keys = await env.DB.prepare('SELECT id FROM passkeys WHERE user_id = ?')
			.bind(first.done.body.user.id)
			.all();
		expect(keys.results).toHaveLength(2);
	});
});

describe('signing in with a passkey', () => {
	it('starts a session and moves the counter on', async () => {
		const { authenticator, done: registered } = await register();
		const { done } = await signIn(authenticator);
		expect(done.status).toBe(200);
		expect(done.body.user.id).toBe(registered.body.user.id);
		expect(done.cookie).not.toBe(registered.cookie);
		const key = await env.DB.prepare('SELECT counter, last_used_at FROM passkeys WHERE id = ?')
			.bind(authenticator.id)
			.first<{ counter: number; last_used_at: number }>();
		expect(key!.counter).toBe(1);
		expect(key!.last_used_at).toBeGreaterThan(0);
	});

	it('refuses a tampered signature, a wrong origin and an unknown passkey', async () => {
		const { authenticator } = await register();
		const tampered = await signIn(authenticator, { tamper: true });
		expect(tampered.done.status).toBe(401);
		expect(tampered.done.setCookie).toBeUndefined();
		expect((await signIn(authenticator, { origin: 'https://evil.test' })).done.status).toBe(401);
		const stranger = new FakeAuthenticator(RP_ID, ORIGIN);
		expect((await signIn(stranger)).done.status).toBe(401);
	});

	it('refuses a replayed sign-in', async () => {
		const { authenticator } = await register();
		const { start, credential } = await signIn(authenticator);
		const replay = await call('/api/auth/login/verify', {
			body: { challengeId: start.body.challengeId, credential }
		});
		expect(replay.status).toBe(400);
	});

	it('does not accept a registration challenge for signing in', async () => {
		const { authenticator, start } = await register();
		const credential = await authenticator.get(start.body.options);
		const done = await call('/api/auth/login/verify', {
			body: { challengeId: start.body.challengeId, credential }
		});
		expect(done.status).toBe(400);
	});
});

describe('sessions', () => {
	it('end on sign out, on this device only', async () => {
		const { authenticator, done: first } = await register();
		const other = await signIn(authenticator);
		const out = await call('/api/auth/logout', { method: 'POST', body: {}, cookie: first.cookie });
		expect(out.setCookie).toContain('Max-Age=0');
		expect((await call('/api/auth/me', { cookie: first.cookie })).body).toEqual({ user: null });
		expect((await call('/api/auth/me', { cookie: other.done.cookie })).body.user).not.toBeNull();
	});

	it('are refused once expired', async () => {
		const { done } = await register();
		await env.DB.prepare('UPDATE sessions SET expires_at = ?')
			.bind(Date.now() - 1)
			.run();
		expect((await call('/api/auth/me', { cookie: done.cookie })).body).toEqual({ user: null });
	});

	it('are not there without a cookie', async () => {
		expect((await call('/api/auth/me')).body).toEqual({ user: null });
		expect((await call('/api/auth/me', { cookie: '__Host-session=nonsense' })).body).toEqual({
			user: null
		});
	});
});

describe('requests', () => {
	it('from another site are refused', async () => {
		const reply = await call('/api/auth/login/options', {
			method: 'POST',
			body: {},
			origin: 'https://evil.test'
		});
		expect(reply.status).toBe(403);
	});

	it('must be JSON', async () => {
		const reply = await call('/api/auth/login/verify', { body: {}, type: 'text/plain' });
		expect(reply.status).toBe(400);
		expect(reply.body.error).toBe('expected_json');
	});
});
