import type { Env } from '../env.ts';
import { BadRequest, error, json, readJson } from '../http.ts';
import { sendMail } from '../mail.ts';
import { sessionUser, startSession } from './session.ts';
import { randomToken, sha256 } from './tokens.ts';

const MINUTE = 60 * 1000;
export const LINK_LIFETIME = 15 * MINUTE;
// How often links may be asked for: one per address a minute, a few an hour, and a few more per
// source, so the form can't be used to flood somebody's inbox.
const PER_EMAIL_GAP = MINUTE;
const PER_EMAIL_HOUR = 5;
const PER_SOURCE_HOUR = 10;

function normaliseEmail(value: unknown): string {
	const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw new BadRequest('invalid_email');
	}
	return email;
}

function emailFor(link: string) {
	const minutes = LINK_LIFETIME / MINUTE;
	return {
		subject: 'Your Trolay sign-in link',
		text: `Open this link to sign in to Trolay:\n\n${link}\n\nIt works once and expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.`,
		html: `<p>Open this link to sign in to Trolay:</p><p><a href="${link}">Sign in to Trolay</a></p><p>It works once and expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.</p>`
	};
}

/**
 * Sends a sign-in link. The answer is the same whether or not the address has an account, so
 * this can't be used to find out who does. Signed in, the link adds the address to your account.
 */
export async function linkRequest(request: Request, env: Env): Promise<Response> {
	const email = normaliseEmail((await readJson(request)).email);
	const now = Date.now();
	const requester = await sha256(request.headers.get('CF-Connecting-IP') ?? 'unknown');
	const count = async (column: 'email' | 'requester', value: string, since: number) =>
		(
			await env.DB.prepare(
				`SELECT COUNT(*) AS n FROM login_tokens WHERE ${column} = ? AND created_at > ?`
			)
				.bind(value, since)
				.first<{ n: number }>()
		)?.n ?? 0;
	if (
		(await count('email', email, now - PER_EMAIL_GAP)) > 0 ||
		(await count('email', email, now - 60 * MINUTE)) >= PER_EMAIL_HOUR ||
		(await count('requester', requester, now - 60 * MINUTE)) >= PER_SOURCE_HOUR
	) {
		return error(429, 'too_many_requests');
	}

	const token = randomToken();
	const tokenHash = await sha256(token);
	const addingTo = (await sessionUser(request, env)) ?? null;
	await env.DB.batch([
		env.DB.prepare('DELETE FROM login_tokens WHERE created_at < ?').bind(now - 24 * 60 * MINUTE),
		env.DB.prepare(
			`INSERT INTO login_tokens (token_hash, email, user_id, requester, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		).bind(tokenHash, email, addingTo, requester, now, now + LINK_LIFETIME)
	]);

	// The token is in the fragment, which browsers never send to a server, so it stays out of
	// logs, and a mail scanner that opens the link without running the app cannot use it up.
	const link = `${env.APP_ORIGIN ?? new URL(request.url).origin}/account/link#token=${token}`;
	try {
		await sendMail(env, { to: email, ...emailFor(link) });
	} catch (cause) {
		console.error(cause);
		await env.DB.prepare('DELETE FROM login_tokens WHERE token_hash = ?').bind(tokenHash).run();
		return error(502, 'email_failed');
	}
	return json({ ok: true }, 202);
}

/** Uses a link up. It signs in, or (for a signed-in user adding an email) adds the address. */
export async function linkVerify(request: Request, env: Env): Promise<Response> {
	const { token } = await readJson(request);
	if (typeof token !== 'string' || token.length > 200) throw new BadRequest('invalid_token');

	const used = await env.DB.prepare(
		`UPDATE login_tokens SET used_at = ?
		 WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
		 RETURNING email, user_id`
	)
		.bind(Date.now(), await sha256(token), Date.now())
		.first<{ email: string; user_id: string | null }>();
	if (!used) return error(400, 'link_invalid');

	const now = Date.now();
	if (used.user_id) {
		// Adding an email. This does not sign anyone in: whoever opens the link is the inbox's
		// owner, and may be nobody who holds this account.
		const added = await env.DB.prepare(
			`UPDATE users SET email = ?, updated_at = ?
			 WHERE id = ? AND deleted_at IS NULL
			   AND NOT EXISTS (SELECT 1 FROM users WHERE email = ? AND id != ?)`
		)
			.bind(used.email, now, used.user_id, used.email, used.user_id)
			.run();
		if (!added.meta.changes) return error(409, 'email_in_use');
		return json({ added: true, email: used.email });
	}

	let user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
		.bind(used.email)
		.first<{ id: string }>();
	const created = !user;
	if (!user) {
		user = { id: crypto.randomUUID() };
		await env.DB.prepare(
			'INSERT INTO users (id, email, created_at, updated_at) VALUES (?, ?, ?, ?)'
		)
			.bind(user.id, used.email, now, now)
			.run();
	}
	const hasPasskey =
		(await env.DB.prepare('SELECT 1 AS found FROM passkeys WHERE user_id = ? LIMIT 1')
			.bind(user.id)
			.first()) !== null;
	const response = json({ user: { id: user.id }, created, hasPasskey });
	response.headers.append('Set-Cookie', await startSession(request, env, user.id));
	return response;
}
