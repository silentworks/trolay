import { sessionUser } from '../auth/session.ts';
import type { Env } from '../env.ts';
import { error, json } from '../http.ts';
import { ID, MAX_PHOTOS_PER_TRIP, membership, readImage, servePhoto } from './photos.ts';

// Price tag photos kept in the cloud, for an account that turned "Keep price tag photos in the
// cloud" on. Each is its taker's alone: only their account can upload it or read it back. Unlike
// a shared trip's photos (trips/<trip>/…), these are not deleted when the trip finishes or is
// deleted; they go when the account does (auth/erase.ts).

export const keptKey = (userId: string, photoId: string) => `users/${userId}/photos/${photoId}`;

/** PUT /api/kept-photos/<photo>?trip=<trip>, or GET /api/kept-photos/<photo>. */
export async function keptPhoto(request: Request, env: Env, photoId: string): Promise<Response> {
	if (!ID.test(photoId)) return error(400, 'invalid_id');
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	if (!env.PHOTOS) return error(503, 'photos_unavailable');

	if (request.method === 'GET') {
		const row = await env.DB.prepare(
			'SELECT 1 AS ok FROM kept_photos WHERE user_id = ? AND photo_id = ?'
		)
			.bind(userId, photoId)
			.first();
		const object = row ? await env.PHOTOS.get(keptKey(userId, photoId)) : null;
		if (!object) return error(404, 'photo_not_found');
		return servePhoto(object);
	}

	// PUT: a photo of a trip this account is on, which the server already has.
	const tripId = new URL(request.url).searchParams.get('trip') ?? '';
	if (!ID.test(tripId)) return error(400, 'invalid_trip');
	if (!(await membership(env, userId, tripId))) return error(404, 'trip_not_found');
	const image = await readImage(request);
	if (image instanceof Response) return image;

	const existing = await env.DB.prepare(
		'SELECT 1 AS ok FROM kept_photos WHERE user_id = ? AND photo_id = ?'
	)
		.bind(userId, photoId)
		.first();
	if (!existing) {
		const held = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM kept_photos WHERE user_id = ? AND trip_id = ?'
		)
			.bind(userId, tripId)
			.first<{ n: number }>();
		if ((held?.n ?? 0) >= MAX_PHOTOS_PER_TRIP) return error(413, 'too_many_photos');
	}
	await env.PHOTOS.put(keptKey(userId, photoId), image.bytes, {
		httpMetadata: { contentType: image.type }
	});
	await env.DB.prepare(
		`INSERT OR REPLACE INTO kept_photos (user_id, photo_id, trip_id, size, content_type, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	)
		.bind(userId, photoId, tripId, image.bytes.byteLength, image.type, Date.now())
		.run();
	return json({ ok: true }, 201);
}
