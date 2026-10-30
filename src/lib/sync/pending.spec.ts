import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '#lib/data/db.ts';
import { addItem, deleteItem, restoreItem, setQuantity } from '#lib/data/items.ts';
import { addStore } from '#lib/data/stores.ts';
import { setTripBudget, startTrip } from '#lib/data/trips.ts';
import { markRemote } from './pending.ts';

beforeEach(async () => {
	vi.useRealTimers();
	await db.delete();
	await db.open();
});

const milk = { description: 'Milk', unitPriceMinor: 145, priceIncludesTax: true, quantity: 1 };

describe('recording local changes', () => {
	it('records every field of a new record, at the time it was made', async () => {
		const store = await addStore({ name: 'Tesco', branch: 'Leeds' });
		const saved = (await db.stores.get(store.id))!;
		expect(saved.pendingAt).toBe(store.updatedAt);
		expect(saved.pending).toEqual({
			name: store.updatedAt,
			branch: store.updatedAt,
			taxRateBps: store.updatedAt,
			pricesIncludeTax: store.updatedAt,
			createdAt: store.updatedAt,
			lastUsedAt: store.updatedAt
		});
	});

	it('leaves out fields a new record does not have, and fields that never sync', async () => {
		const store = await addStore({ name: 'Aldi' });
		expect((await db.stores.get(store.id))!.pending).not.toHaveProperty('branch');
		const trip = await startTrip(store.id);
		const item = await addItem(trip.id, milk);
		const saved = (await db.items.get(item.id))!;
		expect(Object.keys(saved.pending!)).not.toContain('photoId');
		expect(Object.keys(saved.pending!)).not.toContain('updatedAt');
		expect(Object.keys(saved.pending!)).toContain('description');
	});

	it('records only the fields an update changed, each at its own time', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id);
		const item = await addItem(trip.id, milk);
		const created = (await db.items.get(item.id))!.pending!;

		await new Promise((resolve) => setTimeout(resolve, 5));
		await setQuantity(item.id, 3);
		const saved = (await db.items.get(item.id))!;
		expect(saved.pending!.quantity).toBe(saved.updatedAt);
		expect(saved.pending!.quantity).toBeGreaterThan(created.quantity);
		// What was not touched keeps the time it was set.
		expect(saved.pending!.description).toBe(created.description);
		expect(saved.pendingAt).toBe(saved.updatedAt);
	});

	it('records a field being unset, and a delete and its undo, as changes', async () => {
		const store = await addStore({ name: 'Tesco' });
		const trip = await startTrip(store.id, 5000);
		await setTripBudget(trip.id, undefined);
		expect(Object.keys((await db.trips.get(trip.id))!.pending!)).toContain('budgetMinor');

		const item = await addItem(trip.id, milk);
		await deleteItem(item.id);
		const deleted = (await db.items.get(item.id))!;
		expect(deleted.pending!.deletedAt).toBe(deleted.deletedAt);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await restoreItem(item.id);
		const restored = (await db.items.get(item.id))!;
		expect(restored.pending!.deletedAt).toBe(restored.updatedAt);
		expect(restored.deletedAt).toBeUndefined();
	});

	it('finds the records with something to send through pendingAt', async () => {
		const store = await addStore({ name: 'Tesco' });
		expect((await db.stores.where('pendingAt').above(0).toArray()).map((s) => s.id)).toEqual([
			store.id
		]);
		await db.stores.update(store.id, { pending: undefined, pendingAt: undefined });
		expect(await db.stores.where('pendingAt').above(0).count()).toBe(0);
	});
});

describe('applying the server’s data', () => {
	it('is not recorded as a local change, however it is written', async () => {
		await db.transaction('rw', db.stores, async (transaction) => {
			markRemote(transaction);
			await db.stores.add({
				id: 's1',
				name: 'From elsewhere',
				taxRateBps: 2000,
				pricesIncludeTax: true,
				createdAt: 1,
				lastUsedAt: 1,
				updatedAt: 1
			});
			await db.stores.update('s1', { name: 'Renamed elsewhere', updatedAt: 2 });
		});
		const saved = (await db.stores.get('s1'))!;
		expect(saved.name).toBe('Renamed elsewhere');
		expect(saved.pending).toBeUndefined();
		expect(saved.pendingAt).toBeUndefined();
	});

	it('does not stop a local write made at the same time from being recorded', async () => {
		const local = await addStore({ name: 'Mine' });
		await Promise.all([
			db.transaction('rw', db.stores, async (transaction) => {
				markRemote(transaction);
				await db.stores.add({
					id: 's2',
					name: 'Theirs',
					taxRateBps: 2000,
					pricesIncludeTax: true,
					createdAt: 1,
					lastUsedAt: 1,
					updatedAt: 1
				});
			}),
			db.stores.update(local.id, { name: 'Mine, renamed', updatedAt: Date.now() + 1 })
		]);
		expect((await db.stores.get('s2'))!.pendingAt).toBeUndefined();
		expect((await db.stores.get(local.id))!.pending!.name).toBeGreaterThan(local.updatedAt);
	});
});
