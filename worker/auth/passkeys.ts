import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import type { Env } from '../env.ts';
import { BadRequest, error, json, readJson } from '../http.ts';
import { endSession, sessionUser, startSession } from './session.ts';
import { base64url, randomToken } from './tokens.ts';

const CHALLENGE_LIFETIME = 5 * 60 * 1000;
const RP_NAME = 'Trolay';

// The app and the API share one origin, so the relying party is simply where the request was
// made. A passkey made on one origin can never be used on another.
function relyingParty(request: Request) {
	const url = new URL(request.url);
	return { rpID: url.hostname, origin: url.origin };
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const padded = text
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(Math.ceil(text.length / 4) * 4, '=');
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function saveChallenge(
	env: Env,
	challenge: string,
	purpose: 'register' | 'login',
	userId: string | null
): Promise<string> {
	const id = randomToken();
	const now = Date.now();
	await env.DB.batch([
		// Challenges nobody finished are swept out as new ones arrive.
		env.DB.prepare('DELETE FROM challenges WHERE expires_at < ?').bind(now),
		env.DB.prepare(
			'INSERT INTO challenges (id, challenge, purpose, user_id, expires_at) VALUES (?, ?, ?, ?, ?)'
		).bind(id, challenge, purpose, userId, now + CHALLENGE_LIFETIME)
	]);
	return id;
}

/** Uses a challenge up: it can be redeemed once, within its lifetime, for the stated purpose. */
async function takeChallenge(
	env: Env,
	id: unknown,
	purpose: 'register' | 'login'
): Promise<{ challenge: string; userId: string | null }> {
	if (typeof id !== 'string') throw new BadRequest('missing_challenge');
	const row = await env.DB.prepare(
		'DELETE FROM challenges WHERE id = ? AND purpose = ? AND expires_at > ? RETURNING challenge, user_id'
	)
		.bind(id, purpose, Date.now())
		.first<{ challenge: string; user_id: string | null }>();
	if (!row) throw new BadRequest('challenge_expired');
	return { challenge: row.challenge, userId: row.user_id };
}

function credentialResponse(body: Record<string, unknown>): Record<string, unknown> {
	const { credential } = body;
	if (typeof credential !== 'object' || credential === null)
		throw new BadRequest('missing_credential');
	return credential as Record<string, unknown>;
}

function withCookie(response: Response, setCookie: string): Response {
	response.headers.append('Set-Cookie', setCookie);
	return response;
}

/**
 * Step one of making a passkey. Signed in, it adds a passkey to your account; signed out, it
 * starts a new account.
 */
export async function registrationOptions(request: Request, env: Env): Promise<Response> {
	const existing = await sessionUser(request, env);
	const userId = existing ?? crypto.randomUUID();
	const { rpID } = relyingParty(request);

	const known = existing
		? (
				await env.DB.prepare('SELECT id, transports FROM passkeys WHERE user_id = ?')
					.bind(existing)
					.all<{ id: string; transports: string | null }>()
			).results
		: [];
	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID,
		userName: `Trolay ${new Date().toISOString().slice(0, 10)}`,
		userID: new Uint8Array(new TextEncoder().encode(userId)),
		attestationType: 'none',
		// Don't offer a device that already has a passkey for this account.
		excludeCredentials: known.map((key) => ({
			id: key.id,
			transports: key.transports ? JSON.parse(key.transports) : undefined
		})),
		// A discoverable credential, so signing in needs no username.
		authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' }
	});
	const challengeId = await saveChallenge(env, options.challenge, 'register', userId);
	return json({ challengeId, options });
}

/** Step two: checks the new passkey, then creates the account if it is a new one. */
export async function registrationVerify(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const { challenge, userId } = await takeChallenge(env, body.challengeId, 'register');
	if (!userId) throw new BadRequest('missing_user');
	const { rpID, origin } = relyingParty(request);

	let verification;
	try {
		verification = await verifyRegistrationResponse({
			response: credentialResponse(body) as unknown as RegistrationResponseJSON,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: rpID
		});
	} catch {
		return error(400, 'verification_failed');
	}
	if (!verification.verified) return error(400, 'verification_failed');
	const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

	const now = Date.now();
	const signedIn = await sessionUser(request, env);
	// A passkey may only be added to the account the caller is signed in to.
	if (signedIn && signedIn !== userId) return error(403, 'wrong_account');
	const statements = [];
	if (!signedIn) {
		statements.push(
			env.DB.prepare('INSERT INTO users (id, created_at, updated_at) VALUES (?, ?, ?)').bind(
				userId,
				now,
				now
			)
		);
	}
	statements.push(
		env.DB.prepare(
			`INSERT INTO passkeys (id, user_id, public_key, counter, transports, device_type, backed_up, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).bind(
			credential.id,
			userId,
			base64url(credential.publicKey),
			credential.counter,
			credential.transports ? JSON.stringify(credential.transports) : null,
			credentialDeviceType,
			credentialBackedUp ? 1 : 0,
			now
		)
	);
	try {
		await env.DB.batch(statements);
	} catch {
		// The credential id is already registered.
		return error(409, 'already_registered');
	}
	const response = json({ user: { id: userId } }, signedIn ? 200 : 201);
	return signedIn ? response : withCookie(response, await startSession(request, env, userId));
}

/** Step one of signing in: a challenge for any passkey this site made. */
export async function loginOptions(request: Request, env: Env): Promise<Response> {
	const { rpID } = relyingParty(request);
	const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
	const challengeId = await saveChallenge(env, options.challenge, 'login', null);
	return json({ challengeId, options });
}

/** Step two: the passkey's signature over the challenge, then a session. */
export async function loginVerify(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const { challenge } = await takeChallenge(env, body.challengeId, 'login');
	const credentialJson = credentialResponse(body);
	if (typeof credentialJson.id !== 'string') throw new BadRequest('missing_credential');
	const { rpID, origin } = relyingParty(request);

	const key = await env.DB.prepare(
		`SELECT passkeys.id, passkeys.user_id, passkeys.public_key, passkeys.counter, passkeys.transports
		 FROM passkeys JOIN users ON users.id = passkeys.user_id AND users.deleted_at IS NULL
		 WHERE passkeys.id = ?`
	)
		.bind(credentialJson.id)
		.first<{
			id: string;
			user_id: string;
			public_key: string;
			counter: number;
			transports: string | null;
		}>();
	// The same answer for an unknown passkey as for a bad signature.
	if (!key) return error(401, 'verification_failed');

	let verification;
	try {
		verification = await verifyAuthenticationResponse({
			response: credentialJson as unknown as AuthenticationResponseJSON,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			credential: {
				id: key.id,
				publicKey: fromBase64url(key.public_key),
				counter: key.counter,
				transports: key.transports ? JSON.parse(key.transports) : undefined
			}
		});
	} catch {
		return error(401, 'verification_failed');
	}
	if (!verification.verified) return error(401, 'verification_failed');

	await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
		.bind(verification.authenticationInfo.newCounter, Date.now(), key.id)
		.run();
	return withCookie(
		json({ user: { id: key.user_id } }),
		await startSession(request, env, key.user_id)
	);
}

export async function me(request: Request, env: Env): Promise<Response> {
	const id = await sessionUser(request, env);
	return json({ user: id ? { id } : null });
}

export async function logout(request: Request, env: Env): Promise<Response> {
	return withCookie(json({ ok: true }), await endSession(request, env));
}
