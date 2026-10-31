import { sessionUser } from '../auth/session.ts';
import type { Env } from '../env.ts';
import { error, json } from '../http.ts';
import { notifyTrips } from './live.ts';

// Label photos for a trip shared with a partner. The phone that took a photo uploads it, and the
// partner's phone fetches it, so both see the items' photos. A photo lives here only while the
// trip is open: finishing the trip deletes it, unless it was kept as receipt evidence.

/** A photo is compressed to 1600 px on the long side, which is well under this. */
const MAX_BYTES = 2 * 1024 * 1024;
const ID = /^[\w-]{1,64}$/;
const TYPES = new Set(['image/jpeg', 'image/webp', 'image/png']);

export const photoKey = (tripId: string, photoId: string) => `trips/${tripId}/${photoId}`;

async function membership(env: Env, userId: string, tripId: string) {
	return env.DB.prepare(
		`SELECT trips.status FROM trips
		 JOIN trip_members m ON m.trip_id = trips.id AND m.user_id = ? AND m.deleted_at IS NULL
		 WHERE trips.id = ? AND trips.deleted_at IS NULL`
	)
		.bind(userId, tripId)
		.first<{ status: string }>();
}

/** PUT or GET /api/trips/<trip>/photos/<photo>. */
export async function photo(
	request: Request,
	env: Env,
	tripId: string,
	photoId: string
): Promise<Response> {
	if (!ID.test(tripId) || !ID.test(photoId)) return error(400, 'invalid_id');
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	if (!env.PHOTOS) return error(503, 'photos_unavailable');
	const trip = await membership(env, userId, tripId);
	if (!trip) return error(404, 'trip_not_found');

	if (request.method === 'GET') {
		const object = await env.PHOTOS.get(photoKey(tripId, photoId));
		if (!object) return error(404, 'photo_not_found');
		return new Response(object.body, {
			headers: {
				'Content-Type': object.httpMetadata?.contentType ?? 'image/jpeg',
				// A photo's id is never reused for different bytes, so it can be kept.
				'Cache-Control': 'private, max-age=86400, immutable'
			}
		});
	}

	// PUT: only while the trip is open, so a finished trip's photos are not brought back.
	if (trip.status !== 'open') return error(409, 'trip_finished');
	const type = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
	if (!TYPES.has(type)) return error(415, 'unsupported_type');
	const declared = Number(request.headers.get('Content-Length') ?? 0);
	if (declared > MAX_BYTES) return error(413, 'too_large');
	const bytes = await request.arrayBuffer();
	if (bytes.byteLength > MAX_BYTES) return error(413, 'too_large');
	if (!bytes.byteLength) return error(400, 'empty');
	await env.PHOTOS.put(photoKey(tripId, photoId), bytes, { httpMetadata: { contentType: type } });
	// The partner's phone is told, and fetches it.
	await notifyTrips(env, [tripId]);
	return json({ ok: true }, 201);
}

/**
 * Deletes a finished trip's photos from R2 unless they were kept as receipt evidence. Called
 * whenever a trip changes, so it also removes them when evidence is deleted later.
 */
export async function cleanUpPhotos(env: Env, tripId: string): Promise<void> {
	if (!env.PHOTOS) return;
	const trip = await env.DB.prepare(
		'SELECT status, photos_kept, deleted_at FROM trips WHERE id = ?'
	)
		.bind(tripId)
		.first<{ status: string; photos_kept: number; deleted_at: number | null }>();
	if (!trip) return;
	const gone = trip.deleted_at !== null;
	if (!gone && (trip.status !== 'finished' || trip.photos_kept === 1)) return;
	let cursor: string | undefined;
	do {
		const page = await env.PHOTOS.list({ prefix: `trips/${tripId}/`, cursor });
		if (page.objects.length) await env.PHOTOS.delete(page.objects.map((object) => object.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

/** Who is on a trip, for showing who added what and for knowing whether it is shared. */
export async function members(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	const tripId = new URL(request.url).searchParams.get('trip') ?? '';
	if (!ID.test(tripId)) return error(400, 'invalid_trip');
	if (!(await membership(env, userId, tripId))) return error(404, 'trip_not_found');
	const { results } = await env.DB.prepare(
		`SELECT m.user_id, m.role, users.email FROM trip_members m
		 JOIN users ON users.id = m.user_id
		 WHERE m.trip_id = ? AND m.deleted_at IS NULL ORDER BY m.role DESC`
	)
		.bind(tripId)
		.all<{ user_id: string; role: string; email: string | null }>();
	return json({
		members: results.map((row) => ({
			id: row.user_id,
			role: row.role,
			// All a person's name is, for now: the part of their email before the @.
			name: row.email?.split('@')[0] ?? null
		}))
	});
}
