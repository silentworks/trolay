import type { Env } from '../env.ts';
import { dropFromTrip, notifyTrips } from '../trips/live.ts';
import { deletePhotos } from '../trips/photos.ts';

// Deleting an account: everything it synced goes, its photos kept in the cloud too, and it can
// never sign in again.
//
// A trip it owns that has a partner on it is the one exception. The partner's phone learns that a
// trip is gone the way it does when they are taken off one: their membership row is ended and put
// in the change log (`left` in a pull). That row needs the trip, the trip needs its store and both
// need the account, so those few rows stay behind as empty tombstones: ids and dates, with every
// name, price and total cleared. Everything else is deleted outright.
//
// The database part is one batch, so it happens entirely or not at all. Photos are deleted first:
// if that fails part way, nothing else has changed, and trying again finishes the job.

/** The trips the account owns. */
const OWNED = 'SELECT id FROM trips WHERE owner_id = ?1';

/** A trip of the account's with a partner on it now. */
const SHARED = `EXISTS (SELECT 1 FROM trip_members p
	WHERE p.trip_id = trips.id AND p.role = 'partner' AND p.deleted_at IS NULL)`;

/** A trip whose partner this deletion has just taken off it: it stays, as a tombstone. */
const KEPT = `EXISTS (SELECT 1 FROM trip_members p
	WHERE p.trip_id = trips.id AND p.role = 'partner' AND p.deleted_at = ?2 AND p.updated_by = ?1)`;

