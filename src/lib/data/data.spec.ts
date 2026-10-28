import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import {
	addItem,
	deleteItem,
	getPhoto,
	listTripItems,
	restoreItem,
	revertItem,
	setItemPhoto,
	setQuantity,
	updateItem
} from './items';
import { addStore, listStores, updateStore } from './stores';
import { changeTripStore, getOpenTrip, setTripBudget, startTrip } from './trips';

beforeEach(async () => {
	await db.delete();
	await db.open();
});

const milk = { description: 'Milk 2L', unitPriceMinor: 145, priceIncludesTax: true, quantity: 1 };

describe('stores', () => {
	it('defaults new stores to 20% VAT with VAT-inclusive labels', async () => {
		const store = await addStore({ name: '  Tesco ', branch: ' ' });
		expect(store).toMatchObject({
			name: 'Tesco',
			branch: undefined,
			taxRateBps: 2000,
			pricesIncludeTax: true
		});
	});

	it('requires a name', async () => {
		await expect(addStore({ name: '   ' })).rejects.toThrow('name');
	});

	it('lists the most recently used store first', async () => {
		const tesco = await addStore({ name: 'Tesco' });
		await addStore({ name: 'Aldi' });
		await startTrip(tesco.id);
		expect((await listStores()).map((s) => s.name)).toEqual(['Tesco', 'Aldi']);
	});

	it('updates name, branch and VAT settings', async () => {
		const store = await addStore({ name: 'Tesco' });
		await updateStore(store.id, {
			name: 'Tesco Extra',
			branch: 'Leeds',
			taxRateBps: 0,
			pricesIncludeTax: false
		});
		expect(await db.stores.get(store.id)).toMatchObject({
			name: 'Tesco Extra',
			branch: 'Leeds',
			taxRateBps: 0,
			pricesIncludeTax: false
		});
	});
});

describe('trips', () => {
	it('starts a trip at a store and finds it as the open trip', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id, 5_000);
		expect(await getOpenTrip()).toMatchObject({
			id: trip.id,
			storeId: store.id,
			budgetMinor: 5_000
		});
	});

	it('allows only one open trip at a time', async () => {
		const store = await addStore({ name: 'Tesco' });
		await startTrip(store.id);
		await expect(startTrip(store.id)).rejects.toThrow('Finish the current trip');
	});

	it('changes store only while the cart is empty', async () => {
		const tesco = await addStore({ name: 'Tesco' });
		const aldi = await addStore({ name: 'Aldi' });
		const trip = await startTrip(tesco.id);

		await changeTripStore(trip.id, aldi.id);
		expect((await getOpenTrip())?.storeId).toBe(aldi.id);

		await addItem(trip.id, milk);
		await expect(changeTripStore(trip.id, tesco.id)).rejects.toThrow('cart is empty');
	});

	it('allows a store change again once every item is deleted', async () => {
		const tesco = await addStore({ name: 'Tesco' });
		const aldi = await addStore({ name: 'Aldi' });
		const trip = await startTrip(tesco.id);
		const item = await addItem(trip.id, milk);
		await deleteItem(item.id);
		await changeTripStore(trip.id, aldi.id);
		expect((await getOpenTrip())?.storeId).toBe(aldi.id);
	});

	it('sets and clears the budget', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		await setTripBudget(trip.id, 8_000);
		expect((await getOpenTrip())?.budgetMinor).toBe(8_000);
		await setTripBudget(trip.id, undefined);
		expect((await getOpenTrip())?.budgetMinor).toBeUndefined();
		await expect(setTripBudget(trip.id, 0)).rejects.toThrow('more than £0');
	});
});

describe('items', () => {
	async function openTrip() {
		const store = await addStore({ name: 'Tesco' });
		return startTrip(store.id);
	}

	it('validates input', async () => {
		const trip = await openTrip();
		await expect(addItem(trip.id, { ...milk, description: ' ' })).rejects.toThrow('description');
		await expect(addItem(trip.id, { ...milk, unitPriceMinor: 1.5 })).rejects.toThrow('price');
		await expect(addItem(trip.id, { ...milk, quantity: 0 })).rejects.toThrow('Quantity');
	});

	it('lists items newest first', async () => {
		const trip = await openTrip();
		await addItem(trip.id, { ...milk, description: 'First' });
		await new Promise((resolve) => setTimeout(resolve, 2));
		await addItem(trip.id, { ...milk, description: 'Second' });
		expect((await listTripItems(trip.id)).map((i) => i.description)).toEqual(['Second', 'First']);
	});

	it('deletes and restores an item', async () => {
		const trip = await openTrip();
		const item = await addItem(trip.id, milk);
		await deleteItem(item.id);
		expect(await listTripItems(trip.id)).toEqual([]);
		await restoreItem(item.id);
		expect(await listTripItems(trip.id)).toHaveLength(1);
		expect((await db.items.get(item.id))?.deletedAt).toBeUndefined();
	});

	it('changes quantity but never below 1', async () => {
		const trip = await openTrip();
		const item = await addItem(trip.id, milk);
		await setQuantity(item.id, 3);
		expect((await db.items.get(item.id))?.quantity).toBe(3);
		await expect(setQuantity(item.id, 0)).rejects.toThrow('at least 1');
	});

	it('marks manual items as not edited', async () => {
		const trip = await openTrip();
		const item = await addItem(trip.id, milk);
		await updateItem(item.id, { ...milk, unitPriceMinor: 199 });
		expect((await db.items.get(item.id))?.edited).toBe(false);
	});

	it('marks an extracted item as edited and reverts it', async () => {
		const trip = await openTrip();
		const extracted = { description: 'Milk 2L', unitPriceMinor: 145, confidence: 0.9 };
		const item = await addItem(trip.id, milk, { extracted });
		expect(item.edited).toBe(false);

		await updateItem(item.id, { ...milk, unitPriceMinor: 155, quantity: 2 });
		expect(await db.items.get(item.id)).toMatchObject({ unitPriceMinor: 155, edited: true });

		await revertItem(item.id);
		expect(await db.items.get(item.id)).toMatchObject({
			unitPriceMinor: 145,
			quantity: 2,
			edited: false
		});
	});

	it('stores the photo and thumbnail with the item, and replaces them on retake', async () => {
		const trip = await openTrip();
		const first = { blob: new Blob(['full-1']), thumbBlob: new Blob(['thumb-1']) };
		const item = await addItem(trip.id, milk, { photo: first });
		const firstId = (await db.items.get(item.id))?.photoId;
		expect(firstId).toBeDefined();
		expect(await getPhoto(firstId!)).toMatchObject({ itemId: item.id });

		await setItemPhoto(item.id, { blob: new Blob(['full-2']), thumbBlob: new Blob(['thumb-2']) });
		const secondId = (await db.items.get(item.id))?.photoId;
		expect(secondId).not.toBe(firstId);
		expect(await getPhoto(firstId!)).toBeUndefined();
		expect(await db.photos.count()).toBe(1);
	});

	it('only adds items to an open trip', async () => {
		await expect(addItem('missing', milk)).rejects.toThrow('not open');
	});
});
