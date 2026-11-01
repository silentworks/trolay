import { describe, expect, it } from 'vitest';
import {
	applyDiscount,
	enteredTotal,
	budgetStatus,
	formatGBP,
	formatPercent,
	headlineTotal,
	lineTotals,
	minorToInput,
	parsePercent,
	parsePounds,
	tripTotals
} from './money';

describe('lineTotals', () => {
	it('derives the price excluding VAT from a VAT-inclusive label', () => {
		expect(lineTotals({ unitPriceMinor: 120, quantity: 1, priceIncludesTax: true }, 2000)).toEqual({
			inclMinor: 120,
			exclMinor: 100
		});
	});

	it('derives the price including VAT from a VAT-exclusive label', () => {
		expect(lineTotals({ unitPriceMinor: 100, quantity: 1, priceIncludesTax: false }, 2000)).toEqual(
			{ inclMinor: 120, exclMinor: 100 }
		);
	});

	it('multiplies by quantity before rounding', () => {
		// 3 × 99p = £2.97 incl; £2.97 / 1.2 = £2.475 → £2.48 (half up)
		expect(lineTotals({ unitPriceMinor: 99, quantity: 3, priceIncludesTax: true }, 2000)).toEqual({
			inclMinor: 297,
			exclMinor: 248
		});
	});

	it('handles 0% and 5% rates', () => {
		expect(lineTotals({ unitPriceMinor: 250, quantity: 2, priceIncludesTax: true }, 0)).toEqual({
			inclMinor: 500,
			exclMinor: 500
		});
		// £1.05 / 1.05 = £1.00 exactly
		expect(lineTotals({ unitPriceMinor: 105, quantity: 1, priceIncludesTax: true }, 500)).toEqual({
			inclMinor: 105,
			exclMinor: 100
		});
	});

	it('rounds tiny amounts half up', () => {
		// 1p / 1.2 = 0.83p → 1p
		expect(lineTotals({ unitPriceMinor: 1, quantity: 1, priceIncludesTax: true }, 2000)).toEqual({
			inclMinor: 1,
			exclMinor: 1
		});
		// 5p ex VAT × 1.2 = 6p exactly; 3p × 1.05 = 3.15p → 3p
		expect(lineTotals({ unitPriceMinor: 5, quantity: 1, priceIncludesTax: false }, 2000)).toEqual({
			inclMinor: 6,
			exclMinor: 5
		});
		expect(lineTotals({ unitPriceMinor: 3, quantity: 1, priceIncludesTax: false }, 500)).toEqual({
			inclMinor: 3,
			exclMinor: 3
		});
	});

	it('rounds exact halves up', () => {
		// 25p ex VAT at 10% = 27.5p → 28p
		expect(lineTotals({ unitPriceMinor: 25, quantity: 1, priceIncludesTax: false }, 1000)).toEqual({
			inclMinor: 28,
			exclMinor: 25
		});
	});

	it('stays exact for large quantities', () => {
		expect(
			lineTotals({ unitPriceMinor: 99_999, quantity: 1_000, priceIncludesTax: true }, 2000)
		).toEqual({ inclMinor: 99_999_000, exclMinor: 83_332_500 });
	});
});

describe('tripTotals', () => {
	it('rounds each line, then sums', () => {
		const totals = tripTotals(
			[
				{ unitPriceMinor: 1, quantity: 1, priceIncludesTax: true },
				{ unitPriceMinor: 1, quantity: 1, priceIncludesTax: true },
				{ unitPriceMinor: 120, quantity: 2, priceIncludesTax: true }
			],
			2000
		);
		expect(totals).toEqual({ inclMinor: 242, exclMinor: 202, taxMinor: 40, itemCount: 4 });
	});

	it('is zero for an empty cart', () => {
		expect(tripTotals([], 2000)).toEqual({ inclMinor: 0, exclMinor: 0, taxMinor: 0, itemCount: 0 });
	});
});

describe('headlineTotal', () => {
	it('picks the figure for the chosen mode', () => {
		expect(headlineTotal({ inclMinor: 120, exclMinor: 100 }, 'incl')).toBe(120);
		expect(headlineTotal({ inclMinor: 120, exclMinor: 100 }, 'excl')).toBe(100);
	});
});

describe('budgetStatus', () => {
	it('is ok below 90%', () => {
		expect(budgetStatus(8_999, 10_000)).toBe('ok');
	});

	it('warns from 90% up to and including 100%', () => {
		expect(budgetStatus(9_000, 10_000)).toBe('warning');
		expect(budgetStatus(10_000, 10_000)).toBe('warning');
	});

	it('is over above 100%', () => {
		expect(budgetStatus(10_001, 10_000)).toBe('over');
	});
});

describe('formatGBP', () => {
	it('formats pence as pounds', () => {
		expect(formatGBP(123)).toBe('£1.23');
		expect(formatGBP(0)).toBe('£0.00');
		expect(formatGBP(123_456)).toBe('£1,234.56');
	});
});

