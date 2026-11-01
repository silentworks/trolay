import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '#lib/data/db.ts';
import { addItem, deleteItem } from '#lib/data/items.ts';
import { addStore } from '#lib/data/stores.ts';
import { finishTrip, setReceiptTotal, setTripBudget, startTrip } from '#lib/data/trips.ts';
import { createBackup, readBackup, restoreBackup, summarise } from './backup';

beforeEach(async () => {
	await db.delete();
	await db.open();
});

const milk = { description: 'Milk 2L', unitPriceMinor: 145, priceIncludesTax: true, quantity: 1 };

/** Every byte a photo holds, so a restored photo can be compared with the original. */
const bytes = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];

/** The data without the bookkeeping of what still has to sync, which a restore starts afresh. */
const dataOnly = <T extends { pending?: unknown; pendingAt?: unknown }>(records: T[]) =>
	records.map(({ pending: _pending, pendingAt: _pendingAt, ...data }) => data);

async function snapshot() {
	const photos = await db.photos.toArray();
	return {
		stores: dataOnly(await db.stores.toArray()),
		trips: dataOnly(await db.trips.toArray()),
		items: dataOnly(await db.items.toArray()),
		photos: await Promise.all(
			photos.map(async ({ blob, thumbBlob, ...rest }) => ({
				...rest,
				blob: { type: blob.type, bytes: await bytes(blob) },
				thumbBlob: { type: thumbBlob.type, bytes: await bytes(thumbBlob) }
			}))
		)
	};
}

/** A history with the awkward cases: kept photos, a deleted item, an open trip, a deleted store. */
async function fillDatabase() {
	const tesco = await addStore({ name: 'Tesco', branch: 'Leeds' });
	const makro = await addStore({ name: 'Makro', taxRateBps: 2000, pricesIncludeTax: false });
	const gone = await addStore({ name: 'Closed shop' });
	await db.stores.update(gone.id, { deletedAt: Date.now() });

	const first = await startTrip(tesco.id, 5000);
	const binary = new Uint8Array(256).map((_, i) => i);
	await addItem(
		first.id,
		{ ...milk, barcode: '5012345678900' },
		{
			photo: {
				blob: new Blob([binary], { type: 'image/webp' }),
				thumbBlob: new Blob(['t'], { type: 'image/webp' })
			},
			extracted: { description: 'Milk 2L', unitPriceMinor: 145, confidence: 0.93 }
		}
	);
	const removed = await addItem(first.id, { ...milk, description: 'Pâté, "smooth" £2' });
	await deleteItem(removed.id);
	await setReceiptTotal(first.id, 999);
	await finishTrip(first.id);

	const open = await startTrip(makro.id);
	await setTripBudget(open.id, 20000);
	await addItem(open.id, { ...milk, unitPriceMinor: 1000, priceIncludesTax: false, quantity: 3 });
}

describe('JSON backup', () => {
	it('round-trips: export, wipe, import gives identical data, photos byte for byte', async () => {
		await fillDatabase();
		const before = await snapshot();
		expect(before.photos).toHaveLength(1);

		const file = JSON.stringify(await createBackup());
		await db.delete();
		await db.open();
		expect((await snapshot()).trips).toHaveLength(0);

		await restoreBackup(readBackup(file));
		expect(await snapshot()).toEqual(before);
	});

	it('queues what it restores to sync, and leaves that bookkeeping out of the file', async () => {
		await fillDatabase();
		const backup = await createBackup();
		for (const record of [...backup.stores, ...backup.trips, ...backup.items]) {
			expect(record).not.toHaveProperty('pending');
			expect(record).not.toHaveProperty('pendingAt');
		}
		await db.stores.toCollection().modify((store) => {
			delete store.pending;
			delete store.pendingAt;
		});
		await restoreBackup(backup);
		expect((await db.stores.toArray()).every((store) => store.pendingAt !== undefined)).toBe(true);
		expect((await db.items.toArray()).every((item) => item.pendingAt !== undefined)).toBe(true);
	});

	it('replaces what is on the device rather than merging', async () => {
		await fillDatabase();
		const file = JSON.stringify(await createBackup());
		await addStore({ name: 'Added after the backup' });
		await restoreBackup(readBackup(file));
		expect((await db.stores.toArray()).map((s) => s.name)).not.toContain('Added after the backup');
	});

	it('summarises what a backup holds, leaving out deleted records', async () => {
		await fillDatabase();
		expect(summarise(readBackup(JSON.stringify(await createBackup())))).toMatchObject({
			stores: 2,
			trips: 2,
			items: 2,
			photos: 1
		});
	});

	describe('refuses a file that is not a sound backup, changing nothing', () => {
		async function refused(edit: (backup: Record<string, unknown>) => unknown, message: string) {
			await fillDatabase();
			const backup = JSON.parse(JSON.stringify(await createBackup()));
			const text = typeof edit === 'function' ? JSON.stringify(edit(backup) ?? backup) : '';
			expect(() => readBackup(text)).toThrow(message);
		}

		it('not JSON, or not ours', () => {
			expect(() => readBackup('PK\u0003\u0004')).toThrow('not valid JSON');
			expect(() => readBackup('{"hello": 1}')).toThrow('not a Trolay backup');
			expect(() => readBackup('[]')).toThrow('not a Trolay backup');
		});

		it('from a newer version', () =>
			refused((b) => void (b.format = 3), 'newer version of Trolay'));

		it('a table missing', () => refused((b) => void delete b.items, 'has no items'));

		it('a field of the wrong type', () =>
			refused(
				(b) => void ((b.items as Record<string, unknown>[])[0].unitPriceMinor = '1.45'),
				'invalid unitPriceMinor'
			));

		it('a price that is not whole pence', () =>
			refused(
				(b) => void ((b.items as Record<string, unknown>[])[0].unitPriceMinor = 1.5),
				'invalid unitPriceMinor'
			));

		it('an unknown field', () =>
			refused(
				(b) => void ((b.stores as Record<string, unknown>[])[0].colour = 'red'),
				'unknown fields: colour'
			));

		it('a repeated id', () =>
			refused(
				(b) => void (b.stores as unknown[]).push((b.stores as unknown[])[0]),
				'repeats a stores id'
			));

		it('an item whose trip is missing', () =>
			refused(
				(b) => void ((b.items as Record<string, unknown>[])[0].tripId = 'nope'),
				'item for a trip'
			));

		it('two open trips', () =>
			refused((b) => {
				const trips = b.trips as Record<string, unknown>[];
				trips.forEach((t) => (t.status = 'open'));
			}, 'more than one open trip'));

		it('and leaves the device as it was', async () => {
			await fillDatabase();
			const before = await snapshot();
			expect(() => readBackup('{"app": "trolay", "format": 1}')).toThrow();
			expect(await snapshot()).toEqual(before);
		});
	});
});
