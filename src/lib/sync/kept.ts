import { isLive, type TrolleyDB } from '#lib/data/db.ts';
import type { Fetcher } from './core.ts';

// Price tag photos kept in the cloud, for a shopper who turned "Keep price tag photos in the
// cloud" on. Each round uploads the shopper's own photos that aren't kept yet, on any trip, shared
// or not; a partner's photos are theirs to keep. Turning the setting off only stops new uploads:
// nothing kept is ever deleted from here.

/** A photo fetched from the partner on a shared trip (see photos.ts): not this shopper's. */
const SHARED = 'sharedPhotos';

export class KeptPhotos {
	constructor(
		private readonly db: TrolleyDB,
		/** Whether the setting is on. */
		private readonly enabled: () => boolean,
		/** Who is signed in. */
		private readonly me: () => string | undefined,
		private readonly send: Fetcher = (path, init) => fetch(path, init)
	) {}

	/**
	 * Uploads every photo of the shopper's still to keep. A failure for lack of signal (a
	 * TypeError) is thrown, so the round is retried when the signal returns; a photo whose trip
	 * isn't on the server yet waits for the next round, and one over the cloud's limit for its trip
	 * isn't tried again.
	 */
	async run(): Promise<void> {
		if (!this.enabled()) return;
		const me = this.me();
		const partners = new Set(
			((await this.db.syncState.get(SHARED))?.value as string[] | undefined) ?? []
		);
		const waiting = (await this.db.photos.toArray()).filter(
			(photo) => isLive(photo) && !photo.kept && !partners.has(photo.id)
		);
		for (const photo of waiting) {
			// Only a photo still on a live item, and the shopper's own.
			const item = await this.db.items.get(photo.itemId);
			if (!isLive(item) || item.photoId !== photo.id) continue;
			if (item.addedBy && item.addedBy !== me) continue;

			const response = await this.send(
				`/api/kept-photos/${encodeURIComponent(photo.id)}?trip=${encodeURIComponent(item.tripId)}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': photo.blob.type || 'image/jpeg' },
					body: photo.blob
				}
			);
			if (response.ok) {
				// Its trip has finished: the cloud has it now, so this phone's copy can go.
				if (photo.dropWhenKept) await this.db.photos.delete(photo.id);
				else await this.db.photos.update(photo.id, { kept: 'cloud' });
			} else if (response.status === 413) {
				// Over the trip's limit, or too big: trying again won't change that.
				await this.db.photos.update(photo.id, { kept: 'over-limit' });
			} else if (response.status !== 404) {
				console.warn('A photo was not kept in the cloud', response.status);
			}
		}
	}
}
