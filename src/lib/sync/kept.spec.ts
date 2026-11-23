import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../../../worker/api.ts';
import { createTestEnv, ORIGIN, testClient, type TestEnv } from '../../../worker/testing.ts';
import { TrolleyDB } from '#lib/data/db.ts';
import { SyncCore, type Fetcher } from './core.ts';
import { KeptPhotos } from './kept.ts';

// One phone, through the real Worker and a real local D1 and R2: with the setting on, the
// shopper's price tag photos are kept in the cloud; with it off, nothing new goes up.

let server: TestEnv;
beforeAll(async () => {
	server = await createTestEnv();
});
afterAll(() => server.dispose());

let n = 0;
let db: TrolleyDB;
let core: SyncCore;
let kept: KeptPhotos;
let on: boolean;
let userId: string;
let online: boolean;
let sent: string[];
let ids: { store: string; trip: string; item: string; photo: string };

const JPEG = [0xff, 0xd8, 0xff];
const bytes = (...values: number[]) =>
	new Blob([new Uint8Array([...JPEG, ...values])], { type: 'image/jpeg' });
const NOW = Date.now();
const inCloud = async () =>
	(await server.env.PHOTOS!.list({ prefix: `users/${userId}/` })).objects.map((o) =>
		o.key.split('/').pop()
	);

async function item(id: string, photo: string, addedBy?: string) {
	await db.items.add({
		id,
		tripId: ids.trip,
		description: 'Milk',
		unitPriceMinor: 145,
		priceIncludesTax: true,
		quantity: 1,
		edited: false,
		photoId: photo,
		addedBy,
		createdAt: NOW,
		updatedAt: NOW
	});
	await db.photos.add({
		id: photo,
		itemId: id,
		blob: bytes(1, 2, 3),
		thumbBlob: bytes(9),
		createdAt: NOW,
		updatedAt: NOW
	});
}

beforeEach(async () => {
	const account = (await testClient(server.env).register()).done;
	userId = account.body.user.id;
	online = true;
	on = false;
	sent = [];
	const fetcher: Fetcher = (path, init = {}) => {
		if (!online) return Promise.reject(new TypeError('Failed to fetch'));
		sent.push(path);
		return handleApi(
			new Request(ORIGIN + path, {
				...init,
				headers: { ...init.headers, Cookie: account.cookie!, Origin: ORIGIN }
			}),
			server.env
		);
	};
	db = new TrolleyDB(`kept-${++n}`);
	core = new SyncCore(db, fetcher);
	kept = new KeptPhotos(
		db,
		() => on,
		() => userId,
		fetcher
	);
	ids = { store: `s-${n}`, trip: `t-${n}`, item: `i-${n}`, photo: `p-${n}` };
	await db.stores.add({
		id: ids.store,
		name: 'Tesco',
		taxRateBps: 2000,
		pricesIncludeTax: true,
		createdAt: NOW,
		lastUsedAt: NOW,
		updatedAt: NOW
	});
	await db.trips.add({
		id: ids.trip,
		storeId: ids.store,
		status: 'open',
		photosKept: false,
		startedAt: NOW,
		updatedAt: NOW
	});
	await item(ids.item, ids.photo);
	await core.adopt(userId);
	await core.run();
});

describe('keeping photos in the cloud', () => {
	it('uploads nothing while the setting is off', async () => {
		await kept.run();
		expect(sent.filter((path) => path.startsWith('/api/kept-photos'))).toEqual([]);
		expect(await inCloud()).toEqual([]);
	});

	it("uploads the shopper's photos once it is on, and only once", async () => {
		on = true;
		await kept.run();
		expect(await inCloud()).toEqual([ids.photo]);
		expect((await db.photos.get(ids.photo))?.kept).toBe('cloud');
		sent = [];
		await kept.run();
		expect(sent).toEqual([]);
	});

	it("leaves a partner's photos to them", async () => {
		// As it arrives from the server: added by the partner's account.
		await item(`${ids.item}-b`, `${ids.photo}-b`, 'someone-else');
		on = true;
		await kept.run();
		expect(await inCloud()).toEqual([ids.photo]);
	});

	it('lets go of the phone’s copy of a finished trip’s photo once it is kept', async () => {
		await db.photos.update(ids.photo, { dropWhenKept: true });
		on = true;
		await kept.run();
		expect(await inCloud()).toEqual([ids.photo]);
		expect(await db.photos.get(ids.photo)).toBeUndefined();
		// The item still points at it, so History can show it from the cloud.
		expect((await db.items.get(ids.item))?.photoId).toBe(ids.photo);
	});

	it('waits for a trip the server does not have yet, and tries again', async () => {
		const trip = `${ids.trip}-later`;
		await db.trips.add({
			id: trip,
			storeId: ids.store,
			status: 'open',
			photosKept: false,
			startedAt: NOW,
			updatedAt: NOW
		});
		await db.items.update(ids.item, { tripId: trip });
		on = true;
		await kept.run();
		expect(await inCloud()).toEqual([]);
		expect((await db.photos.get(ids.photo))?.kept).toBeUndefined();
		await core.run();
		await kept.run();
		expect(await inCloud()).toEqual([ids.photo]);
	});

	it('does not retry a photo over its trip’s limit', async () => {
		const { MAX_PHOTOS_PER_TRIP } = await import('../../../worker/trips/photos.ts');
		await server.env.DB.batch(
			Array.from({ length: MAX_PHOTOS_PER_TRIP }, (_, i) =>
				server.env.DB.prepare(
					`INSERT INTO kept_photos (user_id, photo_id, trip_id, size, content_type, created_at)
					 VALUES (?, ?, ?, 7, 'image/jpeg', ?)`
				).bind(userId, `full-${n}-${i}`, ids.trip, NOW)
			)
		);
		on = true;
		await kept.run();
		expect((await db.photos.get(ids.photo))?.kept).toBe('over-limit');
		sent = [];
		await kept.run();
		expect(sent).toEqual([]);
	});

	it('passes on having no signal, so the round is retried', async () => {
		on = true;
		online = false;
		await expect(kept.run()).rejects.toThrow(TypeError);
		online = true;
		await kept.run();
		expect(await inCloud()).toEqual([ids.photo]);
	});
});