describe('parsePounds', () => {
	it('accepts common ways of typing a price', () => {
		expect(parsePounds('1.23')).toBe(123);
		expect(parsePounds('£1.5')).toBe(150);
		expect(parsePounds(' 2 ')).toBe(200);
		expect(parsePounds('.99')).toBe(99);
		expect(parsePounds('1,234.50')).toBe(123_450);
	});

	it('rejects anything that is not an amount', () => {
		expect(parsePounds('')).toBeNull();
		expect(parsePounds('.')).toBeNull();
		expect(parsePounds('1.234')).toBeNull();
		expect(parsePounds('-1')).toBeNull();
		expect(parsePounds('abc')).toBeNull();
	});
});

describe('minorToInput', () => {
	it('formats pence for an input field', () => {
		expect(minorToInput(150)).toBe('1.50');
		expect(minorToInput(5)).toBe('0.05');
	});
});

describe('parsePercent and formatPercent', () => {
	it('round-trips rates', () => {
		expect(parsePercent('20')).toBe(2000);
		expect(parsePercent('17.5%')).toBe(1750);
		expect(parsePercent('0')).toBe(0);
		expect(formatPercent(2000)).toBe('20');
		expect(formatPercent(1750)).toBe('17.5');
	});

	it('rejects rates outside 0–100%', () => {
		expect(parsePercent('101')).toBeNull();
		expect(parsePercent('-5')).toBeNull();
		expect(parsePercent('')).toBeNull();
	});
});

describe('applyDiscount', () => {
	// £6.00 incl. VAT at 20%: £5.00 excl. VAT.
	const basket = tripTotals([{ unitPriceMinor: 600, quantity: 1, priceIncludesTax: true }], 2000);

	it('changes nothing without a discount', () => {
		expect(applyDiscount(basket, undefined)).toEqual({
			...basket,
			discountMinor: 0,
			beforeMinor: 600
		});
	});

	it('takes an amount off what is paid, and the VAT falls in proportion', () => {
		expect(applyDiscount(basket, { kind: 'amount', value: 150 })).toMatchObject({
			discountMinor: 150,
			beforeMinor: 600,
			inclMinor: 450,
			exclMinor: 375,
			taxMinor: 75
		});
	});

	it('takes a percentage off, rounding the discount to the nearest penny', () => {
		expect(applyDiscount(basket, { kind: 'percent', value: 1000 })).toMatchObject({
			discountMinor: 60,
			inclMinor: 540,
			exclMinor: 450,
			taxMinor: 90
		});
		// 12.5% of £6.00 is 75p exactly; 33.33% is 199.98p, so 200p.
		expect(applyDiscount(basket, { kind: 'percent', value: 1250 }).discountMinor).toBe(75);
		expect(applyDiscount(basket, { kind: 'percent', value: 3333 }).discountMinor).toBe(200);
	});

	it('never takes the total below £0', () => {
		expect(applyDiscount(basket, { kind: 'amount', value: 5000 })).toMatchObject({
			discountMinor: 600,
			inclMinor: 0,
			exclMinor: 0,
			taxMinor: 0
		});
		expect(applyDiscount(basket, { kind: 'percent', value: 10_000 }).inclMinor).toBe(0);
	});

	it('handles an empty trolley', () => {
		const empty = tripTotals([], 2000);
		expect(applyDiscount(empty, { kind: 'amount', value: 100 })).toMatchObject({
			discountMinor: 0,
			inclMinor: 0
		});
	});
});

describe('multi-buy offers', () => {
	const bread = { unitPriceMinor: 189, priceIncludesTax: true, quantity: 1 };
	const twoForThree = { offerQuantity: 2, offerPriceMinor: 300 };

	it('charges the single price until there are enough for the offer', () => {
		expect(enteredTotal({ ...bread, ...twoForThree, quantity: 1 })).toBe(189);
		expect(enteredTotal({ ...bread, ...twoForThree, quantity: 2 })).toBe(300);
	});

	it('applies the offer to each full set and the single price to the rest', () => {
		expect(enteredTotal({ ...bread, ...twoForThree, quantity: 3 })).toBe(489);
		expect(enteredTotal({ ...bread, ...twoForThree, quantity: 5 })).toBe(789);
		expect(enteredTotal({ ...bread, offerQuantity: 3, offerPriceMinor: 500, quantity: 7 })).toBe(
			1189
		);
	});

	it('is never dearer than buying singly', () => {
		expect(enteredTotal({ ...bread, offerQuantity: 2, offerPriceMinor: 500, quantity: 2 })).toBe(
			378
		);
	});

	it('ignores a half-given or nonsense offer', () => {
		expect(enteredTotal({ ...bread, quantity: 2 })).toBe(378);
		expect(enteredTotal({ ...bread, offerQuantity: 1, offerPriceMinor: 100, quantity: 2 })).toBe(
			378
		);
		expect(enteredTotal({ ...bread, offerQuantity: 2, offerPriceMinor: 0, quantity: 2 })).toBe(378);
	});

	it('works out VAT from the offer total, for prices incl. or excl. VAT', () => {
		expect(lineTotals({ ...bread, ...twoForThree, quantity: 2 }, 2000)).toEqual({
			inclMinor: 300,
			exclMinor: 250
		});
		expect(
			lineTotals({ ...bread, priceIncludesTax: false, ...twoForThree, quantity: 2 }, 2000)
		).toEqual({ inclMinor: 360, exclMinor: 300 });
		expect(tripTotals([{ ...bread, ...twoForThree, quantity: 2 }], 2000).inclMinor).toBe(300);
	});
});
