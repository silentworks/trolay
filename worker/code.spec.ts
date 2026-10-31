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
	return call('/api/auth/code/request', { body: { email }, ...extra });
}

/** The six digits in the latest email to this address. */
function codeFor(email: string): string {
	const mail = capturedMail(email).at(-1)!;
	return mail.text
		.match(/\b(\d{3}) (\d{3})\b/)!
		.slice(1, 3)
		.join('');
}

const verify = (email: string, code: string, cookie?: string) =>
	call('/api/auth/code/verify', { body: { email, code }, cookie });

/** A wrong code that is not the right one. */
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

const ageCodes = () =>
	env.DB.prepare('UPDATE login_codes SET created_at = created_at - 120000').run();

describe('asking for a code', () => {
	it('emails six digits, and keeps only a hash of them', async () => {
		const { email, headers } = fresh();
		const reply = await request(email, { headers });
		expect(reply.status).toBe(202);
		const mail = capturedMail(email).at(-1)!;
		const code = codeFor(email);
		expect(code).toMatch(/^\d{6}$/);
		expect(mail.subject).toBe(`Your Trolay code is ${code.slice(0, 3)} ${code.slice(3)}`);
		expect(mail.text).toContain('10 minutes');
		expect(mail.text).not.toMatch(/https?:/);
		expect(mail.html).toContain(`${code.slice(0, 3)} ${code.slice(3)}`);
		const rows = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?')
			.bind(email)
			.all();
		expect(rows.results).toHaveLength(1);
		expect(JSON.stringify(rows.results)).not.toContain(code);
	});

	it('makes codes that are spread over all six-digit numbers, leading zeros and all', async () => {
		const seen = new Set<string>();
		for (let i = 0; i < 60; i++) {
			const { email, headers } = fresh();
			await request(email, { headers });
			seen.add(codeFor(email));
		}
		expect(seen.size).toBeGreaterThan(55);
		for (const code of seen) expect(code).toMatch(/^\d{6}$/);
	});

	it('answers the same for an address with an account and one without', async () => {
		const known = fresh();
		await request(known.email, known);
		await verify(known.email, codeFor(known.email));
		// Let the one-a-minute limit pass, so the two requests differ only in the address.
		await ageCodes();
		const unknown = fresh();
		const a = await request(known.email, known);
		const b = await request(unknown.email, unknown);
		expect([a.status, a.body]).toEqual([b.status, b.body]);
		expect(a.status).toBe(202);
	});

	it('refuses an address that is not one', async () => {
		for (const email of ['', 'nope', 'a@b', 'a b@c.com', 'x'.repeat(300) + '@example.com', 42]) {
			const reply = await call('/api/auth/code/request', { body: { email } });
			expect(reply.status, String(email)).toBe(400);
			expect(reply.body.error).toBe('invalid_email');
		}
	});

	it('does not send a second code within a minute, nor more than five an hour', async () => {
		const { email, headers } = fresh();
		expect((await request(email, { headers })).status).toBe(202);
		expect((await request(email, { headers })).status).toBe(429);
		// Four more, a couple of minutes apart, make five in the hour; the sixth is refused.
		for (let i = 0; i < 4; i++) {
			await ageCodes();
			expect((await request(email, { headers })).status).toBe(202);
		}
		await ageCodes();
		expect((await request(email, { headers })).status).toBe(429);
	});

	it('limits how many one source can ask for', async () => {
		const headers = { 'CF-Connecting-IP': '203.0.113.9' };
		for (let i = 0; i < 10; i++)
			expect((await request(fresh().email, { headers })).status).toBe(202);
		expect((await request(fresh().email, { headers })).status).toBe(429);
	});

	it('sends through the email binding, from the configured address', async () => {
		const sent: { from: string; to: string; subject: string; text: string; html: string }[] = [];
		const live = testClient({
			...test.env,
			MAIL_FROM: 'Trolay <signin@trolay.test>',
			EMAIL: { send: async (message) => (sent.push(message), { messageId: 'm1' }) }
		});
		const { email, headers } = fresh();
		expect((await live.call('/api/auth/code/request', { body: { email }, headers })).status).toBe(
			202
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ from: 'Trolay <signin@trolay.test>', to: email });
		expect(sent[0].text).toMatch(/\b\d{3} \d{3}\b/);
	});

	it('says so, and keeps no code, when the email cannot be sent', async () => {
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
		const reply = await broken.call('/api/auth/code/request', { body: { email }, headers });
		expect(reply.status).toBe(502);
		expect(reply.body.error).toBe('email_failed');
		const rows = await env.DB.prepare('SELECT 1 FROM login_codes WHERE email = ?')
			.bind(email)
			.all();
		expect(rows.results).toHaveLength(0);
	});

	it('says so when sending is not set up at all', async () => {
		const unset = testClient({ DB: test.env.DB });
		const { email, headers } = fresh();
		expect((await unset.call('/api/auth/code/request', { body: { email }, headers })).status).toBe(
			502
		);
	});

	it('no longer has the emailed-link endpoints', async () => {
		expect((await call('/api/auth/link/request', { body: { email: 'a@b.co' } })).status).toBe(404);
		expect((await call('/api/auth/link/verify', { body: { token: 'x' } })).status).toBe(404);
	});
});

