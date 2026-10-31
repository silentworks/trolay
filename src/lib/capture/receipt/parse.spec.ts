import { describe, expect, it } from 'vitest';
import { line } from '../ocr/fake-lines';
import { parseReceipt } from './parse';

/**
 * A receipt as the OCR sees it: each entry is [left text, right text], printed 40 px apart
 * down a 600 px wide till roll, captions from the left margin and amounts flush right.
 */
function receipt(rows: [string, string?][], { confidence = 0.99, angle = 0, height = 22 } = {}) {
	const tilt = Math.tan((angle * Math.PI) / 180);
	return rows.flatMap(([left, right], i) => {
		const y = 60 + i * 40;
		const leftWidth = left.length * height * 0.55;
		const out = [
			line(left, 40 + leftWidth / 2, y + (40 + leftWidth / 2) * tilt, height, { confidence, angle })
		];
		if (right) {
			const w = right.length * height * 0.55;
			out.push(line(right, 560 - w / 2, y + (560 - w / 2) * tilt, height, { confidence, angle }));
		}
		return out;
	});
}

const SHOP: [string, string?][] = [
	['TESCO STORES LTD'],
	['SEMI SKIMMED MILK', '£1.45'],
	['HOVIS WHOLEMEAL', '£1.40'],
	['BANANAS LOOSE', '£0.82'],
	['CLUBCARD PRICE', '-£0.20']
];

