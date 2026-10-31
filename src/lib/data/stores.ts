import { DEFAULT_VAT_BPS } from '#lib/money.ts';
import { db, isLive, newId, type Store } from './db';
import { deleteTrip } from './trips';

export interface StoreInput {
	name: string;
	branch?: string;
	taxRateBps?: number;
	pricesIncludeTax?: boolean;
}

function cleanName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('A store needs a name.');
	return trimmed;
}

function cleanBranch(branch: string | undefined): string | undefined {
	return branch?.trim() || undefined;
}

/** UK defaults: 20% VAT, shelf labels include VAT. */
export async function addStore(input: StoreInput): Promise<Store> {
	const now = Date.now();
	const store: Store = {
		id: newId(),
		name: cleanName(input.name),
		branch: cleanBranch(input.branch),
		taxRateBps: input.taxRateBps ?? DEFAULT_VAT_BPS,
		pricesIncludeTax: input.pricesIncludeTax ?? true,
		createdAt: now,
		lastUsedAt: now,
		updatedAt: now
	};
	await db.stores.add(store);
	return store;
}

export async function updateStore(id: string, input: StoreInput): Promise<void> {
	await db.stores.update(id, {
		name: cleanName(input.name),
		branch: cleanBranch(input.branch),
		...(input.taxRateBps !== undefined && { taxRateBps: input.taxRateBps }),
		...(input.pricesIncludeTax !== undefined && { pricesIncludeTax: input.pricesIncludeTax }),
		updatedAt: Date.now()
	});
}

/** Most recently used first. */
export async function listStores(): Promise<Store[]> {
	const stores = await db.stores.orderBy('lastUsedAt').reverse().toArray();
	return stores.filter(isLive);
}

export async function getStore(id: string): Promise<Store | undefined> {
	const store = await db.stores.get(id);
	return isLive(store) ? store : undefined;
}

/**
 * Deletes a store. Its past trips stay in history under "Deleted store", or go too when
 * `withHistory` is set. A store being shopped at right now can't go.
 */
export async function deleteStore(id: string, withHistory = false): Promise<void> {
	await db.transaction('rw', [db.stores, db.trips, db.items, db.photos], async () => {
		const store = await db.stores.get(id);
		if (!isLive(store)) return;
		const trips = (await db.trips.where('storeId').equals(id).toArray()).filter(isLive);
		if (trips.some((trip) => trip.status === 'open')) {
			throw new Error('Finish or leave the current trip first.');
		}
		if (withHistory) for (const trip of trips) await deleteTrip(trip.id);
		const now = Date.now();
		await db.stores.update(id, { deletedAt: now, updatedAt: now });
	});
}
