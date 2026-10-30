import type { Env } from '../env.ts';
import { randomToken, sha256 } from './tokens.ts';

const DAYS = 24 * 60 * 60 * 1000;
export const SESSION_LIFETIME = 30 * DAYS;

/**
 * Over HTTPS the cookie is `__Host-` prefixed, which forbids a Domain and requires Secure and
 * Path=/, so no sibling subdomain can set or shadow it. Plain-http localhost (development)
 * cannot hold a Secure cookie in every browser, so it gets a plain name.
 */
function cookieName(request: Request): string {
	return new URL(request.url).protocol === 'https:' ? '__Host-session' : 'session';
}

function cookie(request: Request, value: string, maxAgeSeconds: number): string {
	const secure = new URL(request.url).protocol === 'https:';
	return [
		`${cookieName(request)}=${value}`,
		'HttpOnly',
		secure ? 'Secure' : '',
		'SameSite=Lax',
		'Path=/',
		`Max-Age=${maxAgeSeconds}`
	]
		.filter(Boolean)
		.join('; ');
}

function tokenFrom(request: Request): string | undefined {
	const name = cookieName(request);
	for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
		const [key, ...value] = part.trim().split('=');
		if (key === name) return value.join('=') || undefined;
	}
	return undefined;
}

/** Starts a session for the user; returns the Set-Cookie header value to send. */
export async function startSession(request: Request, env: Env, userId: string): Promise<string> {
	const token = randomToken();
	const now = Date.now();
	await env.DB.prepare(
		'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
	)
		.bind(await sha256(token), userId, now, now + SESSION_LIFETIME)
		.run();
	return cookie(request, token, SESSION_LIFETIME / 1000);
}

/** The signed-in user's id, or undefined when there is no valid session. */
export async function sessionUser(request: Request, env: Env): Promise<string | undefined> {
	const token = tokenFrom(request);
	if (!token) return undefined;
	const row = await env.DB.prepare(
		`SELECT sessions.user_id FROM sessions
		 JOIN users ON users.id = sessions.user_id AND users.deleted_at IS NULL
		 WHERE sessions.token_hash = ? AND sessions.expires_at > ?`
	)
		.bind(await sha256(token), Date.now())
		.first<{ user_id: string }>();
	return row?.user_id;
}

/** Ends this device's session; returns the Set-Cookie header value that clears the cookie. */
export async function endSession(request: Request, env: Env): Promise<string> {
	const token = tokenFrom(request);
	if (token) {
		await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
			.bind(await sha256(token))
			.run();
	}
	return cookie(request, '', 0);
}
