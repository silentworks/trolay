import { db, isLive, newId, type Trip } from './db';

export async function getOpenTrip(): Promise<Trip | undefined> {
	const trips = await db.trips.where('status').equals('open').toArray();
	return trips.find((trip) => isLive(trip));
}

/** Only one trip can be open at a time; starting one marks its store as just used. */
export async function startTrip(storeId: string, budgetMinor?: number): Promise<Trip> {
	return db.transaction('rw', db.trips, db.stores, async () => {
		if (await getOpenTrip()) throw new Error('Finish the current trip before starting another.');
		const store = await db.stores.get(storeId);
		if (!isLive(store)) throw new Error('That store no longer exists.');

		const now = Date.now();
		const trip: Trip = {
			id: newId(),
			storeId,
			status: 'open',
			budgetMinor,
			photosKept: false,
			startedAt: now,
			updatedAt: now
		};
		await db.trips.add(trip);
		await db.stores.update(storeId, { lastUsedAt: now, updatedAt: now });
		return trip;
	});
}

/** A trip belongs to exactly one store, so its store can only change while the cart is empty. */
export async function changeTripStore(tripId: string, storeId: string): Promise<void> {
	await db.transaction('rw', db.trips, db.stores, db.items, async () => {
		const items = await db.items.where('tripId').equals(tripId).toArray();
		if (items.some((item) => isLive(item))) {
			throw new Error('The store can only be changed while the cart is empty.');
		}
		const store = await db.stores.get(storeId);
		if (!isLive(store)) throw new Error('That store no longer exists.');

		const now = Date.now();
		await db.trips.update(tripId, { storeId, updatedAt: now });
		await db.stores.update(storeId, { lastUsedAt: now, updatedAt: now });
	});
}

/** Pass undefined to remove the budget. */
export async function setTripBudget(
	tripId: string,
	budgetMinor: number | undefined
): Promise<void> {
	if (budgetMinor !== undefined && (!Number.isInteger(budgetMinor) || budgetMinor <= 0)) {
		throw new Error('The budget must be more than £0.');
	}
	await db.trips.update(tripId, { budgetMinor, updatedAt: Date.now() });
}
