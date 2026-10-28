import Dexie, { type EntityTable } from 'dexie';

// Every record that will sync (phase 4) carries this metadata from day one, so adding sync
// later needs no migration. Deletes are tombstones: `deletedAt` is set instead of removing
// the row, which also makes undo trivial.
export interface SyncMeta {
	updatedAt: number;
	updatedBy?: string;
	deletedAt?: number;
}

export interface Store extends SyncMeta {
	id: string;
	ownerId?: string;
	name: string;
	branch?: string;
	/** VAT rate in basis points: 2000 = 20%. */
	taxRateBps: number;
	pricesIncludeTax: boolean;
	createdAt: number;
	lastUsedAt: number;
}

export type TripStatus = 'open' | 'finished';

export interface Trip extends SyncMeta {
	id: string;
	ownerId?: string;
	storeId: string;
	status: TripStatus;
	budgetMinor?: number;
	/** The till receipt's total, incl. VAT, entered or read before finishing. */
	receiptTotalMinor?: number;
	/** Set on finish when the receipt did not match, so the label photos stay as evidence. */
	photosKept: boolean;
	startedAt: number;
	finishedAt?: number;
	/**
	 * Totals as they stood at finish. A finished trip keeps them even if the store's VAT rate is
	 * edited later.
	 */
	totals?: { inclMinor: number; exclMinor: number; itemCount: number; taxRateBps: number };
}

/** What the label reader extracted (phase 2), kept so an edited item can be reverted. */
export interface ExtractedFields {
	description?: string;
	unitPriceMinor?: number;
	priceIncludesTax?: boolean;
	confidence: number;
}

export interface Item extends SyncMeta {
	id: string;
	tripId: string;
	description: string;
	barcode?: string;
	unitPriceMinor: number;
	priceIncludesTax: boolean;
	quantity: number;
	photoId?: string;
	extracted?: ExtractedFields;
	edited: boolean;
	addedBy?: string;
	createdAt: number;
}

export interface Photo extends SyncMeta {
	id: string;
	itemId: string;
	blob: Blob;
	thumbBlob: Blob;
	createdAt: number;
}

export interface ProductCacheEntry {
	barcode: string;
	/** Empty when Open Food Facts doesn't list the product, so it isn't asked again. */
	name: string;
	source: 'openfoodfacts' | 'own-item';
	fetchedAt: number;
}

/** A barcode whose Open Food Facts lookup failed for lack of signal, to retry later. */
export interface PendingLookup {
	barcode: string;
	queuedAt: number;
}

export class TrolleyDB extends Dexie {
	stores!: EntityTable<Store, 'id'>;
	trips!: EntityTable<Trip, 'id'>;
	items!: EntityTable<Item, 'id'>;
	photos!: EntityTable<Photo, 'id'>;
	productCache!: EntityTable<ProductCacheEntry, 'barcode'>;
	pendingLookups!: EntityTable<PendingLookup, 'barcode'>;

	constructor(name = 'trolay') {
		super(name);
		this.version(1).stores({
			stores: 'id, lastUsedAt',
			trips: 'id, status, storeId, startedAt',
			items: 'id, tripId, [tripId+createdAt], barcode',
			photos: 'id, itemId',
			productCache: 'barcode'
		});
		this.version(2).stores({ pendingLookups: 'barcode' });
	}
}

export const db = new TrolleyDB();

export function newId(): string {
	return crypto.randomUUID();
}

export function isLive<T extends SyncMeta>(record: T | undefined): record is T {
	return record !== undefined && record.deletedAt === undefined;
}

/**
 * Asks the browser not to evict our data under storage pressure. Installed PWAs are usually
 * granted this automatically; elsewhere the browser may decide silently.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (!navigator.storage?.persist) return false;
	if (await navigator.storage.persisted()) return true;
	return navigator.storage.persist();
}
