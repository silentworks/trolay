import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import {
	addItem,
	backfillAddedBy,
	deleteItem,
	getPhoto,
	listTripItems,
	restoreItem,
	revertItem,
	setItemPhoto,
	setQuantity,
	updateItem
} from './items';
import { addStore, deleteStore, listStores, updateStore } from './stores';
import {
	changeTripStore,
	deleteTrip,
	deleteTripPhotos,
	finishTrip,
	leaveTrip,
	getOpenTrip,
	getTrip,
	listFinishedTrips,
	receiptDifference,
	setReceiptTotal,
	setTripBudget,
	setTripDiscount,
	tripDiscount,
	startTrip
} from './trips';

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

	it('lets the shopper leave with an empty cart, leaving no trip behind', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		const item = await addItem(trip.id, milk);
		await deleteItem(item.id);

		await leaveTrip(trip.id);

		expect(await getOpenTrip()).toBeUndefined();
		expect(await listFinishedTrips()).toEqual([]);
		await expect(startTrip(store.id)).resolves.toBeDefined();
	});

	it('refuses to leave while the cart has items, or when the trip is not open', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		await addItem(trip.id, milk);
		await expect(leaveTrip(trip.id)).rejects.toThrow('Finish the trip instead');

		await setReceiptTotal(trip.id, 145);
		await finishTrip(trip.id);
		await expect(leaveTrip(trip.id)).rejects.toThrow('not open');
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
		// A barcode alone is enough: the name can be looked up later.
		await expect(
			addItem(trip.id, { ...milk, description: '', barcode: '5012345678900' })
		).resolves.toMatchObject({ description: '' });
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

	it('saves a valid barcode and rejects a mistyped one', async () => {
		const trip = await openTrip();
		const item = await addItem(trip.id, { ...milk, barcode: '5012 3456 78900' });
		expect((await db.items.get(item.id))?.barcode).toBe('5012345678900');
		await expect(addItem(trip.id, { ...milk, barcode: '5012345678901' })).rejects.toThrow(
			'Check the barcode'
		);
		await updateItem(item.id, { ...milk, barcode: '' });
		expect((await db.items.get(item.id))?.barcode).toBeUndefined();
	});

	it('only adds items to an open trip', async () => {
		await expect(addItem('missing', milk)).rejects.toThrow('not open');
	});
});

