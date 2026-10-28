import { describe, expect, it } from 'vitest';
import { isValidGtin } from './gtin';
import { confident, parseLabel, type OcrLine } from './parse-label';

// [text, confidence, height] as Tesseract reported them for the synthetic fixtures.
const lines = (...rows: [string, number, number][]): OcrLine[] =>
	rows.map(([text, confidence, height]) => ({ text, confidence, height }));

describe('parseLabel', () => {
	it('reads a classic label: description, big price, barcode digits', () => {
		const reading = parseLabel(
			lines(
				['Semi Skimmed Milk', 93, 30],
				['2.272L 4 Pints', 94, 30],
				['£1.45', 95, 107],
				['IIMA OE stor', 30, 100],
				['5012345678900', 91, 18]
			)
		);
		expect(reading.description?.value).toBe('Semi Skimmed Milk 2.272L 4 Pints');
		expect(reading.unitPriceMinor).toEqual({ value: 145, confidence: 0.95 });
		expect(reading.priceIncludesTax).toBeUndefined();
		expect(reading.barcode?.value).toBe('5012345678900');
	});

	it('ignores unit prices and old "was" prices', () => {
		const reading = parseLabel(
			lines(
				['Strawberries', 95, 29],
				['4009', 77, 35],
				['Was £3.00', 96, 26],
				['£2.00', 96, 107],
				['£5.00 per kg', 96, 26]
			)
		);
		expect(reading.description?.value).toBe('Strawberries');
		expect(reading.unitPriceMinor?.value).toBe(200);
	});

	it('ignores multi-buy offers', () => {
		const reading = parseLabel(
			lines(['Chocolate Digestives', 95, 29], ['Any 2 for £2.50', 95, 26], ['£1.50', 95, 107])
		);
		expect(reading.unitPriceMinor?.value).toBe(150);
	});

	it('falls back to an "each" price when the main price was not read', () => {
		const reading = parseLabel(lines(['Bananas Loose', 96, 29], ['£0.18 each', 96, 23]));
		expect(reading.unitPriceMinor?.value).toBe(18);
		expect(reading.unitPriceMinor!.confidence).toBeLessThan(0.96);
	});

	it('reads pence prices', () => {
		expect(
			parseLabel(lines(['Spaghetti 500g', 90, 30], ['75p', 92, 110])).unitPriceMinor?.value
		).toBe(75);
	});

	it('treats a trade price as ex VAT when another price on the label is marked inc VAT', () => {
		const reading = parseLabel(
			lines(
				['Cola 24 x 330ml', 94, 29],
				['Cans', 96, 28],
				['£10.50 .w«', 47, 92],
				['£12.60 inc VAT', 95, 30],
				['£1.33 per litre', 92, 26]
			)
		);
		expect(reading.unitPriceMinor?.value).toBe(1050);
		expect(reading.priceIncludesTax?.value).toBe(false);
		expect(reading.description?.value).toBe('Cola 24 x 330ml Cans');
	});

	it('reads a VAT marker on the price line itself', () => {
		const reading = parseLabel(lines(['Bleach 5L', 95, 30], ['£4.25 ex VAT', 93, 100]));
		expect(reading.priceIncludesTax).toEqual({ value: false, confidence: 0.95 });
	});

	it('fixes digits OCR commonly confuses after a £ sign', () => {
		expect(parseLabel(lines(['£l.4S', 90, 100])).unitPriceMinor?.value).toBe(145);
		expect(parseLabel(lines(['£ 2,O0', 90, 100])).unitPriceMinor?.value).toBe(200);
	});

	it('does not read pack sizes as prices', () => {
		expect(parseLabel(lines(['Orange Juice 1.50L', 90, 30])).unitPriceMinor).toBeUndefined();
	});

	it('is unsure when two different prices are a similar size', () => {
		const reading = parseLabel(lines(['£1.75', 95, 100], ['£1.25', 95, 95]));
		expect(reading.unitPriceMinor!.confidence).toBeLessThan(0.6);
	});

	it('skips promo banners and low-confidence noise in the description', () => {
		const reading = parseLabel(
			lines(['SPECIAL OFFER', 96, 30], ['em', 10, 140], ['Frozen Peas', 94, 29], ['£1.20', 95, 100])
		);
		expect(reading.description?.value).toBe('Frozen Peas');
	});

	it('repairs a big price that came back in pieces, with less confidence', () => {
		const price = parseLabel(lines(['£ 1 | 5 0', 86, 107])).unitPriceMinor;
		expect(price?.value).toBe(150);
		expect(price!.confidence).toBeLessThan(0.7);
	});

	it('scores a price on its own words, not the whole line', () => {
		const reading = parseLabel([
			{
				text: '£10.50 .w«',
				confidence: 47,
				height: 92,
				words: [
					{ text: '£10.50', confidence: 93 },
					{ text: '.w«', confidence: 0 }
				]
			}
		]);
		expect(reading.unitPriceMinor).toEqual({ value: 1050, confidence: 0.93 });
	});

	describe('with a second, downscaled pass', () => {
		const detail = lines(
			['Toilet Tissue', 96, 29],
			['£5 |_| 2 5', 85, 123],
			['58.3p per roll', 93, 28]
		);

		it('trusts a price both passes agree on more', () => {
			const price = parseLabel(lines(['£5.25', 80, 100]), lines(['£5.25', 80, 114])).unitPriceMinor;
			expect(price?.value).toBe(525);
			expect(price?.confidence).toBeCloseTo(0.95);
		});

		it('reads the big price from the downscaled pass', () => {
			expect(parseLabel(detail, lines(['£5.25', 96, 114])).unitPriceMinor?.value).toBe(525);
		});

		it('doubts a price when the other pass read a different one', () => {
			const price = parseLabel(lines(['£3.50', 96, 122]), lines(['£3.20', 85, 216])).unitPriceMinor;
			expect(price?.value).toBe(350);
			expect(price!.confidence).toBeLessThan(0.6);
		});

		it('doubts a small price when the other pass has big digits it could not read', () => {
			const price = parseLabel(
				lines(['Spaghetti', 95, 54], ['15p P', 96, 152]),
				lines(['Spaghetti', 86, 48], ['500g', 86, 36], ['159 P', 44, 153])
			).unitPriceMinor;
			expect(price!.confidence).toBeLessThan(0.6);
		});
	});

	it('returns nothing it could not read', () => {
		expect(parseLabel(lines(['em', 10, 140]))).toEqual({
			description: undefined,
			unitPriceMinor: undefined,
			priceIncludesTax: undefined,
			barcode: undefined
		});
	});
});

describe('confident', () => {
	it('keeps confident values and drops doubtful ones', () => {
		expect(confident({ value: 'Milk', confidence: 0.9 })).toBe('Milk');
		expect(confident({ value: 'Mlik', confidence: 0.4 })).toBeUndefined();
		expect(confident(undefined)).toBeUndefined();
	});
});

describe('isValidGtin', () => {
	it('accepts valid EAN-13, UPC-A and EAN-8 codes', () => {
		expect(isValidGtin('5012345678900')).toBe(true);
		expect(isValidGtin('036000291452')).toBe(true);
		expect(isValidGtin('96385074')).toBe(true);
	});

	it('rejects bad check digits and other lengths', () => {
		expect(isValidGtin('5012345678901')).toBe(false);
		expect(isValidGtin('12345')).toBe(false);
		expect(isValidGtin('50123456789OO')).toBe(false);
	});
});
