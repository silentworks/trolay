import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from './env.ts';
import { capturedMail } from './mail.ts';
import { createTestEnv, testClient, type TestEnv } from './testing.ts';

let test: TestEnv;
let env: Env;
let call: ReturnType<typeof testClient>['call'];
let register: ReturnType<typeof testClient>['register'];
beforeAll(async () => {
	test = await createTestEnv();
	// Emails are kept in memory here instead of being sent.
	env = { ...test.env, MAIL_MODE: 'capture' };
	({ call, register } = testClient(env));
});
afterAll(() => test.dispose());

let counter = 0;
/** A different address each time, and a different "source", so the rate limits stay out of the way. */
const fresh = () => ({
	email: `person${++counter}@example.com`,
	headers: { 'CF-Connecting-IP': `10.0.0.${counter}` }
});

async function request(
	email: string,
	extra: { headers?: Record<string, string>; cookie?: string } = {}
) {
	return call('/api/auth/link/request', { body: { email }, ...extra });
}

/** The token from the link in the latest email to this address. */
function tokenFor(email: string): string {
	const mail = capturedMail(email).at(-1)!;
	return new URL(mail.text.match(/https?:\S+/)![0]).hash.replace('#token=', '');
}

const verify = (token: string, cookie?: string) =>
	call('/api/auth/link/verify', { body: { token }, cookie });

describe('asking for a link', () => {
	it('emails a link with the token in the fragment, and keeps only its hash', async () => {
		const { email, headers } = fresh();
		const reply = await request(email, { headers });
		expect(reply.status).toBe(202);
		const mail = capturedMail(email).at(-1)!;
		expect(mail.subject).toBe('Your Trolay sign-in link');
		expect(mail.text).toMatch(
			/^Open this link[\s\S]*https:\/\/trolay\.test\/account\/link#token=[\w-]{40,}/
		);
		expect(mail.text).toContain('15 minutes');
		expect(mail.html).toContain('href="https://trolay.test/account/link#token=');
		const rows = await env.DB.prepare('SELECT token_hash FROM login_tokens WHERE email = ?')
			.bind(email)
			.all<{ token_hash: string }>();
		expect(rows.results).toHaveLength(1);
		expect(rows.results[0].token_hash).not.toBe(tokenFor(email));
	});

	it('answers the same for an address with an account and one without', async () => {
		const known = fresh();
		await request(known.email, known);
		await verify(tokenFor(known.email));
		// Let the one-a-minute limit pass, so the two requests differ only in the address.
		await env.DB.prepare('UPDATE login_tokens SET created_at = created_at - 120000').run();
		const unknown = fresh();
		const a = await request(known.email, known);
		const b = await request(unknown.email, unknown);
		expect([a.status, a.body]).toEqual([b.status, b.body]);
		expect(a.status).toBe(202);
	});

	it('refuses an address that is not one', async () => {
		for (const email of ['', 'nope', 'a@b', 'a b@c.com', 'x'.repeat(300) + '@example.com', 42]) {
			const reply = await call('/api/auth/link/request', { body: { email } });
			expect(reply.status, String(email)).toBe(400);
			expect(reply.body.error).toBe('invalid_email');
		}
	});

	it('does not send a second link within a minute, nor more than five an hour', async () => {
		const { email, headers } = fresh();
		const older = () =>
			env.DB.prepare('UPDATE login_tokens SET created_at = created_at - 120000 WHERE email = ?')
				.bind(email)
				.run();
		expect((await request(email, { headers })).status).toBe(202);
		expect((await request(email, { headers })).status).toBe(429);
		// Four more, a couple of minutes apart, make five in the hour; the sixth is refused.
		for (let i = 0; i < 4; i++) {
			await older();
			expect((await request(email, { headers })).status).toBe(202);
		}
		await older();
		expect((await request(email, { headers })).status).toBe(429);
	});

	it('limits how many one source can ask for', async () => {
		const headers = { 'CF-Connecting-IP': '203.0.113.9' };
		for (let i = 0; i < 10; i++)
			expect((await request(fresh().email, { headers })).status).toBe(202);
		expect((await request(fresh().email, { headers })).status).toBe(429);
	});

	it('sends through the email binding, from the configured address', async () => {
		const sent: unknown[] = [];
		const live = testClient({
			...test.env,
			MAIL_FROM: 'Trolay <signin@trolay.test>',
			EMAIL: { send: async (message) => (sent.push(message), { messageId: 'm1' }) }
		});
		const { email, headers } = fresh();
		expect((await live.call('/api/auth/link/request', { body: { email }, headers })).status).toBe(
			202
		);
		expect(sent).toEqual([
			expect.objectContaining({
				from: 'Trolay <signin@trolay.test>',
				to: email,
				subject: 'Your Trolay sign-in link',
				text: expect.stringContaining('/account/link#token='),
				html: expect.stringContaining('/account/link#token=')
			})
		]);
	});

	it('says so, and keeps no link, when the email cannot be sent', async () => {
		const broken = testClient({
			...test.env,
			MAIL_FROM: 'Trolay <signin@trolay.test>',
			EMAIL: {
				send: async () => {
					throw Object.assign(new Error('Sender domain not verified'), {
						code: 'E_SENDER_NOT_VERIFIED'
					});
				}
			}
		});
		const { email, headers } = fresh();
		const reply = await broken.call('/api/auth/link/request', { body: { email }, headers });
		expect(reply.status).toBe(502);
		expect(reply.body.error).toBe('email_failed');
		const rows = await env.DB.prepare('SELECT 1 FROM login_tokens WHERE email = ?')
			.bind(email)
			.all();
		expect(rows.results).toHaveLength(0);
	});

	it('says so when sending is not set up at all', async () => {
		const unset = testClient({ DB: test.env.DB });
		const { email, headers } = fresh();
		expect((await unset.call('/api/auth/link/request', { body: { email }, headers })).status).toBe(
			502
		);
	});
});

