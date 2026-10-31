import { sessionUser } from '../auth/session.ts';
import type { Env } from '../env.ts';
import { error } from '../http.ts';

const ID = /^[\w-]{1,64}$/;

/** The room for a trip: one Durable Object per trip, found by the trip's id. */
function room(env: Env, tripId: string): DurableObjectStub | undefined {
	return env.TRIPS?.get(env.TRIPS.idFromName(tripId));
}

/**
 * Opens a WebSocket for the phones on an open trip. The phone is told when the trip changes (and
 * then fetches the change the way it always does, by syncing), so what travels here is only a
 * nudge, never data: everything is still checked by the sync API.
 */
export async function liveTrip(request: Request, env: Env): Promise<Response> {
	const userId = await sessionUser(request, env);
	if (!userId) return error(401, 'unauthorized');
	// A WebSocket handshake is a GET that carries cookies from any site, so check where it is from.
	const origin = request.headers.get('Origin');
	if (origin !== null && origin !== new URL(request.url).origin) return error(403, 'cross_site');
	const tripId = new URL(request.url).searchParams.get('trip') ?? '';
	if (!ID.test(tripId)) return error(400, 'invalid_trip');

	const trip = await env.DB.prepare(
		`SELECT trips.status FROM trips
		 JOIN trip_members m ON m.trip_id = trips.id AND m.user_id = ? AND m.deleted_at IS NULL
		 WHERE trips.id = ? AND trips.deleted_at IS NULL`
	)
		.bind(userId, tripId)
		.first<{ status: string }>();
	if (!trip) return error(404, 'trip_not_found');
	if (trip.status !== 'open') return error(409, 'trip_finished');
	if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
		return error(426, 'upgrade_required');
	}
	const stub = room(env, tripId);
	if (!stub) return error(503, 'live_unavailable');
	return stub.fetch(new Request('https://room/connect', request));
}

/**
 * Tells the phones on these trips that something changed, and whether the trip has finished (so
 * the room can let go of them). Best effort: the phones also sync on their own, so a missed
 * nudge only costs a delay.
 */
export async function notifyTrips(env: Env, tripIds: Iterable<string>): Promise<void> {
	if (!env.TRIPS) return;
	await Promise.all(
		[...new Set(tripIds)].map(async (tripId) => {
			try {
				const trip = await env.DB.prepare('SELECT status, deleted_at FROM trips WHERE id = ?')
					.bind(tripId)
					.first<{ status: string; deleted_at: number | null }>();
				const over = !trip || trip.status !== 'open' || trip.deleted_at !== null;
				await room(env, tripId)!.fetch(
					new Request('https://room/changed', {
						method: 'POST',
						body: JSON.stringify({ over })
					})
				);
			} catch (cause) {
				console.warn('Could not notify the trip room', cause);
			}
		})
	);
}
