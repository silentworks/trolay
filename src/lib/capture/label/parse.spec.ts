import { describe, expect, it } from 'vitest';
import type { TextLine } from '../ocr/engine';
import { filledFields, packSize, parseLabel } from './parse';

/**
 * A line of OCR output: text centred at (cx, cy), `height` pixels tall, words spread evenly
 * across `width` (default: 0.55 × height per character), at an optional tilt in degrees.
 */
function line(
	text: string,
	cx: number,
	cy: number,
	height: number,
	{ width = text.length * height * 0.55, confidence = 0.99, angle = 0 } = {}
): TextLine {
	const rad = (angle * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	let offset = 0;
	const words = text.split(' ').map((word) => {
		const start = offset / text.length;
		const end = (offset + word.length) / text.length;
		offset += word.length + 1;
		const u0 = (start - 0.5) * width;
		const u1 = (end - 0.5) * width;
		const corner = (u: number, v: number): [number, number] => [
			cx + u * cos - v * sin,
			cy + u * sin + v * cos
		];
		return {
			text: word,
			confidence,
			box: [
				corner(u0, -height / 2),
				corner(u1, -height / 2),
				corner(u1, height / 2),
				corner(u0, height / 2)
			]
		};
	});
	return { text, confidence, region: { cx, cy, width, height, angle: rad }, words };
}

const filled = (lines: TextLine[]) => filledFields(parseLabel(lines));

describe('parseLabel: real labels', () => {
	it('reads a warehouse sign and confirms the price with the unit price', () => {
		// fixtures/labels/real/warehouse-avocado-oil.png, as PP-OCRv5 reads it.
		const reading = parseLabel([
			line('1129578', 220, 75, 68),
			line("MARIANNE'S", 190, 118, 39),
			line('AVOCADO OIL', 202, 158, 39),
			line('2 L', 89, 197, 39),
			line('PRICE PER LITER', 129, 286, 17),
			line('SELL PRICE', 587, 291, 19),
			line('9.995', 114, 325, 40),
			line('19.99', 503, 351, 127),
			line('1/23/23', 636, 401, 14)
		]);
		expect(filledFields(reading)).toMatchObject({
			description: "MARIANNE'S AVOCADO OIL 2 L",
			unitPriceMinor: 1999,
			priceIncludesTax: undefined
		});
		expect(reading.checks).toContain('price matches the unit price and pack size');
	});

	it('reads a UK label with the pound sign, unit price and barcode digits', () => {
		// fixtures/labels/real/uk-cully-sully-chowder.jpg: two description lines tilted 6–8°.
		const reading = parseLabel([
			line('Cully & Sully Smoked Salmon & Haddock', 392, 143, 45, { width: 622, angle: 6.2 }),
			line('Chowder 400g', 195, 160, 47, { width: 228, angle: 8.2 }),
			line('£1.99', 516, 330, 220, { width: 489, angle: 6.6 }),
			line('49.8p per 100g', 165, 295, 51, { width: 181, angle: 9.3 }),
			line('112673550', 230, 371, 32),
			line('5391511420780', 251, 406, 29)
		]);
		expect(filledFields(reading)).toMatchObject({
			description: 'Cully & Sully Smoked Salmon & Haddock Chowder 400g',
			unitPriceMinor: 199,
			barcode: '5391511420780'
		});
		expect(reading.checks).toContain('price matches the unit price and pack size');
	});

	it('joins small raised cents read as a separate line ("2⁰⁹ €")', () => {
		// fixtures/labels/real/be-esl-coca-cola.jpg
		const fields = filled([
			line('1.5L COCA REGULAR PET', 749, 232, 66, { width: 810 }),
			line('COCA-COLA', 538, 361, 71, { width: 387 }),
			line('09', 1252, 427, 186, { width: 174 }),
			line('2', 1109, 478, 287, { width: 153 }),
			line('€', 1224, 558, 128, { width: 94 }),
			line('201 6', 491, 647, 64),
			line('330384 0439', 535, 704, 59, { width: 355 }),
			line('1,393/l', 1332, 748, 79, { width: 212 })
		]);
		expect(fields.unitPriceMinor).toBe(209);
		expect(fields.description).toBe('1.5L COCA REGULAR PET COCA-COLA');
	});

	it('joins raised cents on the same line, and ignores a line of codes', () => {
		// fixtures/labels/real/be-esl-muesli.jpg
		const reading = parseLabel([
			line('300G CRUNCHY STEVIA CHOCO&NOIX', 775, 296, 61, { width: 982 }),
			line('1', 1070, 476, 206, { width: 84 }),
			line('46', 1171, 460, 192, { width: 115, confidence: 0.51 }),
			line('2.20 14 13 1 ZE', 826, 594, 61, { width: 464 }),
			line('4,867/kg', 1146, 637, 78, { width: 267 })
		]);
		// The raised pence were read doubtfully, but €1.46 for 300 g is exactly the printed
		// €4,867 per kg (a decimal comma), which confirms it.
		expect(filledFields(reading).unitPriceMinor).toBe(146);
		expect(reading.checks).toContain('price matches the unit price and pack size');
	});

	it('reads a whole-dollar price with a big "$" read as S, ignoring the was-price', () => {
		// fixtures/labels/real/au-esl-tissues.jpg
		const fields = filled([
			line('PRICES', 200, 120, 136, { width: 380 }),
			line('DROPPED', 200, 220, 103, { width: 380 }),
			line('S', 400, 170, 218, { width: 80 }),
			line('11', 560, 200, 390, { width: 230 }),
			line('ea', 720, 330, 71, { width: 60 }),
			line('Kleenex T/tissue White 24pk', 780, 430, 99, { width: 800 }),
			line('Range Was $16', 200, 560, 100, { width: 500 }),
			line('03/05/16', 200, 660, 94, { width: 360 }),
			line('$0.25/100 Sheets', 240, 760, 97, { width: 640 })
		]);
		expect(fields.unitPriceMinor).toBe(1100);
		expect(fields.description).toBe('Kleenex T/tissue White 24pk');
	});
});

describe('parseLabel: prices that are not the item price', () => {
	const base = [line('Strawberries 400g', 300, 60, 40)];

	it('ignores was-prices, multi-buys, savings and unit prices', () => {
		for (const other of [
			'Was £3.00',
			'Any 2 for £3.00',
			'Save £1.00',
			'£5.00 per kg',
			'£5.00/kg'
		]) {
			const fields = filled([...base, line(other, 250, 150, 40), line('£2.00', 600, 300, 150)]);
			expect(fields.unitPriceMinor, other).toBe(200);
		}
	});

	it('does not take a unit price glued to its unit as the description', () => {
		const fields = filled([line('64p/litre', 300, 60, 40), line('£1.45', 600, 300, 150)]);
		expect(fields.description).toBeUndefined();
		expect(fields.unitPriceMinor).toBe(145);
	});

	it('prefers the regular price to a loyalty-card price', () => {
		const fields = filled([
			...base,
			line('Regular price', 200, 200, 30),
			line('£3.99', 200, 270, 100),
			line('Clubcard Price', 760, 170, 32),
			line('£3.19', 760, 290, 150)
		]);
		expect(fields.unitPriceMinor).toBe(399);
	});

	it('is unsure between two different prices of a similar size', () => {
		const reading = parseLabel([
			...base,
			line('£1.75', 300, 300, 150),
			line('£1.25', 700, 300, 140)
		]);
		expect(filledFields(reading).unitPriceMinor).toBeUndefined();
		expect(reading.unitPriceMinor?.confidence).toBeLessThan(0.6);
	});

	it('is unsure when bigger text with digits could not be read as a price', () => {
		const reading = parseLabel([
			...base,
			line('£0.18 each', 200, 150, 40),
			line('1g5', 600, 300, 200)
		]);
		expect(filledFields(reading).unitPriceMinor).toBeUndefined();
	});

	it('does not read pack sizes, percentages or dates as prices', () => {
		for (const text of ['1.50 L', '12.50%', '1/23/23']) {
			expect(filled([...base, line(text, 600, 300, 150)]).unitPriceMinor, text).toBeUndefined();
		}
	});
});

describe('parseLabel: ambiguous whole numbers', () => {
	it('reads "£0⁸⁹" merged into "089" as 89p', () => {
		const fields = filled([
			line('LONG GRAIN RICE 500G', 500, 110, 80),
			line('£', 645, 327, 66, { width: 40 }),
			line('089', 830, 437, 314, { width: 400 }),
			line('(£1.78/kg)', 234, 633, 69)
		]);
		expect(fields.unitPriceMinor).toBe(89);
	});

	it('accepts a doubtful price when the unit price, read separately, confirms it', () => {
		// fixtures/labels/dev ESL: "1²⁵" read as "1" (43%) and "25"; 13.9p per 100 ml × 900 ml.
		const reading = parseLabel([
			line('WASHING UP LIQUID 900ML', 344, 125, 63, { width: 486 }),
			line('25', 684, 296, 125, { width: 128 }),
			line('1', 557, 375, 267, { width: 116, confidence: 0.43 }),
			line('13.9p/100ml', 870, 637, 54, { width: 193 })
		]);
		expect(filledFields(reading).unitPriceMinor).toBe(125);
		expect(reading.checks).toContain('price matches the unit price and pack size');
	});

	it('settles "£149" as £1.49 or £149 only by the unit price', () => {
		const label = (unit: string) => [
			line('CORNFLAKES 500G', 500, 110, 60),
			line('£', 600, 260, 70, { width: 40 }),
			line('149', 760, 380, 280, { width: 320 }),
			line(unit, 230, 600, 40)
		];
		expect(filled(label('(£2.98/kg)')).unitPriceMinor).toBe(149);
		expect(filled(label('(£298.00/kg)')).unitPriceMinor).toBe(14900);
		expect(filled(label('Offer ends Sunday')).unitPriceMinor).toBeUndefined();
	});
});

describe('parseLabel: raised pence and whole numbers', () => {
	it("joins raised pence even when the big digit's box came out short", () => {
		// fixtures/labels/dev/115-discounter.jpg: the "1" was found only by its lower part.
		const fields = filled([
			line('CEREAL BARS 6 PACK', 417, 156, 53),
			line('£', 594, 341, 72, { width: 44 }),
			line('99', 822, 369, 108, { width: 109 }),
			line('1', 678, 465, 168, { width: 76 }),
			line('(33p/each)', 257, 662, 51)
		]);
		expect(fields.unitPriceMinor).toBe(199);
	});

	it('never reads raised pence as whole pounds when the big digit was misread', () => {
		// fixtures/labels/dev/159-esl.jpg: "£1⁷⁵" with the "1" read as "L".
		const reading = parseLabel([
			line('ALUMINIUM FOIL 10M', 327, 203, 66),
			line('75', 772, 364, 131, { width: 144 }),
			line('L', 646, 510, 150, { width: 65, confidence: 0.71 }),
			line('£', 742, 514, 85, { width: 51 }),
			line('£1.75/each', 996, 751, 53)
		]);
		expect(filledFields(reading).unitPriceMinor).toBeUndefined();
	});

	it('checks a pack count against the price each, and a single item against its each price', () => {
		const six = (price: string) =>
			filled([
				line('Cereal Bars 6 Pack', 300, 60, 40),
				line(price, 600, 300, 150),
				line('33p each', 200, 450, 40)
			]);
		expect(six('£1.99').unitPriceMinor).toBe(199);
		// 16.7p each would not be 33p each.
		expect(six('£1.00').unitPriceMinor).toBeUndefined();
		const single = (price: string) =>
			filled([
				line('Aluminium Foil 10m', 300, 60, 40),
				line(price, 600, 300, 150),
				line('£1.75/each', 700, 450, 40)
			]);
		expect(single('£1.75').unitPriceMinor).toBe(175);
		expect(single('£1.57').unitPriceMinor).toBeUndefined();
	});

	it('does not compare counts of different things', () => {
		const fields = filled([
			line('Kleenex T/tissue White 24pk', 300, 60, 40),
			line('$11', 600, 300, 150),
			line('$0.25/100 Sheets', 250, 450, 40)
		]);
		expect(fields.unitPriceMinor).toBe(1100);
	});
});

describe('parseLabel: VAT', () => {
	it('reads the marker on the price, and checks it against the other price', () => {
		const reading = parseLabel([
			line('Cola 24 x 330ml Cans', 300, 80, 44),
			line('£10.50', 280, 285, 123),
			line('ex VAT', 683, 314, 49),
			line('£12.60 inc VAT', 213, 385, 46)
		]);
		expect(filledFields(reading)).toMatchObject({ unitPriceMinor: 1050, priceIncludesTax: false });
		expect(reading.checks).toContain('inc and ex VAT prices agree');
	});

	it('works out the big price is inc VAT from the marked ex VAT price', () => {
		const fields = filled([
			line('Hand Wash 250ml', 300, 80, 44),
			line('£1.02', 280, 285, 150),
			line('£0.85 EXC VAT', 213, 385, 46)
		]);
		expect(fields).toMatchObject({ unitPriceMinor: 102, priceIncludesTax: true });
	});

	it('says nothing about VAT when the price itself was not read', () => {
		// fixtures/labels/holdout/093-trade.jpg: the price was garbled, the marker was not.
		const fields = filled([
			line('Ginger Beer 4 x 330ml', 418, 134, 77),
			line('2C£2.99', 300, 373, 193, { width: 609, confidence: 0.76 }),
			line('£1.20 per £3.59 inc VAT', 250, 519, 103, { width: 528, confidence: 0.39 })
		]);
		expect(fields.unitPriceMinor).toBeUndefined();
		expect(fields.priceIncludesTax).toBeUndefined();
	});

	it('says nothing when the label has no VAT marker', () => {
		expect(
			filled([line('Milk 2L', 200, 60, 40), line('£1.45', 600, 300, 150)]).priceIncludesTax
		).toBeUndefined();
	});
});

describe('parseLabel: description', () => {
	it('skips promotional banners, captions, codes, stray glyphs and retailer names', () => {
		const fields = filled([
			line('SPECIAL OFFER', 500, 40, 44),
			line('ADCOOP', 600, 100, 35),
			line('D', 100, 300, 62),
			line('2961570550495', 250, 150, 34),
			line('BAYARA CARDAMON WHOLE', 450, 440, 43),
			line('330gm', 470, 478, 36),
			line('39.75', 475, 310, 92)
		]);
		expect(fields.description).toBe('BAYARA CARDAMON WHOLE 330gm');
	});

	it('takes the most prominent block of words, not small captions', () => {
		const fields = filled([
			line('JAMFORPRIS KR/KG', 300, 540, 56),
			line('Chipotle Chil', 360, 600, 123),
			line('Santa Mari 37 g', 250, 680, 58)
		]);
		expect(fields.description).toBe('Chipotle Chil');
	});

	it("keeps a two-line name together when a neighbour's fragment falls between the lines", () => {
		// fixtures/labels/test/073-classic.jpg: "erry" from the next label at the frame edge.
		const fields = filled([
			line('Peppers', 194, 140, 56, { width: 186 }),
			line('erry', 1094, 173, 44, { width: 83 }),
			line('Mixed 3 Pack', 248, 195, 51, { width: 299 }),
			line('£1.55', 789, 426, 211, { width: 498 })
		]);
		expect(fields.description).toBe('Peppers Mixed 3 Pack');
	});

	it('keeps a size line with few letters ("5% FAT 500G")', () => {
		const fields = filled([
			line('BEEF MINCE', 336, 196, 48, { width: 229 }),
			line('5% FAT 500G', 328, 246, 48, { width: 239 }),
			line('£4.25', 700, 450, 190)
		]);
		expect(fields.description).toBe('BEEF MINCE 5% FAT 500G');
	});

	it('reads a slash misread as "l" in a unit price ("33pleach")', () => {
		const fields = filled([
			line('LARGE BROWN EGGS 6 PACK', 630, 218, 61, { width: 681 }),
			line('£1.99', 760, 420, 240),
			line('33pleach', 900, 700, 70, { width: 260 })
		]);
		expect(fields.description).toBe('LARGE BROWN EGGS 6 PACK');
	});

	it('leaves a description it is unsure of empty', () => {
		const fields = filled([
			line('3OOG CRUNCHYSTEVA', 300, 60, 60, { confidence: 0.63 }),
			line('£1.46', 600, 300, 150)
		]);
		expect(fields.description).toBeUndefined();
	});
});

describe('packSize', () => {
	it('reads single and multipack sizes in base units', () => {
		expect(packSize('Milk 2.272L 4 Pints')).toEqual({ amount: 2272, dimension: 'volume' });
		expect(packSize('Baked Beans 4 x 415g')).toEqual({ amount: 1660, dimension: 'mass' });
		expect(packSize('AVOCADO OIL 2 L')).toEqual({ amount: 2000, dimension: 'volume' });
		expect(packSize('Red Wine 75cl')).toEqual({ amount: 750, dimension: 'volume' });
		expect(packSize('Eggs 12 Pack')).toBeUndefined();
	});
});