describe('finishing a trip', () => {
	const photo = () => ({ blob: new Blob(['full']), thumbBlob: new Blob(['thumb']) });

	async function tripWithPhotos() {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		// 2 × £1.45 + £0.99 = £3.89 incl. VAT; excl. VAT each line rounds on its own: £2.42 + £0.83.
		await addItem(trip.id, { ...milk, quantity: 2 }, { photo: photo() });
		await addItem(
			trip.id,
			{ ...milk, description: 'Bread', unitPriceMinor: 99 },
			{ photo: photo() }
		);
		return { store, trip };
	}

	it('measures the receipt against the app total: positive when the till charged more', () => {
		expect(receiptDifference(undefined, 389)).toBeUndefined();
		expect(receiptDifference(389, 389)).toBe(0);
		expect(receiptDifference(390, 389)).toBe(1);
		expect(receiptDifference(388, 389)).toBe(-1);
	});

	it('only takes a receipt total on an open trip, and rejects a negative or fractional one', async () => {
		const { trip } = await tripWithPhotos();
		await expect(setReceiptTotal(trip.id, -1)).rejects.toThrow('receipt');
		await expect(setReceiptTotal(trip.id, 1.5)).rejects.toThrow('receipt');
		await setReceiptTotal(trip.id, 389);
		expect((await db.trips.get(trip.id))?.receiptTotalMinor).toBe(389);
		await setReceiptTotal(trip.id, undefined);
		expect((await db.trips.get(trip.id))?.receiptTotalMinor).toBeUndefined();
		await setReceiptTotal(trip.id, 389);
		await finishTrip(trip.id);
		await expect(setReceiptTotal(trip.id, 389)).rejects.toThrow('not open');
	});

	it('closes the trip with its totals and deletes the photos when the receipt matches', async () => {
		const { trip } = await tripWithPhotos();
		await setReceiptTotal(trip.id, 389);
		expect(await finishTrip(trip.id)).toEqual({ photosKept: false, difference: 0 });

		const finished = await db.trips.get(trip.id);
		expect(finished).toMatchObject({
			status: 'finished',
			photosKept: false,
			totals: { inclMinor: 389, exclMinor: 325, itemCount: 3, taxRateBps: 2000 }
		});
		expect(finished?.finishedAt).toBeTypeOf('number');
		expect(await getOpenTrip()).toBeUndefined();
		expect(await db.photos.count()).toBe(0);
		// Descriptions, prices and barcodes stay.
		const items = await listTripItems(trip.id);
		// Both items can be added in the same millisecond, so their order is not fixed.
		expect(items.map((i) => [i.description, i.unitPriceMinor, i.photoId])).toEqual(
			expect.arrayContaining([
				['Bread', 99, undefined],
				['Milk 2L', 145, undefined]
			])
		);
		expect(items).toHaveLength(2);
	});

	it('refuses to finish until the receipt total is entered, leaving the trip open', async () => {
		const { trip } = await tripWithPhotos();
		await expect(finishTrip(trip.id)).rejects.toThrow('Enter the receipt total');
		await setReceiptTotal(trip.id, 389);
		await setReceiptTotal(trip.id, undefined);
		await expect(finishTrip(trip.id)).rejects.toThrow('Enter the receipt total');
		expect((await db.trips.get(trip.id))?.status).toBe('open');
		expect(await db.photos.count()).toBe(2);
	});

	it('accepts a receipt total of £0.00 as entered', async () => {
		const { trip } = await tripWithPhotos();
		await setReceiptTotal(trip.id, 0);
		expect(await finishTrip(trip.id)).toMatchObject({ photosKept: true, difference: -389 });
	});

	it('keeps the photos as evidence when the receipt is out by even a penny', async () => {
		for (const receipt of [390, 388]) {
			await db.delete();
			await db.open();
			const { trip } = await tripWithPhotos();
			await setReceiptTotal(trip.id, receipt);
			expect(await finishTrip(trip.id)).toEqual({ photosKept: true, difference: receipt - 389 });
			expect((await db.trips.get(trip.id))?.photosKept).toBe(true);
			expect(await db.photos.count()).toBe(2);
		}
	});

	it("keeps its totals when the store's VAT rate changes afterwards", async () => {
		const { store, trip } = await tripWithPhotos();
		await setReceiptTotal(trip.id, 389);
		await finishTrip(trip.id);
		await updateStore(store.id, { name: 'Tesco', taxRateBps: 0 });
		expect((await db.trips.get(trip.id))?.totals).toMatchObject({
			exclMinor: 325,
			taxRateBps: 2000
		});
	});

	it('ignores deleted items and refuses to finish an empty trip', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		const item = await addItem(trip.id, milk);
		await deleteItem(item.id);
		await expect(finishTrip(trip.id)).rejects.toThrow('Add an item');
		await restoreItem(item.id);
		await addItem(trip.id, { ...milk, description: 'Gone' }).then((i) => deleteItem(i.id));
		await setReceiptTotal(trip.id, 145);
		await finishTrip(trip.id);
		expect((await db.trips.get(trip.id))?.totals?.inclMinor).toBe(145);
	});

	it('finishes only an open trip, so a new one can start', async () => {
		const { store, trip } = await tripWithPhotos();
		await setReceiptTotal(trip.id, 389);
		await finishTrip(trip.id);
		await expect(finishTrip(trip.id)).rejects.toThrow('not open');
		expect((await startTrip(store.id)).status).toBe('open');
	});

	it('deletes kept photos later on request', async () => {
		const { trip } = await tripWithPhotos();
		await setReceiptTotal(trip.id, 500);
		await finishTrip(trip.id);
		await deleteTripPhotos(trip.id);
		expect((await db.trips.get(trip.id))?.photosKept).toBe(false);
		expect(await db.photos.count()).toBe(0);
		expect((await listTripItems(trip.id)).every((i) => i.photoId === undefined)).toBe(true);
	});
});

describe('history', () => {
	it('lists finished trips newest first with their stores, and never the open one', async () => {
		const tesco = await addStore({ name: 'Tesco' });
		const aldi = await addStore({ name: 'Aldi' });
		const finish = async (storeId: string, at: number) => {
			const trip = await startTrip(storeId);
			await addItem(trip.id, milk);
			await setReceiptTotal(trip.id, 145);
			vi.setSystemTime(at);
			await finishTrip(trip.id);
			vi.useRealTimers();
			return trip;
		};
		vi.useFakeTimers({ toFake: ['Date'] });
		const first = await finish(tesco.id, Date.UTC(2026, 9, 1, 10));
		vi.useFakeTimers({ toFake: ['Date'] });
		const second = await finish(aldi.id, Date.UTC(2026, 9, 8, 10));
		await startTrip(tesco.id);

		const history = await listFinishedTrips();
		expect(history.map((h) => [h.trip.id, h.store?.name])).toEqual([
			[second.id, 'Aldi'],
			[first.id, 'Tesco']
		]);
		expect(await getTrip(first.id)).toMatchObject({ status: 'finished' });
		expect(await getTrip('missing')).toBeUndefined();
	});
});

