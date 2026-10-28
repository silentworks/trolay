import Dexie from 'dexie';
import { db, isLive, newId, type ExtractedFields, type Item } from './db';

export interface ItemInput {
	description: string;
	unitPriceMinor: number;
	priceIncludesTax: boolean;
	quantity: number;
}

function validate(input: ItemInput): ItemInput {
	const description = input.description.trim();
	if (!description) throw new Error('Add a description.');
	if (!Number.isInteger(input.unitPriceMinor) || input.unitPriceMinor < 0) {
		throw new Error('Enter a valid price.');
	}
	if (!Number.isInteger(input.quantity) || input.quantity < 1) {
		throw new Error('Quantity must be at least 1.');
	}
	return { ...input, description };
}

/** True when any field the label reader filled in has since been changed by hand. */
function differsFromExtracted(item: ItemInput, extracted: ExtractedFields | undefined): boolean {
	if (!extracted) return false;
	return (
		(extracted.description !== undefined && extracted.description !== item.description) ||
		(extracted.unitPriceMinor !== undefined && extracted.unitPriceMinor !== item.unitPriceMinor) ||
		(extracted.priceIncludesTax !== undefined &&
			extracted.priceIncludesTax !== item.priceIncludesTax)
	);
}

export async function addItem(
	tripId: string,
	input: ItemInput,
	extracted?: ExtractedFields
): Promise<Item> {
	const fields = validate(input);
	return db.transaction('rw', db.trips, db.items, async () => {
		const trip = await db.trips.get(tripId);
		if (!isLive(trip) || trip.status !== 'open') throw new Error('This trip is not open.');

		const now = Date.now();
		const item: Item = {
			id: newId(),
			tripId,
			...fields,
			extracted,
			edited: differsFromExtracted(fields, extracted),
			createdAt: now,
			updatedAt: now
		};
		await db.items.add(item);
		return item;
	});
}

export async function updateItem(id: string, input: ItemInput): Promise<void> {
	const fields = validate(input);
	await db.transaction('rw', db.items, async () => {
		const item = await db.items.get(id);
		if (!isLive(item)) throw new Error('That item no longer exists.');
		await db.items.update(id, {
			...fields,
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
		const { description, unitPriceMinor, priceIncludesTax } = item.extracted;
		await db.items.update(id, {
			...(description !== undefined && { description }),
			...(unitPriceMinor !== undefined && { unitPriceMinor }),
			...(priceIncludesTax !== undefined && { priceIncludesTax }),
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

/** Newest first. */
export async function listTripItems(tripId: string): Promise<Item[]> {
	const items = await db.items
		.where('[tripId+createdAt]')
		.between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
		.reverse()
		.toArray();
	return items.filter(isLive);
}
