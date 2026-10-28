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

	it('never takes a subtotal, savings, VAT or a product named "Total"', () => {
		const reading = parseReceipt(
			receipt([
				['FAGE TOTAL 0% 500G', '£2.50'],
				['SUBTOTAL', '£9.99'],
				['SUB-TOTAL', '£9.99'],
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
});
