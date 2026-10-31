import { DEFAULT_VAT_BPS, tripTotals } from '#lib/money.ts';
import { db, isLive, newId, type Item, type Store, type Trip } from './db';

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

/** Pass undefined to clear it. The receipt total is what was paid, so always incl. VAT. */
export async function setReceiptTotal(
	tripId: string,
	receiptTotalMinor: number | undefined
): Promise<void> {
	if (
		receiptTotalMinor !== undefined &&
		(!Number.isInteger(receiptTotalMinor) || receiptTotalMinor < 0)
	) {
		throw new Error('Enter the total printed on the receipt.');
	}
	await db.transaction('rw', db.trips, async () => {
		const trip = await db.trips.get(tripId);
		if (!isLive(trip) || trip.status !== 'open') throw new Error('This trip is not open.');
		await db.trips.update(tripId, { receiptTotalMinor, updatedAt: Date.now() });
	});
}

/**
 * Receipt minus the app's total incl. VAT, in pence: positive when the till charged more.
 * Undefined until a receipt total is entered.
 */
export function receiptDifference(
	receiptTotalMinor: number | undefined,
	appTotalInclMinor: number
): number | undefined {
	return receiptTotalMinor === undefined ? undefined : receiptTotalMinor - appTotalInclMinor;
}

/** Any difference of a penny or more is a mismatch, and keeps the photos as evidence. */
export const isMismatch = (difference: number | undefined) =>
	difference !== undefined && difference !== 0;

async function liveItems(tripId: string): Promise<Item[]> {
	return (await db.items.where('tripId').equals(tripId).toArray()).filter(isLive);
}

/** Removes the photos outright; items keep their description, price and barcode. */
async function removePhotos(items: Item[], now: number): Promise<void> {
	const withPhotos = items.filter((item) => item.photoId);
	await db.photos.bulkDelete(withPhotos.map((item) => item.photoId!));
	for (const item of withPhotos) {
		await db.items.update(item.id, { photoId: undefined, updatedAt: now });
	}
}

export interface FinishResult {
	photosKept: boolean;
	difference?: number;
}

/**
 * Closes the trip and moves it to history, with its totals as they stand now. The receipt total
 * must have been entered: it is what the trip is checked against. The label photos
 * are deleted unless the receipt total differs from the app's, when they are kept as evidence.
 */
export async function finishTrip(tripId: string): Promise<FinishResult> {
	return db.transaction('rw', [db.trips, db.stores, db.items, db.photos], async () => {
		const trip = await db.trips.get(tripId);
		if (!isLive(trip) || trip.status !== 'open') throw new Error('This trip is not open.');
		const items = await liveItems(tripId);
		if (items.length === 0) throw new Error('Add an item before finishing the trip.');
		if (trip.receiptTotalMinor === undefined) {
			throw new Error('Enter the receipt total before finishing the trip.');
		}
		const store = await db.stores.get(trip.storeId);
		const taxRateBps = store?.taxRateBps ?? DEFAULT_VAT_BPS;
		const { inclMinor, exclMinor, itemCount } = tripTotals(items, taxRateBps);

		const difference = receiptDifference(trip.receiptTotalMinor, inclMinor);
		const photosKept = isMismatch(difference) && items.some((item) => item.photoId);
		const now = Date.now();
		if (!photosKept) await removePhotos(items, now);
		await db.trips.update(tripId, {
			status: 'finished',
			finishedAt: now,
			photosKept,
			totals: { inclMinor, exclMinor, itemCount, taxRateBps },
			updatedAt: now
		});
		return { photosKept, difference };
	});
}

/**
 * Walks out of the store with nothing bought: an open trip with no items is deleted rather
 * than saved to history, so there is no empty trip to clutter it.
 */
export async function leaveTrip(tripId: string): Promise<void> {
	await db.transaction('rw', db.trips, db.items, async () => {
		const trip = await db.trips.get(tripId);
		if (!isLive(trip) || trip.status !== 'open') throw new Error('This trip is not open.');
		if ((await liveItems(tripId)).length > 0) {
			throw new Error('Finish the trip instead, as there are items in the cart.');
		}
		const now = Date.now();
		await db.trips.update(tripId, { deletedAt: now, updatedAt: now });
	});
}

/** Deletes the photos a finished trip kept as receipt evidence, once they are no longer needed. */
export async function deleteTripPhotos(tripId: string): Promise<void> {
	await db.transaction('rw', db.trips, db.items, db.photos, async () => {
		const now = Date.now();
		await removePhotos(await liveItems(tripId), now);
		await db.trips.update(tripId, { photosKept: false, updatedAt: now });
	});
}

export interface FinishedTrip {
	trip: Trip;
	store?: Store;
}

/** Finished trips, newest first, each with its store (undefined if it was since deleted). */
export async function listFinishedTrips(): Promise<FinishedTrip[]> {
	const trips = (await db.trips.where('status').equals('finished').toArray()).filter(isLive);
	trips.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
	const stores = await db.stores.bulkGet([...new Set(trips.map((t) => t.storeId))]);
	const byId = new Map(stores.filter(isLive).map((s) => [s.id, s]));
	return trips.map((trip) => ({ trip, store: byId.get(trip.storeId) }));
}

export async function getTrip(id: string): Promise<Trip | undefined> {
	const trip = await db.trips.get(id);
	return isLive(trip) ? trip : undefined;
}
