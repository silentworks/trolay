import type { Item } from '#lib/data/db.ts';

/** How long the trolley has to sit untouched before the cart asks whether the shop is done. */
export const DONE_SHOPPING_AFTER_MS = 10 * 60 * 1000;

/** When an item was last added or changed on this trip, by anyone on it. */
export function lastActivity(items: readonly Pick<Item, 'createdAt' | 'updatedAt'>[]): number {
	return items.reduce((last, item) => Math.max(last, item.createdAt, item.updatedAt), 0);
}

/**
 * Whether to ask "Done shopping?": the trolley has items, none has been added or changed for a
 * while, and the shopper hasn't already said "Not yet" for this trip.
 */
export function askDoneShopping(options: {
	tripId: string;
	items: readonly Pick<Item, 'createdAt' | 'updatedAt'>[];
	now: number;
	dismissedTripId: string | null;
}): boolean {
	const { tripId, items, now, dismissedTripId } = options;
	if (!items.length || dismissedTripId === tripId) return false;
	return now - lastActivity(items) >= DONE_SHOPPING_AFTER_MS;
}
