import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env.ts';
import { FEEDBACK_PER_SOURCE_HOUR, MAX_FEEDBACK_BODY, SITEVERIFY } from './feedback.ts';
import { HOUR } from './rate.ts';
import { createTestEnv, testClient, type TestEnv } from './testing.ts';

let test: TestEnv;
let env: Env;
let call: ReturnType<typeof testClient>['call'];
let register: ReturnType<typeof testClient>['register'];

/** What Turnstile says of each token: only "good" passes; "down" is Turnstile not answering. */
const siteverify = vi.fn(async (form: FormData) => {
	if (form.get('response') === 'down') return new Response('', { status: 500 });
	return Response.json({ success: form.get('response') === 'good' });
});
/** The email binding, faked: what the Worker hands it is kept, and nothing is sent. */
const send = vi.fn<(message: unknown) => Promise<{ messageId: string }>>(async () => ({
	messageId: 'test'
}));

beforeAll(async () => {
	test = await createTestEnv();
	env = {
		...test.env,
		EMAIL: { send } as unknown as SendEmail,
		FEEDBACK_TO: 'feedback@trolay.test',
		FEEDBACK_FROM: 'app@trolay.test',
		TURNSTILE_SECRET_KEY: 'secret-key'
	};
	({ call, register } = testClient(env));
});
afterAll(() => test.dispose());

beforeEach(() => {
	const realFetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		if (String(input) === SITEVERIFY) return siteverify(init!.body as FormData);
		return realFetch(input, init);
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	siteverify.mockClear();
	send.mockClear();
});

const good = {
	topic: 'Problem',
	message: 'The total was wrong after a discount.',
	email: 'shopper@example.com',
	token: 'good'
};
const feedback = (body: object, ip = '203.0.113.9', cookie?: string) =>
	call('/api/feedback', { body, cookie, headers: { 'CF-Connecting-IP': ip } });
type Sent = {
	to: string;
	from: { email: string };
	replyTo?: string;
	subject: string;
	text: string;
};
const sent = () => send.mock.calls.map(([message]) => message as Sent & Record<string, unknown>);

describe('sending feedback', () => {
	it('emails it, as plain text, to the configured address with Reply-To the sender', async () => {
		const reply = await feedback({
			...good,
			// An address in the request is never where it goes.
			to: 'someone@else.test',
			message: '<b>Bold</b> & <script>alert(1)</script> claims',
			details: { version: '2026.11.08', theme: 'Dark', installed: 'Yes', extra: 'dropped' }
		});
		expect(reply.status).toBe(200);
		expect(sent()).toHaveLength(1);
		const [email] = sent();
		expect(email.to).toBe('feedback@trolay.test');
		expect(email.from.email).toBe('app@trolay.test');
		expect(email.replyTo).toBe('shopper@example.com');
		expect(email.subject).toBe('Trolay feedback: Problem');
		expect(email.html).toBeUndefined();
		expect(email.text).toContain('<b>Bold</b> & <script>alert(1)</script> claims');
		expect(email.text).toContain('App version: 2026.11.08');
		expect(email.text).toContain('Theme: Dark');
		expect(email.text).not.toContain('dropped');
		expect(email.text).toContain('Account: not signed in');

		// Turnstile was asked with the secret and the sender's address.
		const form = siteverify.mock.calls[0][0];
		expect(form.get('secret')).toBe('secret-key');
		expect(form.get('remoteip')).toBe('203.0.113.9');
	});

	it('defaults the topic, and sets no Reply-To when there is no address', async () => {
		const { topic: _topic, email: _email, ...rest } = good;
		expect((await feedback(rest)).status).toBe(200);
		const [email] = sent();
		expect(email.subject).toBe('Trolay feedback: Something else');
		expect(email.replyTo).toBeUndefined();
		expect(email.text).toContain('Reply to: no address given');
	});

	it("names the sender's account when signed in, and nothing of their session", async () => {
		const { done } = await register();
		expect((await feedback(good, '203.0.113.10', done.cookie)).status).toBe(200);
		const [email] = sent();
		expect(email.text).toContain(`Account: ${done.body.user.id}`);
		const token = done.cookie!.split('=')[1];
		expect(JSON.stringify(email)).not.toContain(token);
	});

	it('refuses a missing, failed or spent Turnstile token', async () => {
		const { token: _token, ...noToken } = good;
		for (const body of [noToken, { ...good, token: '' }, { ...good, token: 'used-already' }]) {
			const reply = await feedback(body, '203.0.113.11');
			expect(reply.status).toBe(400);
			expect(reply.body.error).toBe('turnstile_failed');
		}
		expect(send).not.toHaveBeenCalled();
	});

	it('says so when Turnstile cannot be asked, and sends nothing', async () => {
		const reply = await feedback({ ...good, token: 'down' }, '203.0.113.12');
		expect(reply.status).toBe(503);
		expect(reply.body.error).toBe('turnstile_unavailable');
		expect(send).not.toHaveBeenCalled();
	});

	it('refuses a message too short or too long, a bad address, topic or body', async () => {
		const refusals: [object, string][] = [
			[{ ...good, message: '   short   ' }, 'message_too_short'],
			[{ ...good, message: 'x'.repeat(2001) }, 'message_too_long'],
			[{ ...good, email: 'not an address' }, 'invalid_email'],
			[{ ...good, email: 'a@b.test, c@d.test' }, 'invalid_email'],
			[{ ...good, topic: 'Complaint' }, 'invalid_topic'],
			[{ ...good, details: { userAgent: 'x'.repeat(501) } }, 'invalid_details'],
			[{ ...good, padding: 'x'.repeat(MAX_FEEDBACK_BODY) }, 'too_large']
		];
		for (const [body, code] of refusals) {
			const reply = await feedback(body, '203.0.113.13');
			expect(reply.status, code).toBe(400);
			expect(reply.body.error).toBe(code);
		}
		// Neither Turnstile nor the email service is troubled by a request that is refused anyway.
		expect(siteverify).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	it(`takes ${FEEDBACK_PER_SOURCE_HOUR} an hour from each source`, async () => {
		for (let i = 0; i < FEEDBACK_PER_SOURCE_HOUR; i++) {
			expect((await feedback(good, '203.0.113.14')).status).toBe(200);
		}
		const refused = await feedback(good, '203.0.113.14');
		expect(refused.status).toBe(429);
		expect(refused.body.error).toBe('too_many_requests');
		expect(send).toHaveBeenCalledTimes(FEEDBACK_PER_SOURCE_HOUR);
		// Another source is not held up; and an hour on, this one can send again.
		expect((await feedback(good, '203.0.113.15')).status).toBe(200);
		await env.DB.prepare('UPDATE rate_events SET at = at - ?').bind(HOUR).run();
		expect((await feedback(good, '203.0.113.14')).status).toBe(200);
	});

	it('answers 502 when the email is not sent, and 503 when it is not set up', async () => {
		send.mockRejectedValueOnce(new Error('domain not verified'));
		const failed = await feedback(good, '203.0.113.16');
		expect(failed.status).toBe(502);
		expect(failed.body.error).toBe('send_failed');

		const bare = testClient({ ...env, FEEDBACK_TO: undefined }).call;
		const reply = await bare('/api/feedback', { body: good });
		expect(reply.status).toBe(503);
		expect(reply.body.error).toBe('not_configured');
	});
});
