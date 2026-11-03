import type { Env } from '../env.ts';
import { BadRequest, error, json, readJson } from '../http.ts';
import { sendMail } from '../mail.ts';
import { sessionUser, startSession } from './session.ts';
import { randomToken, sha256 } from './tokens.ts';

const MINUTE = 60 * 1000;
export const CODE_LIFETIME = 10 * MINUTE;
/** Wrong guesses a code survives. Six digits are easy to guess, so there are only a few. */
export const MAX_TRIES = 5;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// How often codes may be asked for: one per address a minute, a few an hour, and a few more per
// source, so the form can't be used to flood somebody's inbox. Over everyone there is a ceiling
// too, so a script spraying made-up addresses from many sources can only send so many emails
// (bounces count against the domain's sending reputation).
const PER_EMAIL_GAP = MINUTE;
const PER_EMAIL_HOUR = 5;
const PER_SOURCE_HOUR = 10;
const PER_SOURCE_DAY = 30;
export const ALL_HOUR = 100;
export const ALL_DAY = 500;

/**
 * Who is asking, for the per-source limits. An IPv6 address counts by its /64, which is what one
 * connection is usually given: otherwise every address in it would be a fresh source.
 */
export function sourceOf(ip: string | null): string {
	if (!ip?.includes(':')) return ip ?? 'unknown';
	const [head, tail = ''] = ip.toLowerCase().split('::');
	const front = head ? head.split(':') : [];
	const back = tail ? tail.split(':') : [];
	const groups = ip.includes('::')
		? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back]
		: front;
	return `${groups
		.slice(0, 4)
		.map((group) => group.replace(/^0+(?=.)/, ''))
		.join(':')}::/64`;
}

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

/**
 * The email with the code. A code that adds the address to an account says so: it must never read
 * like a sign-in code, or someone signing in could be led to give their address to a stranger.
 */
function emailFor(code: string, adding: boolean) {
	const minutes = CODE_LIFETIME / MINUTE;
	const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
	const expiry = `It works once and expires in ${minutes} minutes.`;
	if (adding) {
		const ask = 'Someone signed in to Trolay asked to add this email address to their account.';
		const ignore = "If that wasn't you, ignore this email and the address won't be added.";
		return {
			subject: `Add this email to Trolay: code ${spaced}`,
			text: `${ask} If that was you, type this code into Trolay: ${spaced}\n\n${expiry} ${ignore}`,
			html: `<p>${ask} If that was you, type this code into Trolay:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${spaced}</p><p>${expiry} ${ignore}</p>`
		};
	}
	return {
		subject: `Your Trolay code is ${spaced}`,
		text: `Your Trolay sign-in code is ${spaced}\n\nType it into Trolay. ${expiry} If you didn't ask for it, you can ignore this email.`,
		html: `<p>Your Trolay sign-in code is</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${spaced}</p><p>Type it into Trolay. ${expiry} If you didn't ask for it, you can ignore this email.</p>`
	};
}

/**
 * Sends a sign-in code. The answer is the same whether or not the address has an account, so
 * this can't be used to find out who does. Signed in, the code adds the address to your account,
 * and only works for you.
 */
export async function codeRequest(request: Request, env: Env): Promise<Response> {
	const email = normaliseEmail((await readJson(request)).email);
	const now = Date.now();
	const requester = await sha256(sourceOf(request.headers.get('CF-Connecting-IP')));
	// How many codes were asked for lately: for this address, from this source, and by everyone.
	// One query, as this runs on every request.
	const counts = await env.DB.prepare(
		`SELECT
		   COALESCE(SUM(email = ?1 AND created_at > ?3), 0) AS email_gap,
		   COALESCE(SUM(email = ?1 AND created_at > ?4), 0) AS email_hour,
		   COALESCE(SUM(requester = ?2 AND created_at > ?4), 0) AS source_hour,
		   COALESCE(SUM(requester = ?2), 0) AS source_day,
		   COALESCE(SUM(created_at > ?4), 0) AS all_hour,
		   COUNT(*) AS all_day
		 FROM login_codes WHERE created_at > ?5`
	)
		.bind(email, requester, now - PER_EMAIL_GAP, now - HOUR, now - DAY)
		.first<Record<string, number>>();
	if (
		!counts ||
		counts.email_gap > 0 ||
		counts.email_hour >= PER_EMAIL_HOUR ||
		counts.source_hour >= PER_SOURCE_HOUR ||
		counts.source_day >= PER_SOURCE_DAY ||
		counts.all_hour >= ALL_HOUR ||
		counts.all_day >= ALL_DAY
	) {
		return error(429, 'too_many_requests');
	}

	const id = randomToken();
	const code = newCode();
	const addingTo = (await sessionUser(request, env)) ?? null;
	await env.DB.batch([
		env.DB.prepare('DELETE FROM login_codes WHERE created_at < ?').bind(now - DAY),
		// A new code replaces any earlier one for the address asked for the same way, so only the
		// latest can be used. One account adding the address doesn't cancel a code to sign in with
		// it, or another account's, or that could be used to swap a code someone was waiting for.
		env.DB.prepare(
			'UPDATE login_codes SET used_at = ? WHERE email = ? AND user_id IS ? AND used_at IS NULL'
		).bind(now, email, addingTo),
		env.DB.prepare(
			`INSERT INTO login_codes (id, email, code_hash, user_id, requester, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).bind(id, email, await hashOf(id, code), addingTo, requester, now, now + CODE_LIFETIME)
	]);

	try {
		await sendMail(env, { to: email, ...emailFor(code, addingTo !== null) });
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
	const signedIn = (await sessionUser(request, env)) ?? null;

	// A code to sign in works for anyone who has it. A code to add the address to an account only
	// works for that account: whoever else has it may only be the inbox's owner, who never asked.
	const pending = await env.DB.prepare(
		`SELECT id, code_hash FROM login_codes
		 WHERE email = ? AND used_at IS NULL AND expires_at > ? AND (user_id IS NULL OR user_id = ?)
		 ORDER BY created_at DESC LIMIT 1`
	)
		.bind(email, now, signedIn)
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
		// Adding an email, by the account that asked. This does not sign anyone in.
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