describe('parseReceipt', () => {
	it('reads the total and confirms it with the card payment', () => {
		const reading = parseReceipt(
			receipt([...SHOP, ['TOTAL', '£3.47'], ['MASTERCARD', '£3.47'], ['CHANGE DUE', '£0.00']])
		);
		expect(reading).toMatchObject({ totalMinor: 347, confirmedByPayment: true });
	});

	it('confirms a cash payment less the change', () => {
		const reading = parseReceipt(
			receipt([...SHOP, ['BALANCE DUE', '3.47'], ['CASH', '10.00'], ['CHANGE', '6.53']])
		);
		expect(reading).toMatchObject({ totalMinor: 347, confirmedByPayment: true });
	});

	it('confirms a split payment, card plus cash', () => {
		const reading = parseReceipt(
			receipt([
				['TOTAL', '23.47'],
				['VISA DEBIT', '20.00'],
				['CASH', '5.00'],
				['CHANGE', '1.53']
			])
		);
		expect(reading).toMatchObject({ totalMinor: 2347, confirmedByPayment: true });
	});

	it('ignores a masked card number on the payment line', () => {
		const reading = parseReceipt(
			receipt([
				['TOTAL', '£12.34'],
				['CONTACTLESS ************1234', '£12.34']
			])
		);
		expect(reading).toMatchObject({ totalMinor: 1234, confirmedByPayment: true });
	});

	it('takes a lone total when it is read with high confidence', () => {
		expect(parseReceipt(receipt([...SHOP, ['TOTAL', '£3.47']]))).toMatchObject({
			totalMinor: 347,
			confirmedByPayment: false
		});
	});

	it('leaves a lone total read with doubt for the shopper', () => {
		const reading = parseReceipt(receipt([['TOTAL', '£3.47']], { confidence: 0.8 }));
		expect(reading.totalMinor).toBeUndefined();
		expect(reading.confidence).toBeCloseTo(0.8);
	});

	it('trusts a doubtful total once the payment agrees with it', () => {
		const reading = parseReceipt(
			receipt(
				[
					['TOTAL', '£3.47'],
					['VISA', '£3.47']
				],
				{ confidence: 0.7 }
			)
		);
		expect(reading).toMatchObject({ totalMinor: 347, confirmedByPayment: true });
	});

	it('leaves the total empty when the payments add up to something else', () => {
		// A voucher it cannot read, or a misread digit: either way, ask.
		const reading = parseReceipt(
			receipt([
				['TOTAL', '£13.47'],
				['VISA', '£3.47']
			])
		);
		expect(reading.totalMinor).toBeUndefined();
	});

	it('never takes savings, VAT or a product named "Total"', () => {
		const reading = parseReceipt(
			receipt([
				['FAGE TOTAL 0% 500G', '£2.50'],
				['TOTAL SAVINGS', '£1.20'],
				['VAT TOTAL', '£0.42'],
				['TOTAL EXCL VAT', '£8.33']
			])
		);
		expect(reading).toEqual({ confidence: 0, confirmedByPayment: false });
	});

	it('skips the subtotal and discount to find the balance due', () => {
		const reading = parseReceipt(
			receipt([
				['SUBTOTAL', '£9.99'],
				['MULTIBUY SAVING', '-£1.00'],
				['4 BALANCE DUE', '£8.99'],
				['DEBIT CARD', '£8.99']
			])
		);
		expect(reading).toMatchObject({ totalMinor: 899, confirmedByPayment: true });
	});

	it('asks when two totals differ and nothing settles which was paid', () => {
		const reading = parseReceipt(
			receipt([
				['TOTAL', '£9.99'],
				['AMOUNT DUE', '£8.99']
			])
		);
		expect(reading.totalMinor).toBeUndefined();
	});

	it('picks the total the payment confirms when there are two', () => {
		const reading = parseReceipt(
			receipt([
				['TOTAL', '£9.99'],
				['COUPON', '-£1.00'],
				['TO PAY', '£8.99'],
				['CARD', '£8.99']
			])
		);
		expect(reading).toMatchObject({ totalMinor: 899, confirmedByPayment: true });
	});

	it('reads the amount glued to its caption, a split £ sign and thousands', () => {
		expect(parseReceipt(receipt([['TOTAL £12.34']])).totalMinor).toBe(1234);
		expect(parseReceipt(receipt([['TOTAL £', '12.34']])).totalMinor).toBe(1234);
		expect(parseReceipt(receipt([['GRAND TOTAL', '£1,234.56']])).totalMinor).toBe(123456);
		expect(parseReceipt(receipt([['** TOTAL', '12.34']])).totalMinor).toBe(1234);
	});

	it('reads a caption with an item count beside it', () => {
		expect(parseReceipt(receipt([['TOTAL 12 ITEMS', '£31.08']])).totalMinor).toBe(3108);
	});

	it('forgives digits read for letters in the caption, and O for 0 in the amount', () => {
		expect(parseReceipt(receipt([['T0TAL', '£1O.50']])).totalMinor).toBe(1050);
		expect(parseReceipt(receipt([['BALANCE DU3', '£4.20']])).totalMinor).toBe(420);
	});

	it('never takes an amount without pence, or a refund', () => {
		expect(parseReceipt(receipt([['TOTAL', '£12']])).totalMinor).toBeUndefined();
		expect(parseReceipt(receipt([['TOTAL', '12.34-']])).totalMinor).toBeUndefined();
		expect(parseReceipt(receipt([['TOTAL', '12.34CR']])).totalMinor).toBeUndefined();
	});

	it('pairs captions and amounts on a receipt photographed at an angle', () => {
		const reading = parseReceipt(
			receipt([...SHOP, ['TOTAL', '£3.47'], ['VISA', '£3.47']], { angle: 5 })
		);
		expect(reading).toMatchObject({ totalMinor: 347, confirmedByPayment: true });
	});

	it('does not pair a caption with the amount on the next line', () => {
		const lines = receipt([['TOTAL'], ['MILK', '£1.45']]);
		expect(parseReceipt(lines).totalMinor).toBeUndefined();
	});

	it('counts a gift card as a payment, but not a voucher that may be a discount', () => {
		const giftCard = receipt([
			['TOTAL', '£26.90'],
			['GIFT CARD', '£5.00'],
			['MASTERCARD', '£21.90']
		]);
		expect(parseReceipt(giftCard)).toMatchObject({ totalMinor: 2690, confirmedByPayment: true });
		// The OCR can drop the minus from "-£5.00": that voucher is a discount, not a payment.
		const voucher = receipt([
			['VOUCHER', '£5.00'],
			['TOTAL', '£20.20'],
			['VISA', '£20.20']
		]);
		expect(parseReceipt(voucher)).toMatchObject({ totalMinor: 2020, confirmedByPayment: true });
	});

	it('takes off cashback given with a card payment', () => {
		const reading = parseReceipt(
			receipt([
				['AMOUNT DUE', '£20.20'],
				['CONTACTLESS VISA', '£30.20'],
				['CASHBACK', '£10.00']
			])
		);
		expect(reading).toMatchObject({ totalMinor: 2020, confirmedByPayment: true });
	});

	it('lets the payments decide when a curled receipt shifts the amounts by a line', () => {
		// The amount column sits half a line higher than the captions on every row, so pairing by
		// the text's own slope is ambiguous; only one pairing makes the cash and change add up.
		const shifted: [string, string?][] = [
			['PORK SAUSAGES 8PK', '£2.75'],
			['SEMI SKIMMED MILK 4PT', '£1.65'],
			['TOTAL', '£22.81'],
			['CASH', '£30.00'],
			['CHANGE', '£7.19']
		];
		const lines = receipt(shifted).map((l, i) =>
			i % 2
				? {
						...l,
						region: { ...l.region, cy: l.region.cy - 18 },
						words: l.words.map((w) => ({
							...w,
							box: w.box.map(([x, y]) => [x, y - 18] as [number, number])
						}))
					}
				: l
		);
		expect(parseReceipt(lines)).toMatchObject({ totalMinor: 2281, confirmedByPayment: true });
	});

	it('reads the total of a Korean food shop receipt, from the photo that failed', () => {
		// "Total ( 7 items )" has the count on its own, the amounts end in "£", the card line has a
		// stray digit, and the tax lines below must not be mistaken for the total.
		const korean: [string, string?][] = [
			['MOGU MOGU Nata De Coco Drink Lychee', '0.99 01'],
			['Glico Pocky Stick Cookies & Cream 45G', '2.38 02'],
			['110155/56/57/58 Buy 1 Get', '-1.39'],
			['Oreo Cookies - Birthday Cake 97G', '2.29 02'],
			['Total ( 7 items )', '7.84 £'],
			['Without tax', '7.54£'],
			['Total tax', '0.30£'],
			['Credit Card 5', '7.84£'],
			['Sale tax description'],
			['UK Std rat02', '0.00% 7.45 0.00'],
			['UK Std rat01', '20.00% 1.78 0.30'],
			['Total tax', '0.30']
		];
		expect(parseReceipt(receipt(korean))).toMatchObject({
			totalMinor: 784,
			confirmedByPayment: true
		});
	});

	it('reads a total whose amount is printed lower than its caption', () => {
		// A total in larger type: the amount sits most of a line below the caption, while the
		// other lines line up. The card payment settles it.
		const lines = receipt([
			['MILK', '1.45'],
			['BREAD', '1.40'],
			['Total ( 2 items )', '2.85 £'],
			['Credit Card', '2.85£']
		]).map((l, i) =>
			i === 5
				? {
						...l,
						region: { ...l.region, cy: l.region.cy + 16 },
						words: l.words.map((w) => ({
							...w,
							box: w.box.map(([x, y]) => [x, y + 16] as [number, number])
						}))
					}
				: l
		);
		expect(parseReceipt(lines)).toMatchObject({ totalMinor: 285, confirmedByPayment: true });
	});

	it('does not take the tax lines for the total', () => {
		const reading = parseReceipt(
			receipt([
				['Without tax', '7.54£'],
				['Total tax', '0.30£'],
				['UK Std rat01', '20.00% 1.78 0.30']
			])
		);
		expect(reading.totalMinor).toBeUndefined();
	});

	// The same reader on the layouts different kinds of shop print.
	describe.each<[string, [string, string?][], number]>([
		[
			'supermarket, VAT summary and loyalty points',
			[
				['ASDA STORES LTD'],
				['SEMI SKIMMED 2L', '1.55'],
				['CHICKEN BREAST', '4.50'],
				['SUBTOTAL', '6.05'],
				['TOTAL SAVINGS', '0.50'],
				['TOTAL TO PAY', '6.05'],
				['DEBIT CARD', '6.05'],
				['VAT A 20.00%', '0.62'],
				['POINTS BALANCE', '120.00']
			],
			605
		],
		[
			'convenience store, cash with change',
			[
				['LONDON NEWS LTD'],
				['MARS BAR', '0.95'],
				['LUCOZADE', '1.60'],
				['BALANCE DUE', '2.55'],
				['CASH TENDERED', '5.00'],
				['CHANGE DUE', '2.45']
			],
			255
		],
		[
			'takeaway, total in brackets with the item count after it',
			[
				['KING WOK'],
				['SWEET & SOUR CHICKEN', '8.50'],
				['EGG FRIED RICE', '3.00'],
				['Total ( 2 items )', '11.50 £'],
				['Cash', '20.00 £'],
				['Change', '8.50 £']
			],
			1150
		],
		[
			'restaurant with a service charge',
			[
				['THE ROYAL OAK'],
				['SUNDAY ROAST', '14.50'],
				['SERVICE CHARGE 12.5%', '1.81'],
				['AMOUNT DUE', '16.31'],
				['VISA CONTACTLESS', '16.31']
			],
			1631
		],
		[
			'pharmacy with a multibuy and a voucher',
			[
				['BOOTS PHARMACY'],
				['SHAMPOO 3 FOR 2', '9.00'],
				['MULTIBUY SAVING', '-3.00'],
				['ADVANTAGE VOUCHER', '-2.00'],
				['TOTAL', '4.00'],
				['MASTERCARD', '4.00']
			],
			400
		],
		[
			'amounts followed by a pound sign, card line with a masked number',
			[
				['ORIENTAL MART'],
				['RAMEN CUP', '1.39 £'],
				['PEAR DRINK', '0.79 £'],
				['TOTAL ( 2 ITEMS )', '2.18 £'],
				['CREDIT CARD ************5678', '2.18 £']
			],
			218
		]
	])('%s', (_, rows, totalMinor) => {
		it('is read and confirmed by the payment', () => {
			expect(parseReceipt(receipt(rows))).toMatchObject({ totalMinor, confirmedByPayment: true });
		});

		it('is read from a photo taken at an angle', () => {
			expect(parseReceipt(receipt(rows, { angle: 4 })).totalMinor).toBe(totalMinor);
		});
	});

	describe('a receipt that ends at its subtotal', () => {
		it('takes the subtotal as the total when there is no total', () => {
			const reading = parseReceipt(receipt([...SHOP, ['SUBTOTAL', '£3.47']]));
			expect(reading).toMatchObject({ totalMinor: 347, confirmedByPayment: false });
			expect(parseReceipt(receipt([...SHOP, ['SUB-TOTAL', '3.47']])).totalMinor).toBe(347);
			expect(parseReceipt(receipt([...SHOP, ['Sub Total', '3.47']])).totalMinor).toBe(347);
		});

		it('confirms it with the card payment', () => {
			const reading = parseReceipt(receipt([...SHOP, ['SUBTOTAL', '3.47'], ['VISA', '3.47']]));
			expect(reading).toMatchObject({ totalMinor: 347, confirmedByPayment: true });
		});

		it('prefers the total whenever the receipt has one', () => {
			const reading = parseReceipt(
				receipt([
					['SUBTOTAL', '£9.99'],
					['MULTIBUY SAVING', '-£1.00'],
					['TOTAL', '£8.99'],
					['VISA', '£8.99']
				])
			);
			expect(reading).toMatchObject({ totalMinor: 899, confirmedByPayment: true });
		});

		it('does not stand a subtotal in for a total whose amount it cannot find', () => {
			const reading = parseReceipt(receipt([['SUBTOTAL', '£9.99'], ['TOTAL']]));
			expect(reading.totalMinor).toBeUndefined();
		});

		it('asks when the subtotals differ and nothing settles which', () => {
			const reading = parseReceipt(
				receipt([
					['SUBTOTAL', '£5.00'],
					['SUBTOTAL', '£9.99']
				])
			);
			expect(reading.totalMinor).toBeUndefined();
		});

		it('leaves a subtotal read with doubt for the shopper', () => {
			const reading = parseReceipt(receipt([['SUBTOTAL', '£3.47']], { confidence: 0.8 }));
			expect(reading.totalMinor).toBeUndefined();
		});

		it('is not fooled by the subtotal line that counts the items', () => {
			const reading = parseReceipt(
				receipt([['Sub-Total no. of items = 16'], ['**** TOTAL ( INCL VAT )', '443.31']])
			);
			expect(reading.totalMinor).toBe(44331);
		});
	});

	it('reads a total with "incl VAT" after the caption, and a stray bracket or star', () => {
		for (const caption of [
			'TOTAL (INCL VAT)',
			'TOTAL( INCL VAT )',
			'**** TOTAL(INCL VAT)',
			'TOTAL INC VAT',
			'Total incl. VAT',
			'TOTAL INCLUDING VAT'
		]) {
			expect(parseReceipt(receipt([[caption, '443.31']])).totalMinor, caption).toBe(44331);
		}
	});

	it('does not wait on the confidence of "VAT)" when the amount is read well', () => {
		const lines = receipt([['**** TOTAL(INCL VAT)', '443.31']]);
		// The bracket drags "VAT)" down, as in the photo of a wholesale receipt.
		const vat = lines[0].words.find((w) => w.text === 'VAT)')!;
		vat.confidence = 0.5;
		expect(parseReceipt(lines)).toMatchObject({ totalMinor: 44331 });
	});
});
