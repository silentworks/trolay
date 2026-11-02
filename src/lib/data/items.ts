import Dexie from 'dexie';
import { isValidGtin } from '../capture/gtin';
import type { CompressedPhoto } from '../capture/image';
import { db, isLive, newId, type ExtractedFields, type Item, type Photo } from './db';

export interface ItemInput {
	description: string;
	unitPriceMinor: number;
	priceIncludesTax: boolean;
	quantity: number;
	barcode?: string;
	/** A multi-buy offer: give both or neither. */
	offerQuantity?: number;
	offerPriceMinor?: number;
}

function validate(input: ItemInput): ItemInput {
	const description = input.description.trim();
	if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
		throw new Error('Enter a valid price.');
	}
	if (!Number.isInteger(input.quantity) || input.quantity < 1) {
		throw new Error('Quantity must be at least 1.');
	}
	const { offerQuantity, offerPriceMinor } = input;
	if ((offerQuantity === undefined) !== (offerPriceMinor === undefined)) {
		throw new Error('Give both how many and what they cost together, or neither.');
	}
	if (
		offerQuantity !== undefined &&
		(!Number.isInteger(offerQuantity) ||
			offerQuantity < 2 ||
			!Number.isInteger(offerPriceMinor) ||
			offerPriceMinor! <= 0)
	) {
		throw new Error('A multi-buy offer is for 2 or more items, at a price above £0.');
	}
	const barcode = input.barcode?.replace(/\s/g, '') || undefined;
	if (barcode !== undefined && !isValidGtin(barcode)) {
		throw new Error('Check the barcode: it should be the 8, 12 or 13 digits under the bars.');
	}
	// With a barcode the name can be looked up later, once there is signal.
	if (!description && !barcode) throw new Error('Add a description.');
	return { ...input, description, barcode };
}

/** True when any field the label reader filled in has since been changed by hand. */
function differsFromExtracted(item: ItemInput, extracted: ExtractedFields | undefined): boolean {
	if (!extracted) return false;
	return (
		(extracted.description !== undefined && extracted.description !== item.description) ||
		(extracted.unitPriceMinor !== undefined && extracted.unitPriceMinor !== item.unitPriceMinor) ||
		(extracted.priceIncludesTax !== undefined &&
			extracted.priceIncludesTax !== item.priceIncludesTax) ||
		(extracted.offer !== undefined &&
			(extracted.offer.quantity !== item.offerQuantity ||
				extracted.offer.totalMinor !== item.offerPriceMinor))
	);
}

export interface AddItemOptions {
	/** What the label reader filled in, kept so later edits can be reverted. */
	extracted?: ExtractedFields;
	photo?: CompressedPhoto;
	/** Who added it: the signed-in account, so a shared trip can say. Unset when signed out. */
	addedBy?: string;
}

function newPhoto(itemId: string, photo: CompressedPhoto, now: number): Photo {
	return { id: newId(), itemId, ...photo, createdAt: now, updatedAt: now };
}

export async function addItem(
	tripId: string,
	input: ItemInput,
	{ extracted, photo, addedBy }: AddItemOptions = {}
): Promise<Item> {
	const fields = validate(input);
	return db.transaction('rw', db.trips, db.items, db.photos, async () => {
		const trip = await db.trips.get(tripId);
		if (!isLive(trip) || trip.status !== 'open') throw new Error('This trip is not open.');

		const now = Date.now();
		const id = newId();
		const stored = photo && newPhoto(id, photo, now);
		const item: Item = {
			id,
			tripId,
			...fields,
			photoId: stored?.id,
			addedBy,
			extracted,
			edited: differsFromExtracted(fields, extracted),
			createdAt: now,
			updatedAt: now
		};
		if (stored) await db.photos.add(stored);
		await db.items.add(item);
		return item;
	});
}

/**
 * Replaces an item's photo (retake). The old photo is removed outright rather than
 * tombstoned: photos never sync as rows, and keeping the blob would only waste space.
 */
export async function setItemPhoto(itemId: string, photo: CompressedPhoto): Promise<void> {
	await db.transaction('rw', db.items, db.photos, async () => {
		const item = await db.items.get(itemId);
		if (!isLive(item)) throw new Error('That item no longer exists.');
		const now = Date.now();
		const stored = newPhoto(itemId, photo, now);
		await db.photos.add(stored);
		if (item.photoId) await db.photos.delete(item.photoId);
		await db.items.update(itemId, { photoId: stored.id, updatedAt: now });
	});
}

/**
 * Marks the trip's items that nobody is recorded as having added as added by this person. The
 * owner does it when a trip becomes shared, for the items they put in before signing in.
 */
export async function backfillAddedBy(tripId: string, userId: string): Promise<void> {
	await db.transaction('rw', db.items, async () => {
		const items = await db.items.where('tripId').equals(tripId).toArray();
		for (const item of items) {
			if (isLive(item) && item.addedBy === undefined) {
				await db.items.update(item.id, { addedBy: userId });
			}
		}
	});
}

export async function getPhoto(id: string): Promise<Photo | undefined> {
	const photo = await db.photos.get(id);
	return isLive(photo) ? photo : undefined;
}

export async function updateItem(id: string, input: ItemInput): Promise<void> {
	const fields = validate(input);
	await db.transaction('rw', db.items, async () => {
		const item = await db.items.get(id);
		if (!isLive(item)) throw new Error('That item no longer exists.');
		await db.items.update(id, {
			...fields,
			// Saved without an offer means the offer is gone, whether or not the keys were given.
			offerQuantity: fields.offerQuantity,
			offerPriceMinor: fields.offerPriceMinor,
			edited: differsFromExtracted(fields, item.extracted),
			updatedAt: Date.now()
		});
	});
}

export async function setQuantity(id: string, quantity: number): Promise<void> {
	if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Quantity must be at least 1.');
	await db.items.update(id, { quantity, updatedAt: Date.now() });
}

/** Puts back every field the label reader filled in. */
export async function revertItem(id: string): Promise<void> {
	await db.transaction('rw', db.items, async () => {
		const item = await db.items.get(id);
		if (!isLive(item) || !item.extracted) return;
		const { description, unitPriceMinor, priceIncludesTax, offer } = item.extracted;
		await db.items.update(id, {
			...(description !== undefined && { description }),
			...(unitPriceMinor !== undefined && { unitPriceMinor }),
			...(priceIncludesTax !== undefined && { priceIncludesTax }),
			...(offer && { offerQuantity: offer.quantity, offerPriceMinor: offer.totalMinor }),
			edited: false,
			updatedAt: Date.now()
		});
	});
}

export async function deleteItem(id: string): Promise<void> {
	const now = Date.now();
	await db.items.update(id, { deletedAt: now, updatedAt: now });
}

/** Undoes deleteItem. */
export async function restoreItem(id: string): Promise<void> {
	await db.items.update(id, { deletedAt: undefined, updatedAt: Date.now() });
}

/** What to call an item in the cart; unnamed items wait for a barcode lookup. */
export function itemName(item: Pick<Item, 'description' | 'barcode'>): string {
	return item.description || `Unnamed item ${item.barcode ?? ''}`.trim();
}

/** Newest first. */
export async function listTripItems(tripId: string): Promise<Item[]> {
	const items = await db.items
		.where('[tripId+createdAt]')
		.between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
		.reverse()
		.toArray();
	return items.filter(isLive);
}