export async function eraseAccount(env: Env, userId: string): Promise<void> {
	const db = env.DB;
	const now = Date.now();

	// Photos are only ever uploaded for a trip with a partner, or kept as receipt evidence.
	const withPhotos = (
		await db
			.prepare(
				`SELECT id FROM trips WHERE owner_id = ? AND (photos_kept = 1 OR status = 'open'
				 OR EXISTS (SELECT 1 FROM trip_members p WHERE p.trip_id = trips.id AND p.role = 'partner'))`
			)
			.bind(userId)
			.all<{ id: string }>()
	).results;
	for (const trip of withPhotos) await deletePhotos(env, `trips/${trip.id}/`);
	// And every price tag photo it kept in the cloud.
	await deletePhotos(env, `users/${userId}/`);

	// Who to tell, once it is done.
	const partners = (
		await db
			.prepare(
				`SELECT m.trip_id, m.user_id FROM trip_members m JOIN trips t ON t.id = m.trip_id
				 WHERE t.owner_id = ? AND m.role = 'partner' AND m.deleted_at IS NULL`
			)
			.bind(userId)
			.all<{ trip_id: string; user_id: string }>()
	).results;
	const joined = (
		await db
			.prepare(
				`SELECT trip_id FROM trip_members
				 WHERE user_id = ? AND role = 'partner' AND deleted_at IS NULL`
			)
			.bind(userId)
			.all<{ trip_id: string }>()
	).results;

	// ?1 is the account and ?2 the time, in each statement that uses it.
	const run = (sql: string) =>
		db.prepare(sql).bind(...(sql.includes('?2') ? [userId, now] : [userId]));
	await db.batch([
		// Every item in the account's trips.
		run(
			`DELETE FROM changes WHERE table_name = 'items'
			 AND record_id IN (SELECT id FROM items WHERE trip_id IN (${OWNED}))`
		),
		run(`DELETE FROM items WHERE trip_id IN (${OWNED})`),
		// Invites to its trips and invites it sent; invites it accepted forget it.
		run(`DELETE FROM trip_invites WHERE (trip_id IN (${OWNED}) OR inviter_id = ?1)`),
		run(`UPDATE trip_invites SET accepted_by = NULL WHERE accepted_by = ?1`),
		// A trip with a partner becomes an empty tombstone, and the partner is taken off it.
		run(
			`UPDATE trips SET deleted_at = COALESCE(deleted_at, ?2), budget_minor = NULL,
			   receipt_total_minor = NULL, totals = NULL, discount_kind = NULL, discount_value = NULL,
			   photos_kept = 0, field_times = '{}', updated_at = ?2, updated_by = ?1
			 WHERE owner_id = ?1 AND ${SHARED}`
		),
		run(
			`UPDATE trip_members SET deleted_at = ?2, updated_at = ?2, updated_by = ?1
			 WHERE role = 'partner' AND deleted_at IS NULL AND trip_id IN (${OWNED})`
		),
		run(
			`INSERT OR REPLACE INTO changes (table_name, record_id)
			 SELECT 'trip_members', trip_id || ':' || user_id FROM trip_members
			 WHERE role = 'partner' AND deleted_at = ?2 AND updated_by = ?1 AND trip_id IN (${OWNED})`
		),
		run(
			`UPDATE trip_members SET deleted_at = COALESCE(deleted_at, ?2), updated_at = ?2, updated_by = ?1
			 WHERE user_id = ?1 AND role = 'owner' AND trip_id IN (SELECT id FROM trips WHERE owner_id = ?1 AND ${KEPT})`
		),
		// Every other trip goes, with its members.
		run(
			`DELETE FROM trip_members WHERE trip_id IN (SELECT id FROM trips WHERE owner_id = ?1 AND NOT ${KEPT})`
		),
		run(`DELETE FROM changes WHERE table_name = 'trips' AND record_id IN (${OWNED})`),
		run(`DELETE FROM trips WHERE owner_id = ?1 AND NOT ${KEPT}`),
		// Its stores: deleted, but for one a tombstone trip is at, which is emptied.
		run(
			`DELETE FROM changes WHERE table_name = 'stores'
			 AND record_id IN (SELECT id FROM stores WHERE owner_id = ?1)`
		),
		run(
			`DELETE FROM stores WHERE owner_id = ?1
			 AND NOT EXISTS (SELECT 1 FROM trips WHERE trips.store_id = stores.id)`
		),
		run(
			`UPDATE stores SET name = '', branch = NULL, currency = NULL,
			   deleted_at = COALESCE(deleted_at, ?2), field_times = '{}', updated_at = ?2, updated_by = ?1
			 WHERE owner_id = ?1`
		),
		// Its place on other people's trips. What it added to them stays: it is the owner's trip.
		run(
			`DELETE FROM changes WHERE table_name = 'trip_members'
			 AND record_id IN (SELECT trip_id || ':' || user_id FROM trip_members WHERE user_id = ?1 AND role = 'partner')`
		),
		run(`DELETE FROM trip_members WHERE user_id = ?1 AND role = 'partner'`),
		run(`DELETE FROM kept_photos WHERE user_id = ?1`),
		// Signing in, every way.
		run(`DELETE FROM sessions WHERE user_id = ?1`),
		run(`DELETE FROM passkeys WHERE user_id = ?1`),
		run(`DELETE FROM challenges WHERE user_id = ?1`),
		run(
			`DELETE FROM login_codes WHERE (user_id = ?1
			   OR email = (SELECT email FROM users WHERE id = ?1))`
		),
		// The account itself: gone, or an empty tombstone while a tombstone trip needs it.
		run(
			`DELETE FROM users WHERE id = ?1
			 AND NOT EXISTS (SELECT 1 FROM trips WHERE owner_id = ?1)
			 AND NOT EXISTS (SELECT 1 FROM stores WHERE owner_id = ?1)
			 AND NOT EXISTS (SELECT 1 FROM trip_members WHERE user_id = ?1)`
		),
		run(
			`UPDATE users SET email = NULL, deleted_at = COALESCE(deleted_at, ?2), updated_at = ?2,
			   updated_by = ?1 WHERE id = ?1`
		)
	]);

	// The partners' phones let go of the trips now, rather than at their next sync; the owners of
	// trips it was on see it gone from them.
	for (const { trip_id, user_id } of partners) await dropFromTrip(env, trip_id, user_id);
	await notifyTrips(env, [...partners.map((p) => p.trip_id), ...joined.map((j) => j.trip_id)]);
}
