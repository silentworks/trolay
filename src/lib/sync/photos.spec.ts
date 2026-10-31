import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleApi } from '../../../worker/api.ts';
import { createTestEnv, ORIGIN, testClient, type TestEnv } from '../../../worker/testing.ts';
import { TrolleyDB } from '#lib/data/db.ts';
import { SyncCore, type Fetcher } from './core.ts';
import { PhotoSync } from './photos.ts';

// Two phones, two accounts, through the real Worker and a real local D1 and R2: the owner's
// photo reaches the partner while the trip is shared and open, and goes when it finishes.

let server: TestEnv;
beforeAll(async () => {
	server = await createTestEnv();
});
afterAll(() => server.dispose());

interface Phone {
	db: TrolleyDB;
	core: SyncCore;
	photos: PhotoSync;
	cookie: string;
	online: boolean;
}

let n = 0;
let owner: Phone;
let partner: Phone;
let ids: { store: string; trip: string; item: string; photo: string };

async function phone(): Promise<Phone> {
	const account = (await testClient(server.env).register()).done;
	const me: Phone = { cookie: account.cookie!, online: true } as Phone;
	const fetcher: Fetcher = (path, init = {}) => {
		if (!me.online) return Promise.reject(new TypeError('Failed to fetch'));
		return handleApi(
			new Request(ORIGIN + path, {
				...init,
				headers: { ...init.headers, Cookie: me.cookie, Origin: ORIGIN }
			}),
			server.env
		);
	};
	me.db = new TrolleyDB(`photos-${++n}`);
	me.core = new SyncCore(me.db, fetcher);
	// Re-encoding needs a browser; here a downloaded photo is kept as it is.
	me.photos = new PhotoSync(me.db, fetcher, async (blob) => ({ blob, thumbBlob: blob }));
	return me;
}

const bytes = (...values: number[]) => new Blob([new Uint8Array(values)], { type: 'image/jpeg' });
const read = async (blob: Blob) => [...new Uint8Array(await blob.arrayBuffer())];
const stored = async () =>
	(await server.env.PHOTOS!.list({ prefix: `trips/${ids.trip}/` })).objects.map((o) => o.key);
const NOW = Date.now();

beforeEach(async () => {
	owner = await phone();
	partner = await phone();
	ids = { store: `s-${n}`, trip: `t-${n}`, item: `i-${n}`, photo: `p-${n}` };
	await owner.db.stores.add({
		id: ids.store,
		name: 'Tesco',
		taxRateBps: 2000,
		pricesIncludeTax: true,
		createdAt: NOW,
		lastUsedAt: NOW,
		updatedAt: NOW
	});
	await owner.db.trips.add({
		id: ids.trip,
		storeId: ids.store,
		status: 'open',
		photosKept: false,
		startedAt: NOW,
		updatedAt: NOW
	});
	await owner.db.items.add({
		id: ids.item,
		tripId: ids.trip,
		description: 'Milk',
		unitPriceMinor: 145,
		priceIncludesTax: true,
		quantity: 1,
		edited: false,
		photoId: ids.photo,
		createdAt: NOW,
		updatedAt: NOW
	});
	await owner.db.photos.add({
		id: ids.photo,
		itemId: ids.item,
		blob: bytes(1, 2, 3),
		thumbBlob: bytes(9),
		createdAt: NOW,
		updatedAt: NOW
	});
	await owner.core.run();
});

async function share() {
	const made = await owner.core['send']('/api/trips/invite', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ tripId: ids.trip })
	});
	const token = new URL(((await made.json()) as { link: string }).link).hash.replace('#token=', '');
	await partner.core['send']('/api/trips/join', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ token })
	});
}

/** The owner finishes the trip, as the app does: photos gone from the phone unless kept. */
async function finish(kept: boolean) {
	const at = NOW + 10_000;
	await owner.db.trips.update(ids.trip, {
		status: 'finished',
		finishedAt: at,
		photosKept: kept,
		updatedAt: at
	});
	if (!kept) {
		await owner.db.photos.delete(ids.photo);
		await owner.db.items.update(ids.item, { photoId: undefined, updatedAt: at });
	}
	await owner.core.run();
}

describe('photos on a shared open trip', () => {
	it('are not uploaded while the trip has no partner', async () => {
		await owner.photos.run();
		expect(await stored()).toEqual([]);
		expect((await owner.db.photos.get(ids.photo))?.uploaded).toBeUndefined();
	});

	it('are uploaded once there is a partner, and the partner gets them byte for byte', async () => {
		await share();
		await owner.photos.run();
		expect(await stored()).toEqual([`trips/${ids.trip}/${ids.photo}`]);
		expect((await owner.db.photos.get(ids.photo))?.uploaded).toBe(true);

		await partner.core.run();
		// The partner's phone has the item with its photo's id, but not the photo yet.
		expect((await partner.db.items.get(ids.item))?.photoId).toBe(ids.photo);
		expect(await partner.db.photos.get(ids.photo)).toBeUndefined();
		await partner.photos.run();
		const got = await partner.db.photos.get(ids.photo);
		expect(await read(got!.blob)).toEqual([1, 2, 3]);
		expect(got?.itemId).toBe(ids.item);
	});

	it('are fetched later when the partner looked before the owner had uploaded', async () => {
		await share();
		await partner.core.run();
		await partner.photos.run();
		expect(await partner.db.photos.get(ids.photo)).toBeUndefined();
		await owner.photos.run();
		await partner.photos.run();
		expect(await partner.db.photos.get(ids.photo)).toBeDefined();
	});

	it('are sent again when the signal returns', async () => {
		await share();
		owner.online = false;
		await expect(owner.photos.run()).rejects.toBeInstanceOf(TypeError);
		expect(await stored()).toEqual([]);
		owner.online = true;
		await owner.photos.run();
		expect(await stored()).toHaveLength(1);
	});

	it('are sent once, not every round', async () => {
		await share();
		await owner.photos.run();
		await server.env.PHOTOS!.delete(`trips/${ids.trip}/${ids.photo}`);
		await owner.photos.run();
		expect(await stored()).toEqual([]);
	});

	it('are not kept by the partner or the server once the trip finishes', async () => {
		await share();
		await owner.photos.run();
		await partner.core.run();
		await partner.photos.run();
		expect(await partner.db.photos.get(ids.photo)).toBeDefined();

		await finish(false);
		expect(await stored()).toEqual([]);
		await partner.core.run();
		await partner.photos.run();
		expect(await partner.db.photos.get(ids.photo)).toBeUndefined();
	});

	it('stay on the server as receipt evidence when the receipt did not match', async () => {
		await share();
		await owner.photos.run();
		await finish(true);
		expect(await stored()).toHaveLength(1);
		expect(await owner.db.photos.get(ids.photo)).toBeDefined();
	});

	it('do not come back when a partner looks after the trip has finished', async () => {
		await share();
		await owner.photos.run();
		await finish(false);
		await partner.core.run();
		await partner.photos.run();
		expect(await partner.db.photos.count()).toBe(0);
	});
});
