import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { TrolleyDB } from '#lib/data/db.ts';
import { letGoOfTrip } from './letgo.ts';

let db: TrolleyDB;
let n = 0;
const NOW = 1_790_000_000_000;
const blob = () => new Blob([new Uint8Array([1])], { type: 'image/jpeg' });

beforeEach(async () => {
	db = new TrolleyDB(`letgo-${++n}`);
	await db.stores.bulkAdd([
		{
			id: 'owners-store',
			name: 'Tesco',
			taxRateBps: 2000,
			pricesIncludeTax: true,
			createdAt: NOW,
			lastUsedAt: NOW,
			updatedAt: NOW
		},
		{
			id: 'my-store',
			name: 'Aldi',
			taxRateBps: 2000,
			pricesIncludeTax: true,
			createdAt: NOW,
			lastUsedAt: NOW,
			updatedAt: NOW
		}
	]);
	await db.trips.add({
		id: 'shared',
		storeId: 'owners-store',
		status: 'open',
		photosKept: false,
		startedAt: NOW,
		updatedAt: NOW
	});
	await db.items.bulkAdd(
		['a', 'b'].map((id) => ({
			id,
			tripId: 'shared',
			description: id,
			unitPriceMinor: 100,
			priceIncludesTax: true,
			quantity: 1,
			edited: false,
			photoId: `photo-${id}`,
			createdAt: NOW,
			updatedAt: NOW
		}))
	);
	await db.photos.bulkAdd(
		['a', 'b'].map((id) => ({
			id: `photo-${id}`,
			itemId: id,
			blob: blob(),
			thumbBlob: blob(),
			createdAt: NOW,
			updatedAt: NOW
		}))
	);
});

const left = { tripId: 'shared', storeId: 'owners-store' };

describe('letGoOfTrip', () => {
	it('removes an open shared trip, its items, their photos and the owner’s store', async () => {
		expect(await letGoOfTrip(db, left)).toBe('Tesco');
		expect(await db.trips.count()).toBe(0);
		expect(await db.items.count()).toBe(0);
		expect(await db.photos.count()).toBe(0);
		expect(await db.stores.get('owners-store')).toBeUndefined();
	});

	it('leaves this account’s own stores alone', async () => {
		await letGoOfTrip(db, left);
		expect(await db.stores.get('my-store')).toBeDefined();
	});

	it('keeps the store while another trip here is at it', async () => {
		await db.trips.add({
			id: 'history',
			storeId: 'owners-store',
			status: 'finished',
			photosKept: false,
			startedAt: NOW,
			finishedAt: NOW,
			updatedAt: NOW
		});
		await letGoOfTrip(db, left);
		expect(await db.stores.get('owners-store')).toBeDefined();
		expect(await db.trips.get('history')).toBeDefined();
	});

	it('leaves a finished trip alone: it stays in history', async () => {
		await db.trips.update('shared', { status: 'finished', finishedAt: NOW });
		expect(await letGoOfTrip(db, left)).toBeUndefined();
		expect(await db.trips.count()).toBe(1);
		expect(await db.items.count()).toBe(2);
	});

	it('does nothing for a trip the phone never had, and queues nothing to sync', async () => {
		expect(await letGoOfTrip(db, { tripId: 'never', storeId: 'nowhere' })).toBeUndefined();
		await letGoOfTrip(db, left);
		expect(await db.stores.where('pendingAt').above(0).count()).toBe(1);
		// Only the untouched store of this account is still waiting to be sent.
		expect((await db.stores.get('my-store'))?.pending).toBeDefined();
	});
});
