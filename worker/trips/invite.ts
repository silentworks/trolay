import { sessionUser } from '../auth/session.ts';
import { randomToken, sha256 } from '../auth/tokens.ts';
import type { Env } from '../env.ts';
import { BadRequest, error, json, readJson } from '../http.ts';
import { notifyTrips } from './live.ts';

const HOUR = 60 * 60 * 1000;
/** How long an invite link works. It is for someone beside you, so not long. */
export const INVITE_LIFETIME = 24 * HOUR;
/** Invites one person may make an hour, so the endpoint can't be used to fill the table. */
const PER_USER_HOUR = 20;

const ID = /^[\w-]{1,64}$/;

/** Whether the trip already has a partner, other than `except`. */
const partnerOf = (env: Env, tripId: string) =>
	env.DB.prepare(
		`SELECT user_id FROM trip_members
		 WHERE trip_id = ? AND role = 'partner' AND deleted_at IS NULL`
	)
		.bind(tripId)
		.first<{ user_id: string }>();

/**
 * Makes an invite link for an open trip of yours. Making another replaces the one before it, so
 * only the newest link works. The trip must have reached the server (the app syncs first).
 */
export async function createInvite(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	const { tripId } = await readJson(request);
	if (typeof tripId !== 'string' || !ID.test(tripId)) throw new BadRequest('invalid_trip');

	// Anyone who is not the owner is told the trip is not found, as for a trip that is not there.
	const trip = await env.DB.prepare(
		`SELECT trips.status FROM trips
		 JOIN trip_members m ON m.trip_id = trips.id AND m.user_id = ? AND m.role = 'owner'
		   AND m.deleted_at IS NULL
		 WHERE trips.id = ? AND trips.deleted_at IS NULL`
	)
		.bind(userId, tripId)
		.first<{ status: string }>();
	if (!trip) return error(404, 'trip_not_found');
	if (trip.status !== 'open') return error(409, 'trip_finished');
	if (await partnerOf(env, tripId)) return error(409, 'trip_full');

	const now = Date.now();
	const made = await env.DB.prepare(
		'SELECT COUNT(*) AS n FROM trip_invites WHERE inviter_id = ? AND created_at > ?'
	)
		.bind(userId, now - HOUR)
		.first<{ n: number }>();
	if ((made?.n ?? 0) >= PER_USER_HOUR) return error(429, 'too_many_requests');

	const token = randomToken();
	await env.DB.batch([
		env.DB.prepare('DELETE FROM trip_invites WHERE trip_id = ? AND used_at IS NULL').bind(tripId),
		env.DB.prepare(
			`INSERT INTO trip_invites (token_hash, trip_id, inviter_id, created_at, expires_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(await sha256(token), tripId, userId, now, now + INVITE_LIFETIME)
	]);

	// The token is in the fragment, so it stays out of server logs and referrers.
	const link = `${env.APP_ORIGIN ?? new URL(request.url).origin}/join#token=${token}`;
	return json({ link, expiresAt: now + INVITE_LIFETIME }, 201);
}

/** Accepts an invite: the signed-in person becomes the trip's partner. */
export async function acceptInvite(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	const { token } = await readJson(request);
	if (typeof token !== 'string' || token.length > 200) throw new BadRequest('invalid_token');
	const hash = await sha256(token);
	const now = Date.now();

	const invite = await env.DB.prepare(
		`SELECT i.trip_id, i.inviter_id, t.status, s.name, s.branch
		 FROM trip_invites i
		 JOIN trips t ON t.id = i.trip_id AND t.deleted_at IS NULL
		 JOIN stores s ON s.id = t.store_id
		 WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ?`
	)
		.bind(hash, now)
		.first<{
			trip_id: string;
			inviter_id: string;
			status: string;
			name: string;
			branch: string | null;
		}>();
	if (!invite) return error(400, 'invite_invalid');
	if (invite.status !== 'open') return error(409, 'trip_finished');
	if (invite.inviter_id === userId) return error(400, 'own_trip');
	const partner = await partnerOf(env, invite.trip_id);
	if (partner) return error(409, partner.user_id === userId ? 'already_member' : 'trip_full');

	const tripId = invite.trip_id;
	try {
		// All or nothing. The unique index on partners is what stops two people both getting in;
		// the invite is only used up if the partner row went in.
		const outcome = await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO trip_members (trip_id, user_id, role, created_at, updated_at, updated_by)
				 SELECT ?, ?, 'partner', ?, ?, ? WHERE EXISTS (
				   SELECT 1 FROM trip_invites WHERE token_hash = ? AND used_at IS NULL
				 )
				 ON CONFLICT (trip_id, user_id) DO UPDATE SET
				   role = 'partner', deleted_at = NULL, updated_at = excluded.updated_at,
				   updated_by = excluded.updated_by
				 WHERE trip_members.role != 'owner'`
			).bind(tripId, userId, now, now, userId, hash),
			env.DB.prepare(
				`UPDATE trip_invites SET used_at = ?, accepted_by = ?
				 WHERE token_hash = ? AND used_at IS NULL
				   AND EXISTS (SELECT 1 FROM trip_members
				               WHERE trip_id = ? AND user_id = ? AND role = 'partner' AND deleted_at IS NULL)`
			).bind(now, userId, hash, tripId, userId),
			// The trip, its items and its store move to the end of the change log, so the partner's
			// phone, wherever its position is, picks them up as new.
			env.DB.prepare(
				`DELETE FROM changes WHERE (table_name = 'trips' AND record_id = ?)
				 OR (table_name = 'items' AND record_id IN (SELECT id FROM items WHERE trip_id = ?))`
			).bind(tripId, tripId),
			env.DB.prepare(`INSERT INTO changes (table_name, record_id) VALUES ('trips', ?)`).bind(
				tripId
			),
			// Someone who left and comes back is no longer told they have left.
			env.DB.prepare(
				`DELETE FROM changes WHERE table_name = 'trip_members' AND record_id = ?`
			).bind(`${tripId}:${userId}`),
			// And the store it is at, which the partner is allowed to see.
			env.DB.prepare(
				`DELETE FROM changes WHERE table_name = 'stores'
				 AND record_id = (SELECT store_id FROM trips WHERE id = ?)`
			).bind(tripId),
			env.DB.prepare(
				`INSERT INTO changes (table_name, record_id)
				 SELECT 'stores', store_id FROM trips WHERE id = ?`
			).bind(tripId),
			env.DB.prepare(
				`INSERT INTO changes (table_name, record_id)
				 SELECT 'items', id FROM items WHERE trip_id = ?`
			).bind(tripId)
		]);
		if (!outcome[1].meta.changes) {
			// Somebody else used the link a moment ago: say the trip is full if that is what is true.
			return (await partnerOf(env, tripId))
				? error(409, 'trip_full')
				: error(400, 'invite_invalid');
		}
	} catch (cause) {
		// Somebody else took the partner place between the check and the insert.
		if (String(cause).includes('UNIQUE')) return error(409, 'trip_full');
		throw cause;
	}
	// The owner's phone is told, so it starts sharing photos without waiting for its next round.
	await notifyTrips(env, [tripId]);
	return json({ tripId, store: { name: invite.name, branch: invite.branch } });
}
