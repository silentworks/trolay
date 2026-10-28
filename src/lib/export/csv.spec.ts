import { describe, expect, it } from 'vitest';
import type { Item, Store, Trip } from '#lib/data/db.ts';
import { tripsToCsv } from './csv';

const store: Store = {
	id: 's',
	name: 'Tesco',
	branch: 'Leeds',
	taxRateBps: 2000,
	pricesIncludeTax: true,
	createdAt: 0,
	lastUsedAt: 0,
	updatedAt: 0
};

const trip: Trip = {
	id: 't',
	storeId: 's',
	status: 'finished',
	photosKept: false,
	startedAt: new Date(2026, 9, 28, 17, 2).getTime(),
	finishedAt: new Date(2026, 9, 28, 17, 46).getTime(),
	totals: { inclMinor: 0, exclMinor: 0, itemCount: 0, taxRateBps: 2000 },
	updatedAt: 0
};

let created = 0;
const item = (fields: Partial<Item>): Item => ({
	id: `i${created}`,
	tripId: 't',
	description: 'Milk',
	unitPriceMinor: 145,
	priceIncludesTax: true,
	quantity: 1,
	edited: false,
	createdAt: ++created,
	updatedAt: 0,
	...fields
});

describe('tripsToCsv', () => {
	it('writes a UTF-8 BOM, a header and one CRLF-ended row per item, oldest item first', () => {
		const csv = tripsToCsv([
			{
				trip,
				store,
				items: [
					item({ description: 'Bread', unitPriceMinor: 99, createdAt: 20 }),
					item({ description: 'Milk 2L', quantity: 2, barcode: '5012345678900', createdAt: 10 })
				]
			}
		]);
		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv.slice(1).split('\r\n')).toEqual([
			'Date,Store,Description,Barcode,Quantity,Unit price (£),Unit price includes VAT,Line total incl. VAT (£),Line total excl. VAT (£),VAT (£)',
			'2026-10-28 17:46,Tesco · Leeds,Milk 2L,="5012345678900",2,1.45,Yes,2.90,2.42,0.48',
			'2026-10-28 17:46,Tesco · Leeds,Bread,,1,0.99,Yes,0.99,0.83,0.16',
			''
		]);
	});

	it('works out incl. VAT from a trade price entered excl. VAT', () => {
		const csv = tripsToCsv([
			{ trip, store, items: [item({ unitPriceMinor: 1000, priceIncludesTax: false })] }
		]);
		expect(csv.split('\r\n')[1]).toBe(
			'2026-10-28 17:46,Tesco · Leeds,Milk,,1,10.00,No,12.00,10.00,2.00'
		);
	});

	it('uses the VAT rate the trip was finished with', () => {
		const zeroRated = { ...trip, totals: { ...trip.totals!, taxRateBps: 0 } };
		const csv = tripsToCsv([{ trip: zeroRated, store, items: [item({})] }]);
		expect(csv.split('\r\n')[1]).toMatch(/,1\.45,1\.45,0\.00$/);
	});

	it('quotes commas, quotes and line breaks, and keeps £ and accents', () => {
		const csv = tripsToCsv([
			{ trip, store, items: [item({ description: 'Pâté, "smooth"\nfine £2 deal' })] }
		]);
		expect(csv).toContain('"Pâté, ""smooth""\nfine £2 deal"');
	});

	it('stops a description being run as a spreadsheet formula', () => {
		const csv = tripsToCsv([
			{
				trip,
				store,
				items: [item({ description: '=HYPERLINK("http://x")' }), item({ description: '-5% off' })]
			}
		]);
		expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
		expect(csv).toContain(",'-5% off,");
	});

	it('names a deleted store, and writes just the header with no trips', () => {
		expect(tripsToCsv([{ trip, items: [item({})] }])).toContain(',Deleted store,');
		expect(tripsToCsv([]).split('\r\n')).toHaveLength(2);
	});
});
