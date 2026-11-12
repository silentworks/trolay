import { describe, expect, it } from 'vitest';
import { askDoneShopping, DONE_SHOPPING_AFTER_MS, lastActivity } from './done-shopping.ts';

const at = (createdAt: number, updatedAt = createdAt) => ({ createdAt, updatedAt });
const T = 1_800_000_000_000;

describe('lastActivity', () => {
	it('is the latest add or change across the items', () => {
		expect(lastActivity([at(T), at(T + 5, T + 50), at(T + 20)])).toBe(T + 50);
	});

	it('is 0 for an empty trolley', () => {
		expect(lastActivity([])).toBe(0);
	});
});

describe('askDoneShopping', () => {
	const ask = (
		items: ReturnType<typeof at>[],
		now: number,
		dismissedTripId: string | null = null
	) => askDoneShopping({ tripId: 'trip-1', items, now, dismissedTripId });

	it('asks once the trolley has sat untouched for long enough', () => {
		expect(ask([at(T)], T + DONE_SHOPPING_AFTER_MS)).toBe(true);
	});

	it('does not ask while the shopper is still adding', () => {
		expect(ask([at(T)], T + DONE_SHOPPING_AFTER_MS - 1)).toBe(false);
		expect(ask([at(T - DONE_SHOPPING_AFTER_MS), at(T)], T + 60_000)).toBe(false);
	});

	it('counts a change to an item, such as its quantity, as still shopping', () => {
		expect(ask([at(T - DONE_SHOPPING_AFTER_MS, T)], T + 60_000)).toBe(false);
	});

	it('does not ask on an empty trolley', () => {
		expect(ask([], T + DONE_SHOPPING_AFTER_MS * 10)).toBe(false);
	});

	it('does not ask again for a trip the shopper said "Not yet" to', () => {
		expect(ask([at(T)], T + DONE_SHOPPING_AFTER_MS, 'trip-1')).toBe(false);
		expect(ask([at(T)], T + DONE_SHOPPING_AFTER_MS, 'an-older-trip')).toBe(true);
	});
});
