import { isLive, type TrolleyDB } from '#lib/data/db.ts';
import type { LeftTrip } from './schema.ts';

/**
 * Lets go of a shared trip this account is no longer on (it left, or the owner took it off): an
 * open trip, its items and their photos are removed from this phone, since they can no longer be
 * synced, and so is the owner's store if no other trip here uses it. Only that store: this
 * account's own stores have ids of their own, and a finished trip is left alone, because it
 * stays in both histories. Nothing is queued to sync: this is not a delete the owner should see.
 *
 * Returns the store's name when an open trip was let go of, and undefined when there was
 * nothing to do (the phone never had it, or it has finished).
 */
export async function letGoOfTrip(
	db: TrolleyDB,
	{ tripId, storeId }: LeftTrip
): Promise<string | undefined> {
	return db.transaction('rw', db.stores, db.trips, db.items, db.photos, async () => {
		const trip = await db.trips.get(tripId);
		if (!trip || trip.status !== 'open') return undefined;
		const store = await db.stores.get(storeId);

		const items = await db.items.where('tripId').equals(tripId).toArray();
		await db.photos.bulkDelete(
			items.map((item) => item.photoId).filter((id): id is string => id !== undefined)
		);
		await db.items.bulkDelete(items.map((item) => item.id));
		await db.trips.delete(tripId);

		const stillUsed = (await db.trips.where('storeId').equals(storeId).toArray()).some(isLive);
		if (store && !stillUsed) await db.stores.delete(storeId);
		return store?.name ?? '';
	});
}