describe('opening a link', () => {
	it('signs in, creating the account the first time, and works only once', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const token = tokenFor(email);

		const first = await verify(token);
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ created: true, hasPasskey: false });
		expect(first.setCookie).toMatch(/^__Host-session=.*HttpOnly.*Secure.*SameSite=Lax/);
		expect((await call('/api/auth/me', { cookie: first.cookie })).body.user.id).toBe(
			first.body.user.id
		);

		const again = await verify(token);
		expect(again.status).toBe(400);
		expect(again.body.error).toBe('link_invalid');
		expect(again.setCookie).toBeUndefined();
	});

	it('signs in to the same account next time', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const first = await verify(tokenFor(email));
		await env.DB.prepare('UPDATE login_tokens SET created_at = created_at - 120000').run();
		await request(email, { headers });
		const second = await verify(tokenFor(email));
		expect(second.body).toMatchObject({ created: false });
		expect(second.body.user.id).toBe(first.body.user.id);
	});

	it('treats the address case-insensitively', async () => {
		const { email, headers } = fresh();
		await request(email.toUpperCase(), { headers });
		expect((await verify(tokenFor(email))).body.created).toBe(true);
	});

	it('refuses an expired link, and one that was never made', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const token = tokenFor(email);
		await env.DB.prepare('UPDATE login_tokens SET expires_at = ? WHERE email = ?')
			.bind(Date.now() - 1, email)
			.run();
		expect((await verify(token)).body.error).toBe('link_invalid');
		expect((await verify('nonsense')).status).toBe(400);
		expect((await call('/api/auth/link/verify', { body: {} })).body.error).toBe('invalid_token');
	});

	it('expires fifteen minutes after it was sent', async () => {
		const { email, headers } = fresh();
		const before = Date.now();
		await request(email, { headers });
		const row = await env.DB.prepare(
			'SELECT created_at, expires_at FROM login_tokens WHERE email = ?'
		)
			.bind(email)
			.first<{ created_at: number; expires_at: number }>();
		expect(row!.expires_at - row!.created_at).toBe(15 * 60 * 1000);
		expect(row!.created_at).toBeGreaterThanOrEqual(before);
	});

	it('tells the app whether this account already has a passkey, to offer one if not', async () => {
		const { done: account } = await register();
		const { email, headers } = fresh();
		// Signed in with a passkey, add an email; then the email signs in to the same account.
		await request(email, { headers, cookie: account.cookie });
		const added = await verify(tokenFor(email));
		expect(added.body).toEqual({ added: true, email });
		await env.DB.prepare('UPDATE login_tokens SET created_at = created_at - 120000').run();
		await request(email, { headers });
		const signedIn = await verify(tokenFor(email));
		expect(signedIn.body).toMatchObject({ created: false, hasPasskey: true });
		expect(signedIn.body.user.id).toBe(account.body.user.id);
	});
});

describe('adding an email to an account', () => {
	it('does not sign whoever opens the link in', async () => {
		const { done: account } = await register();
		const { email, headers } = fresh();
		await request(email, { headers, cookie: account.cookie });
		const reply = await verify(tokenFor(email));
		expect(reply.body.added).toBe(true);
		expect(reply.setCookie).toBeUndefined();
	});

	it('is refused when another account already has that address', async () => {
		const owner = fresh();
		await request(owner.email, owner);
		await verify(tokenFor(owner.email));
		const { done: other } = await register();
		await env.DB.prepare('UPDATE login_tokens SET created_at = created_at - 120000').run();
		await request(owner.email, { headers: owner.headers, cookie: other.cookie });
		const reply = await verify(tokenFor(owner.email));
		expect(reply.status).toBe(409);
		expect(reply.body.error).toBe('email_in_use');
	});
});

describe('the development outbox', () => {
	it('is not there unless emails are being captured', async () => {
		const live = testClient({ DB: test.env.DB });
		expect((await live.call('/api/dev/outbox')).status).toBe(404);
		expect((await call('/api/dev/outbox')).status).toBe(200);
	});
});
