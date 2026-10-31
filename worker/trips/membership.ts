import { sessionUser } from '../auth/session.ts';
import type { Env } from '../env.ts';
import { BadRequest, error, json, readJson } from '../http.ts';
import { notifyTrips } from './live.ts';

const ID = /^[\w-]{1,64}$/;

/**
 * Ends a partner's place on an open trip. The partner's row is kept, deleted, so it is a record
 * of who was on the trip; and it is put in the change log, which is how the partner's phone is
 * told (`left` in a pull). The trip, its items and whatever the partner added stay with the
 * owner. A finished trip is not touched: it stays in both histories.
 */
async function end(env: Env, tripId: string, partnerId: string): Promise<boolean> {
	const now = Date.now();
	const outcome = await env.DB.batch([
		env.DB.prepare(
			`UPDATE trip_members SET deleted_at = ?, updated_at = ?, updated_by = ?
			 WHERE trip_id = ? AND user_id = ? AND role = 'partner' AND deleted_at IS NULL
			   AND EXISTS (SELECT 1 FROM trips WHERE id = ? AND status = 'open' AND deleted_at IS NULL)`
		).bind(now, now, partnerId, tripId, partnerId, tripId),
		env.DB.prepare(`DELETE FROM changes WHERE table_name = 'trip_members' AND record_id = ?`).bind(
			`${tripId}:${partnerId}`
		),
		env.DB.prepare(
			`INSERT INTO changes (table_name, record_id)
			 SELECT 'trip_members', ? WHERE EXISTS (
			   SELECT 1 FROM trip_members WHERE trip_id = ? AND user_id = ? AND deleted_at = ?
			 )`
		).bind(`${tripId}:${partnerId}`, tripId, partnerId, now)
	]);
	if (!outcome[0].meta.changes) return false;
	// The partner's phone, if it is listening, finds out now.
	await notifyTrips(env, [tripId]);
	return true;
}

async function tripOf(request: Request): Promise<string> {
	const { tripId } = await readJson(request);
	if (typeof tripId !== 'string' || !ID.test(tripId)) throw new BadRequest('invalid_trip');
	return tripId;
}

const status = async (env: Env, tripId: string) =>
	(
		await env.DB.prepare('SELECT status FROM trips WHERE id = ? AND deleted_at IS NULL')
			.bind(tripId)
			.first<{ status: string }>()
	)?.status;

/** The partner leaves the trip they were invited to. */
export async function leaveTrip(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	const tripId = await tripOf(request);
	if (await end(env, tripId, userId)) return json({ left: true });
	// Say why not, without telling a stranger anything about a trip that is not theirs.
	const member = await env.DB.prepare(
		`SELECT 1 AS ok FROM trip_members
		 WHERE trip_id = ? AND user_id = ? AND role = 'partner' AND deleted_at IS NULL`
	)
		.bind(tripId, userId)
		.first();
	if (!member) return error(404, 'trip_not_found');
	return error(409, 'trip_finished');
}

/** The owner takes their partner off the trip. */
export async function removePartner(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	const tripId = await tripOf(request);
	const owner = await env.DB.prepare(
		`SELECT 1 AS ok FROM trip_members
		 WHERE trip_id = ? AND user_id = ? AND role = 'owner' AND deleted_at IS NULL`
	)
		.bind(tripId, userId)
		.first();
	if (!owner) return error(404, 'trip_not_found');
	const partner = await env.DB.prepare(
		`SELECT user_id FROM trip_members
		 WHERE trip_id = ? AND role = 'partner' AND deleted_at IS NULL`
	)
		.bind(tripId)
		.first<{ user_id: string }>();
	if (!partner) return error(409, 'no_partner');
	if ((await status(env, tripId)) !== 'open') return error(409, 'trip_finished');
	if (!(await end(env, tripId, partner.user_id))) return error(409, 'no_partner');
	return json({ removed: true });
}
