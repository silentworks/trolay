import Dexie, { type EntityTable } from 'dexie';
import { installPendingHooks, type Pending } from '#lib/sync/pending.ts';
import { SYNC_FIELDS, SYNC_TABLES } from '#lib/sync/schema.ts';

// Every record that will sync (phase 4) carries this metadata from day one, so adding sync
// later needs no migration. Deletes are tombstones: `deletedAt` is set instead of removing
// the row, which also makes undo trivial.
export interface SyncMeta {
	updatedAt: number;
	updatedBy?: string;
	deletedAt?: number;
}

export interface Store extends SyncMeta, Pending {
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

export interface Trip extends SyncMeta, Pending {
	id: string;
	ownerId?: string;
	storeId: string;
	status: TripStatus;
	budgetMinor?: number;
	/** A discount off the whole trolley: `discountValue` is pence or basis points by `discountKind`. */
	discountKind?: 'amount' | 'percent';
	discountValue?: number;
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
	totals?: {
		inclMinor: number;
		exclMinor: number;
		itemCount: number;
		taxRateBps: number;
		/** Taken off inclMinor already; absent when there was no discount. */
		discountMinor?: number;
	};
}

/** What the label reader extracted (phase 2), kept so an edited item can be reverted. */
export interface ExtractedFields {
	description?: string;
	unitPriceMinor?: number;
	priceIncludesTax?: boolean;
	confidence: number;
}

export interface Item extends SyncMeta, Pending {
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
	/** The photo is on the server too, for the partner on a shared trip (src/lib/sync/photos.ts). */
	uploaded?: boolean;
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

/** Small facts about syncing, by name (see sync/core.ts). */
export interface SyncState {
	key: string;
	value: unknown;
}

export class TrolleyDB extends Dexie {
	stores!: EntityTable<Store, 'id'>;
	trips!: EntityTable<Trip, 'id'>;
	items!: EntityTable<Item, 'id'>;
	photos!: EntityTable<Photo, 'id'>;
	productCache!: EntityTable<ProductCacheEntry, 'barcode'>;
	pendingLookups!: EntityTable<PendingLookup, 'barcode'>;
	syncState!: EntityTable<SyncState, 'key'>;

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
		// Records with changes still to send are found through pendingAt (see sync/pending.ts);
		// syncState holds where the last pull got to.
		this.version(3)
			.stores({
				stores: 'id, lastUsedAt, pendingAt',
				trips: 'id, status, storeId, startedAt, pendingAt',
				items: 'id, tripId, [tripId+createdAt], barcode, pendingAt',
				syncState: 'key'
			})
			.upgrade(async (transaction) => {
				// Everything made before syncing existed is waiting to be sent, so signing in uploads it.
				for (const name of SYNC_TABLES) {
					await transaction
						.table(name)
						.toCollection()
						.modify((record) => {
							const at = record.updatedAt ?? Date.now();
							record.pending = Object.fromEntries(
								Object.keys(SYNC_FIELDS[name])
									.filter((field) => record[field] !== undefined)
									.map((field) => [field, at])
							);
							record.pendingAt = at;
						});
				}
			});
		installPendingHooks(this);
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
