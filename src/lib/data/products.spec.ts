import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { addItem } from './items';
import { composeName, lookupProductName, processPendingLookups } from './products';
import { addStore } from './stores';
import { startTrip } from './trips';

const BEANS = '5000157024671';

beforeEach(async () => {
	await db.delete();
	await db.open();
});

function offResponse(product: object | null, status = 200) {
	return vi.fn<typeof fetch>(async () =>
		Response.json(product ? { status: 1, product } : { status: 0 }, { status })
	);
}

const offline = vi.fn<typeof fetch>(async () => {
	throw new TypeError('Failed to fetch');
});

describe('composeName', () => {
	it('joins brand, name and quantity without repeating them', () => {
		expect(
			composeName({ brands: 'Heinz, Kraft', product_name: 'Baked Beans', quantity: '415 g' })
		).toBe('Heinz Baked Beans 415 g');
		expect(
			composeName({ brands: 'Heinz', product_name: 'Heinz Baked Beans 415 g', quantity: '415 g' })
		).toBe('Heinz Baked Beans 415 g');
		expect(composeName({ product_name_en: 'Milk', product_name: 'Lait' })).toBe('Milk');
		expect(composeName({ brands: 'Heinz' })).toBeUndefined();
	});
});

describe('lookupProductName', () => {
	it("prefers the shopper's own earlier item at the same store", async () => {
		const tesco = await addStore({ name: 'Tesco' });
		const trip = await startTrip(tesco.id);
		await addItem(trip.id, {
			description: 'Beans (the good ones)',
			unitPriceMinor: 140,
			priceIncludesTax: true,
			quantity: 1,
			barcode: BEANS
		});
		const fetchFn = offResponse({ product_name: 'Baked Beans' });
		expect(await lookupProductName(BEANS, tesco.id, fetchFn)).toEqual({
			name: 'Beans (the good ones)',
			source: 'own-item'
		});
		expect(fetchFn).not.toHaveBeenCalled();

		const aldi = await addStore({ name: 'Aldi' });
		expect((await lookupProductName(BEANS, aldi.id, fetchFn))?.source).toBe('openfoodfacts');
	});

	it('asks Open Food Facts once per barcode, sending only the barcode', async () => {
		const fetchFn = offResponse({
			brands: 'Heinz',
			product_name: 'Baked Beans',
			quantity: '415 g'
		});
		const store = await addStore({ name: 'Tesco' });
		expect(await lookupProductName(BEANS, store.id, fetchFn)).toEqual({
			name: 'Heinz Baked Beans 415 g',
			source: 'openfoodfacts'
		});
		await lookupProductName(BEANS, store.id, fetchFn);
		expect(fetchFn).toHaveBeenCalledOnce();
		const [url, init] = fetchFn.mock.calls[0];
		expect(String(url)).toBe(
			`https://world.openfoodfacts.org/api/v2/product/${BEANS}.json?fields=product_name,product_name_en,brands,quantity`
		);
		expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
	});

	it('remembers products Open Food Facts does not list', async () => {
		const fetchFn = offResponse(null, 404);
		const store = await addStore({ name: 'Tesco' });
		expect(await lookupProductName(BEANS, store.id, fetchFn)).toBeUndefined();
		expect(await lookupProductName(BEANS, store.id, fetchFn)).toBeUndefined();
		expect(fetchFn).toHaveBeenCalledOnce();
	});

	it('queues the lookup when there is no signal', async () => {
		const store = await addStore({ name: 'Tesco' });
		expect(await lookupProductName(BEANS, store.id, offline)).toBeUndefined();
		expect(await db.pendingLookups.get(BEANS)).toBeDefined();
	});
});

describe('processPendingLookups', () => {
	it('names unnamed items once the signal returns, never overwriting a typed name', async () => {
		const store = await addStore({ name: 'Tesco' });
		await lookupProductName(BEANS, store.id, offline);
		const trip = await startTrip(store.id);
		const base = { unitPriceMinor: 140, priceIncludesTax: true, quantity: 1, barcode: BEANS };
		const unnamed = await addItem(trip.id, { ...base, description: '' });
		const typed = await addItem(trip.id, { ...base, description: 'My beans' });

		await processPendingLookups(offline);
		expect(await db.pendingLookups.count()).toBe(1);

		await processPendingLookups(offResponse({ brands: 'Heinz', product_name: 'Baked Beans' }));
		expect((await db.items.get(unnamed.id))?.description).toBe('Heinz Baked Beans');
		expect((await db.items.get(typed.id))?.description).toBe('My beans');
		expect(await db.pendingLookups.count()).toBe(0);
		expect((await db.productCache.get(BEANS))?.name).toBe('Heinz Baked Beans');
	});
});
