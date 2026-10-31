import type { CompressedPhoto } from '#lib/capture/image.ts';
import { isLive, type Item, type TrolleyDB, type Trip } from '#lib/data/db.ts';
import type { Fetcher } from './core.ts';

// Label photos on a shared open trip. Photos never sync as records (they are large): an item
// carries its photo's id, and while the trip is open and has a partner, each phone uploads its
// own photos to the server and fetches the other's, so both see every item's photo. Nothing is
// uploaded for a trip that is not shared, and a finished trip's photos are the server's to delete.

const SHARED = 'sharedPhotos';
type Compress = (source: Blob) => Promise<CompressedPhoto>;

export class PhotoSync {
	/** Trips known to have a partner, so they are not asked about every round. */
	private readonly shared = new Set<string>();

	constructor(
		private readonly db: TrolleyDB,
		private readonly send: Fetcher = (path, init) => fetch(path, init),
		private readonly compress: Compress = async (source) =>
			(await import('#lib/capture/image.ts')).compressPhoto(source)
	) {}

	/**
	 * One round: tidy up, then upload this phone's photos and fetch the partner's. A failure for
	 * lack of signal (a TypeError) is thrown, so the caller retries when the signal returns; any
	 * other problem with one photo leaves it for the next round.
	 */
	async run(): Promise<void> {
		await this.tidy();
		const trip = await this.openTrip();
		if (!trip) return;
		const items = (await this.db.items.where('tripId').equals(trip.id).toArray()).filter(
			(item): item is Item & { photoId: string } => isLive(item) && item.photoId !== undefined
		);
		// With no photos there is nothing to ask about.
		if (!items.length || !(await this.isShared(trip.id))) return;
		for (const item of items) await this.upload(trip.id, item.photoId);
		for (const item of items) await this.download(trip.id, item);
	}

	private async openTrip(): Promise<Trip | undefined> {
		return (await this.db.trips.where('status').equals('open').toArray()).find(isLive);
	}

	/**
	 * Whether the trip has a partner. Asked of the server, which is the one that knows, each round
	 * until it says yes: a partner can join at any moment.
	 */
	private async isShared(tripId: string): Promise<boolean> {
		if (this.shared.has(tripId)) return true;
		const response = await this.send(`/api/trips/members?trip=${encodeURIComponent(tripId)}`);
		// Not found: the trip has not reached the server yet. Nothing to do until it has.
		if (!response.ok) return false;
		const { members } = (await response.json()) as { members?: unknown[] };
		if ((members?.length ?? 0) < 2) return false;
		this.shared.add(tripId);
		return true;
	}

	private async upload(tripId: string, photoId: string): Promise<void> {
		const photo = await this.db.photos.get(photoId);
		if (!photo || photo.uploaded) return;
		const response = await this.send(
			`/api/trips/${encodeURIComponent(tripId)}/photos/${encodeURIComponent(photoId)}`,
			{
				method: 'PUT',
				headers: { 'Content-Type': photo.blob.type || 'image/jpeg' },
				body: photo.blob
			}
		);
		if (response.ok) await this.db.photos.update(photoId, { uploaded: true });
		else console.warn('A photo was not uploaded', response.status);
	}

	private async download(tripId: string, item: Item & { photoId: string }): Promise<void> {
		if (await this.db.photos.get(item.photoId)) return;
		const response = await this.send(
			`/api/trips/${encodeURIComponent(tripId)}/photos/${encodeURIComponent(item.photoId)}`
		);
		// Not there yet: the other phone has not uploaded it. It tells us when it has.
		if (!response.ok) return;
		const { blob, thumbBlob } = await this.compress(await response.blob());
		const now = Date.now();
		await this.db.transaction('rw', this.db.photos, this.db.syncState, async () => {
			await this.db.photos.put({
				id: item.photoId,
				itemId: item.id,
				blob,
				thumbBlob,
				createdAt: now,
				updatedAt: now,
				uploaded: true
			});
			await this.remember([...(await this.fetched()), item.photoId]);
		});
	}

	// ---- photos that came from the partner ------------------------------------------------

	private async fetched(): Promise<string[]> {
		return ((await this.db.syncState.get(SHARED))?.value as string[] | undefined) ?? [];
	}

	private remember(ids: string[]) {
		return this.db.syncState.put({ key: SHARED, value: [...new Set(ids)] });
	}

	/**
	 * The partner's photos are only here to be looked at while the trip is open: once an item no
	 * longer has one (the trip finished and the photos were deleted, or it was retaken), the
	 * copy here goes too. A photo this phone took itself is looked after by the app, not here.
	 */
	private async tidy(): Promise<void> {
		const ids = await this.fetched();
		if (!ids.length) return;
		const keep: string[] = [];
		for (const id of ids) {
			const photo = await this.db.photos.get(id);
			if (!photo) continue;
			const item = await this.db.items.get(photo.itemId);
			if (item?.photoId === id) keep.push(id);
			else await this.db.photos.delete(id);
		}
		if (keep.length !== ids.length) await this.remember(keep);
	}
}