describe('who added an item', () => {
	it('is recorded when given, and backfilled only where nobody is recorded', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		const mine = await addItem(trip.id, milk, { addedBy: 'alice' });
		const theirs = await addItem(trip.id, { ...milk, description: 'Bread' }, { addedBy: 'bob' });
		const nobody = await addItem(trip.id, { ...milk, description: 'Eggs' });
		const gone = await addItem(trip.id, { ...milk, description: 'Gone' });
		await deleteItem(gone.id);

		await backfillAddedBy(trip.id, 'alice');

		expect((await db.items.get(mine.id))?.addedBy).toBe('alice');
		expect((await db.items.get(theirs.id))?.addedBy).toBe('bob');
		expect((await db.items.get(nobody.id))?.addedBy).toBe('alice');
		// A deleted item is left alone.
		expect((await db.items.get(gone.id))?.addedBy).toBeUndefined();
		// And the change is on its way to the server.
		expect((await db.items.get(nobody.id))?.pending).toHaveProperty('addedBy');
	});
});

describe('deleting stores and history', () => {
	async function aFinishedTrip(storeId: string) {
		const trip = await startTrip(storeId);
		await addItem(trip.id, milk);
		await setReceiptTotal(trip.id, 145);
		await finishTrip(trip.id);
		return trip;
	}

	it('deletes a finished trip with its items', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await aFinishedTrip(store.id);
		await deleteTrip(trip.id);
		expect(await listFinishedTrips()).toEqual([]);
		expect(await listTripItems(trip.id)).toEqual([]);
		expect(await db.trips.get(trip.id)).toMatchObject({ deletedAt: expect.any(Number) });
	});

	it('refuses to delete an open trip', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		await expect(deleteTrip(trip.id)).rejects.toThrow('Finish or leave');
	});

	it('deletes a store but keeps its history', async () => {
		const store = await addStore({ name: 'Tesco' });
		await aFinishedTrip(store.id);
		await deleteStore(store.id);
		expect(await listStores()).toEqual([]);
		const history = await listFinishedTrips();
		expect(history).toHaveLength(1);
		expect(history[0].store).toBeUndefined();
	});

	it('deletes a store together with its history', async () => {
		const tesco = await addStore({ name: 'Tesco' });
		const aldi = await addStore({ name: 'Aldi' });
		await aFinishedTrip(tesco.id);
		await aFinishedTrip(aldi.id);
		await deleteStore(tesco.id, true);
		expect((await listFinishedTrips()).map((t) => t.store?.name)).toEqual(['Aldi']);
	});

	it('will not delete the store of the open trip', async () => {
		const store = await addStore({ name: 'Tesco' });
		await startTrip(store.id);
		await expect(deleteStore(store.id)).rejects.toThrow('Finish or leave');
		expect(await listStores()).toHaveLength(1);
	});
});

describe('a discount on the cart', () => {
	async function aTripWithMilk() {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		await addItem(trip.id, { ...milk, unitPriceMinor: 600 });
		return trip;
	}

	it('is set, changed and removed on an open trip', async () => {
		const trip = await aTripWithMilk();
		await setTripDiscount(trip.id, { kind: 'percent', value: 1000 });
		expect(tripDiscount(await getTrip(trip.id))).toEqual({ kind: 'percent', value: 1000 });
		await setTripDiscount(trip.id, { kind: 'amount', value: 150 });
		expect(tripDiscount(await getTrip(trip.id))).toEqual({ kind: 'amount', value: 150 });
		await setTripDiscount(trip.id, undefined);
		expect(tripDiscount(await getTrip(trip.id))).toBeUndefined();
	});

	it('refuses a discount that is nothing, or over 100%', async () => {
		const trip = await aTripWithMilk();
		await expect(setTripDiscount(trip.id, { kind: 'amount', value: 0 })).rejects.toThrow('£0');
		await expect(setTripDiscount(trip.id, { kind: 'percent', value: 10_001 })).rejects.toThrow(
			'100%'
		);
	});

	it('is saved with the totals when the trip is finished, and the receipt is checked against it', async () => {
		const trip = await aTripWithMilk();
		await setTripDiscount(trip.id, { kind: 'amount', value: 150 });
		await setReceiptTotal(trip.id, 450);
		const { difference } = await finishTrip(trip.id);
		expect(difference).toBe(0);
		expect((await getTrip(trip.id))?.totals).toEqual({
			inclMinor: 450,
			exclMinor: 375,
			itemCount: 1,
			taxRateBps: 2000,
			discountMinor: 150
		});
	});

	it('leaves a trip without one as before', async () => {
		const trip = await aTripWithMilk();
		await setReceiptTotal(trip.id, 600);
		await finishTrip(trip.id);
		expect((await getTrip(trip.id))?.totals).not.toHaveProperty('discountMinor');
	});

	it('cannot be changed once the trip is finished', async () => {
		const trip = await aTripWithMilk();
		await setReceiptTotal(trip.id, 600);
		await finishTrip(trip.id);
		await expect(setTripDiscount(trip.id, { kind: 'amount', value: 100 })).rejects.toThrow(
			'not open'
		);
	});
});
