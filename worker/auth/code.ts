import type { Env } from '../env.ts';
import { BadRequest, error, json, readJson } from '../http.ts';
import { sendMail } from '../mail.ts';
import { sessionUser, startSession } from './session.ts';
import { randomToken, sha256 } from './tokens.ts';

const MINUTE = 60 * 1000;
export const CODE_LIFETIME = 10 * MINUTE;
/** Wrong guesses a code survives. Six digits are easy to guess, so there are only a few. */
export const MAX_TRIES = 5;
// How often codes may be asked for: one per address a minute, a few an hour, and a few more per
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

/** The six digits, whatever spaces or dashes they were typed or pasted with. */
function normaliseCode(value: unknown): string {
	const code = typeof value === 'string' ? value.replace(/[\s-]/g, '') : '';
	if (!/^\d{6}$/.test(code)) throw new BadRequest('invalid_code');
	return code;
}

/** Six digits, each as likely as any other. */
function newCode(): string {
	const limit = 2 ** 32 - (2 ** 32 % 1_000_000);
	const draw = new Uint32Array(1);
	do crypto.getRandomValues(draw);
	while (draw[0] >= limit);
	return String(draw[0] % 1_000_000).padStart(6, '0');
}

/** The id salts the hash, so two people with the same code have different hashes. */
const hashOf = (id: string, code: string) => sha256(`${id}:${code}`);

function emailFor(code: string) {
	const minutes = CODE_LIFETIME / MINUTE;
	const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
	return {
		subject: `Your Trolay code is ${spaced}`,
		text: `Your Trolay sign-in code is ${spaced}\n\nType it into Trolay. It works once and expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.`,
		html: `<p>Your Trolay sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${spaced}</p><p>Type it into Trolay. It works once and expires in ${minutes} minutes. If you didn't ask for it, you can ignore this email.</p>`
	};
}

/**
 * Sends a sign-in code. The answer is the same whether or not the address has an account, so
 * this can't be used to find out who does. Signed in, the code adds the address to your account.
 */
export async function codeRequest(request: Request, env: Env): Promise<Response> {
	const email = normaliseEmail((await readJson(request)).email);
	const now = Date.now();
	const requester = await sha256(request.headers.get('CF-Connecting-IP') ?? 'unknown');
	const count = async (column: 'email' | 'requester', value: string, since: number) =>
		(
			await env.DB.prepare(
				`SELECT COUNT(*) AS n FROM login_codes WHERE ${column} = ? AND created_at > ?`
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

	const id = randomToken();
	const code = newCode();
	const addingTo = (await sessionUser(request, env)) ?? null;
	await env.DB.batch([
		env.DB.prepare('DELETE FROM login_codes WHERE created_at < ?').bind(now - 24 * 60 * MINUTE),
		// A new code replaces any earlier one for the address, so only the latest can be used.
		env.DB.prepare('UPDATE login_codes SET used_at = ? WHERE email = ? AND used_at IS NULL').bind(
			now,
			email
		),
		env.DB.prepare(
			`INSERT INTO login_codes (id, email, code_hash, user_id, requester, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).bind(id, email, await hashOf(id, code), addingTo, requester, now, now + CODE_LIFETIME)
	]);

	try {
		await sendMail(env, { to: email, ...emailFor(code) });
	} catch (cause) {
		console.error(cause);
		await env.DB.prepare('DELETE FROM login_codes WHERE id = ?').bind(id).run();
		return error(502, 'email_failed');
	}
	return json({ ok: true }, 202);
}

/** Uses a code up. It signs in, or (for a signed-in user adding an email) adds the address. */
export async function codeVerify(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const email = normaliseEmail(body.email);
	const code = normaliseCode(body.code);
	const now = Date.now();

	const pending = await env.DB.prepare(
		`SELECT id, code_hash FROM login_codes
		 WHERE email = ? AND used_at IS NULL AND expires_at > ?
		 ORDER BY created_at DESC LIMIT 1`
	)
		.bind(email, now)
		.first<{ id: string; code_hash: string }>();
	// No code asked for, or it has run out: the same answer as a wrong one.
	if (!pending) return error(400, 'code_invalid');

	// Every guess is counted before it is looked at, so guessing cannot outrun the limit.
	const tried = await env.DB.prepare(
		`UPDATE login_codes SET attempts = attempts + 1
		 WHERE id = ? AND used_at IS NULL AND attempts < ? RETURNING attempts`
	)
		.bind(pending.id, MAX_TRIES)
		.first<{ attempts: number }>();
	if (!tried) return error(400, 'code_locked');
	if ((await hashOf(pending.id, code)) !== pending.code_hash) {
		return error(400, tried.attempts >= MAX_TRIES ? 'code_locked' : 'code_invalid');
	}

	const used = await env.DB.prepare(
		`UPDATE login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL
		 RETURNING email, user_id`
	)
		.bind(now, pending.id)
		.first<{ email: string; user_id: string | null }>();
	if (!used) return error(400, 'code_invalid');

	if (used.user_id) {
		// Adding an email. This does not sign anyone in: whoever holds the code is the inbox's
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
