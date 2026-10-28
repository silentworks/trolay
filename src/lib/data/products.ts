import { db, isLive } from './db';

export interface ProductName {
	name: string;
	source: 'own-item' | 'openfoodfacts';
}

const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product/';
const OFF_FIELDS = 'product_name,product_name_en,brands,quantity';
const OFF_TIMEOUT_MS = 5000;

interface OffProduct {
	product_name?: string;
	product_name_en?: string;
	brands?: string;
	quantity?: string;
}

/** "Heinz" + "Baked Beans" + "415 g" → "Heinz Baked Beans 415 g", without repeating parts. */
export function composeName(product: OffProduct): string | undefined {
	const name = (product.product_name_en || product.product_name || '').trim();
	if (!name) return undefined;
	const brand = product.brands?.split(',')[0].trim();
	const quantity = product.quantity?.trim();
	let full = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;
	if (quantity && !full.toLowerCase().includes(quantity.toLowerCase())) full += ` ${quantity}`;
	return full;
}

/**
 * Asks Open Food Facts for a product's name. Only the barcode leaves the device. Returns null
 * when the product isn't listed; throws when the lookup itself failed (no signal, timeout).
 */
export async function fetchOpenFoodFactsName(
	barcode: string,
	fetchFn: typeof fetch = fetch
): Promise<string | null> {
	const response = await fetchFn(`${OFF_URL}${barcode}.json?fields=${OFF_FIELDS}`, {
		credentials: 'omit',
		referrerPolicy: 'no-referrer',
		signal: AbortSignal.timeout(OFF_TIMEOUT_MS)
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Open Food Facts returned ${response.status}`);
	const body = (await response.json()) as { status?: number; product?: OffProduct };
	return (body.status === 1 && body.product && composeName(body.product)) || null;
}

/** The newest name given to this barcode on an earlier trip at the same store. */
export async function findOwnItemName(
	barcode: string,
	storeId: string
): Promise<string | undefined> {
	const items = (await db.items.where('barcode').equals(barcode).toArray()).filter(
		(item) => isLive(item) && item.description
	);
	const trips = new Map(
		(await db.trips.bulkGet([...new Set(items.map((i) => i.tripId))]))
			.filter(isLive)
			.map((t) => [t.id, t])
	);
	return items
		.filter((item) => trips.get(item.tripId)?.storeId === storeId)
		.sort((a, b) => b.createdAt - a.createdAt)[0]?.description;
}

/**
 * A name for a scanned barcode: the shopper's own earlier item first, then the device cache,
 * then Open Food Facts (each barcode is asked once; misses are cached too). With no signal
 * the lookup is queued for processPendingLookups and nothing is returned now.
 */
export async function lookupProductName(
	barcode: string,
	storeId: string,
	fetchFn: typeof fetch = fetch
): Promise<ProductName | undefined> {
	const own = await findOwnItemName(barcode, storeId);
	if (own) return { name: own, source: 'own-item' };

	const cached = await db.productCache.get(barcode);
	if (cached) return cached.name ? { name: cached.name, source: 'openfoodfacts' } : undefined;

	try {
		const name = await fetchOpenFoodFactsName(barcode, fetchFn);
		await db.productCache.put({
			barcode,
			name: name ?? '',
			source: 'openfoodfacts',
			fetchedAt: Date.now()
		});
		return name ? { name, source: 'openfoodfacts' } : undefined;
	} catch {
		await db.pendingLookups.put({ barcode, queuedAt: Date.now() });
		return undefined;
	}
}

/**
 * Retries queued lookups (on start-up and when the signal returns). A name found is cached
 * and given to items with that barcode that are still unnamed; a typed name is never touched.
 */
export async function processPendingLookups(fetchFn: typeof fetch = fetch): Promise<void> {
	for (const { barcode } of await db.pendingLookups.toArray()) {
		let name: string | null;
		try {
			name = await fetchOpenFoodFactsName(barcode, fetchFn);
		} catch {
			return; // Still no signal; try again later.
		}
		await db.transaction('rw', db.productCache, db.pendingLookups, db.items, async () => {
			const now = Date.now();
			await db.productCache.put({
				barcode,
				name: name ?? '',
				source: 'openfoodfacts',
				fetchedAt: now
			});
			await db.pendingLookups.delete(barcode);
			if (!name) return;
			await db.items
				.where('barcode')
				.equals(barcode)
				.filter((item) => isLive(item) && !item.description)
				.modify({ description: name, updatedAt: now });
		});
	}
}

/** True while a lookup waits for signal. */
export async function isLookupPending(barcode: string): Promise<boolean> {
	return (await db.pendingLookups.get(barcode)) !== undefined;
}