describe('entering a code', () => {
	it('signs in, creating the account the first time, and works only once', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const code = codeFor(email);

		const first = await verify(email, code);
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ created: true, hasPasskey: false });
		expect(first.setCookie).toMatch(/^__Host-session=.*HttpOnly.*Secure.*SameSite=Lax/);
		expect((await call('/api/auth/me', { cookie: first.cookie })).body.user.id).toBe(
			first.body.user.id
		);

		const again = await verify(email, code);
		expect(again.status).toBe(400);
		expect(again.body.error).toBe('code_invalid');
		expect(again.setCookie).toBeUndefined();
	});

	it('signs in to the same account next time', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const first = await verify(email, codeFor(email));
		await ageCodes();
		await request(email, { headers });
		const second = await verify(email, codeFor(email));
		expect(second.body).toMatchObject({ created: false });
		expect(second.body.user.id).toBe(first.body.user.id);
	});

	it('takes the address in any case, and the code with spaces, dashes or not', async () => {
		const { email, headers } = fresh();
		await request(email.toUpperCase(), { headers });
		const code = codeFor(email);
		expect(
			(await verify(email.toUpperCase(), `${code.slice(0, 3)} ${code.slice(3)}`)).body.created
		).toBe(true);
		await ageCodes();
		await request(email, { headers });
		const next = codeFor(email);
		expect((await verify(email, `${next.slice(0, 3)}-${next.slice(3)}`)).status).toBe(200);
	});

	it('refuses a wrong code, an expired one, and an address that asked for none', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const code = codeFor(email);
		expect(await verify(email, wrong(code))).toMatchObject({
			status: 400,
			body: { error: 'code_invalid' }
		});
		await env.DB.prepare('UPDATE login_codes SET expires_at = ? WHERE email = ?')
			.bind(Date.now() - 1, email)
			.run();
		expect((await verify(email, code)).body.error).toBe('code_invalid');
		expect((await verify(fresh().email, '123456')).body.error).toBe('code_invalid');
	});

	it('refuses what is not six digits', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		for (const code of ['', '12345', '1234567', 'abcdef', '12 34', null, 123456]) {
			const reply = await verify(email, code as string);
			expect(reply.status, String(code)).toBe(400);
			expect(reply.body.error).toBe('invalid_code');
		}
		expect((await call('/api/auth/code/verify', { body: { code: '123456' } })).status).toBe(400);
	});

	it('expires ten minutes after it was sent', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const row = await env.DB.prepare(
			'SELECT created_at, expires_at FROM login_codes WHERE email = ?'
		)
			.bind(email)
			.first<{ created_at: number; expires_at: number }>();
		expect(row!.expires_at - row!.created_at).toBe(10 * 60 * 1000);
	});

	it('is locked after five wrong tries, even for the right code', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const code = codeFor(email);
		for (let i = 0; i < 4; i++) {
			expect((await verify(email, wrong(code))).body.error).toBe('code_invalid');
		}
		// The fifth wrong try says the code is locked, and from then on nothing opens it.
		expect((await verify(email, wrong(code))).body.error).toBe('code_locked');
		const right = await verify(email, code);
		expect(right.status).toBe(400);
		expect(right.body.error).toBe('code_locked');
		expect(right.setCookie).toBeUndefined();
		// A new code starts afresh.
		await ageCodes();
		await request(email, { headers });
		expect((await verify(email, codeFor(email))).status).toBe(200);
	});

	it('only the newest code for an address works', async () => {
		const { email, headers } = fresh();
		await request(email, { headers });
		const first = codeFor(email);
		await ageCodes();
		await request(email, { headers });
		const second = codeFor(email);
		if (first !== second) expect((await verify(email, first)).body.error).toMatch(/^code_/);
		expect((await verify(email, second)).status).toBe(200);
	});

	it('tells the app whether this account already has a passkey, to offer one if not', async () => {
		const { done: account } = await register();
		const { email, headers } = fresh();
		// Signed in with a passkey, add an email; then the email signs in to the same account.
		await request(email, { headers, cookie: account.cookie });
		const added = await verify(email, codeFor(email));
		expect(added.body).toEqual({ added: true, email });
		await ageCodes();
		await request(email, { headers });
		const signedIn = await verify(email, codeFor(email));
		expect(signedIn.body).toMatchObject({ created: false, hasPasskey: true });
		expect(signedIn.body.user.id).toBe(account.body.user.id);
	});
});

describe('adding an email to an account', () => {
	it('does not sign whoever has the code in', async () => {
		const { done: account } = await register();
		const { email, headers } = fresh();
		await request(email, { headers, cookie: account.cookie });
		const reply = await verify(email, codeFor(email));
		expect(reply.body.added).toBe(true);
		expect(reply.setCookie).toBeUndefined();
	});

	it('is refused when another account already has that address', async () => {
		const owner = fresh();
		await request(owner.email, owner);
		await verify(owner.email, codeFor(owner.email));
		const { done: other } = await register();
		await ageCodes();
		await request(owner.email, { headers: owner.headers, cookie: other.cookie });
		const reply = await verify(owner.email, codeFor(owner.email));
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
