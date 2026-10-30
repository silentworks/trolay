import { buildRows, yAt, type Row, type Token } from '../label/layout.ts';
import type { TextLine } from '../ocr/engine.ts';

// Reads the total from a photo of a till receipt. The total line is found by what it says, not
// by its size or position: the row must be nothing but a total caption ("TOTAL", "BALANCE DUE",
// "AMOUNT TO PAY"…) and an amount, so "SUBTOTAL", "TOTAL SAVINGS", "VAT TOTAL" and a product
// named "FAGE TOTAL 0%" never qualify. The payment lines below it (card, cash less change) are
// read the same way: when they add up to the total, two independent readings agree.

export interface ReceiptReading {
	/** Pence; set only when the reading is trustworthy, otherwise the shopper types it. */
	totalMinor?: number;
	/** 0–1: the lowest character confidence of the caption and amount it came from. */
	confidence: number;
	/** The card and cash payments add up to the total. */
	confirmedByPayment: boolean;
}

/** A total read on its own must be this sure; one the payments confirm, much less. */
export const MIN_CONFIDENCE = { alone: 0.9, confirmed: 0.5 } as const;

const TOTAL_CAPTIONS = new Set([
	'TOTAL',
	'TOTAL DUE',
	'TOTAL TO PAY',
	'TOTAL PAYABLE',
	'TOTAL AMOUNT',
	'TOTAL GBP',
	'GRAND TOTAL',
	'ORDER TOTAL',
	'BALANCE',
	'BALANCE DUE',
	'BAL DUE',
	'BALANCE TO PAY',
	'AMOUNT DUE',
	'AMOUNT TO PAY',
	'AMOUNT PAYABLE',
	'TO PAY'
]);

type Tender = 'paid' | 'change' | 'cashback';

/** Every word of a payment caption must come from one of these. */
const PAID_WORDS = new Set([
	'CARD',
	'CARDS',
	'VISA',
	'DEBIT',
	'CREDIT',
	'MASTERCARD',
	'MASTER',
	'CONTACTLESS',
	'AMEX',
	'AMERICAN',
	'EXPRESS',
	'MAESTRO',
	'APPLE',
	'GOOGLE',
	'PAY',
	'CASH',
	'TENDERED',
	'TENDER',
	'PAYMENT',
	'PAID',
	'GIFT',
	'GBP'
]);
const CHANGE_CAPTIONS = new Set(['CHANGE', 'CHANGE DUE', 'CHANGE GIVEN']);
const CASHBACK_CAPTIONS = new Set(['CASHBACK', 'CASH BACK']);

// Letters the recogniser reads as digits inside a caption word ("T0TAL", "BALANCE DU3").
const DIGIT_AS_LETTER: Record<string, string> = {
	'0': 'O',
	'1': 'I',
	'5': 'S',
	'8': 'B',
	'3': 'E'
};

/**
 * An amount with pence, the pound sign before or after it; "-" or "CR" around it marks a refund
 * or discount, which is skipped.
 */
const AMOUNT = /^(-)?£?(\d{1,3}(?:,\d{3})+|\d{1,5})[.,](\d{2})£?(-|CR)?$/i;

/** A currency sign on its own, which some tills print after the amount: "7.84 £". */
const CURRENCY = /^(£|GBP)$/i;

function amountOf(text: string): number | null | undefined {
	const cleaned = text.replace(/[Oo](?=[\d.,]*$)/g, '0');
	const match = AMOUNT.exec(cleaned);
	if (!match) return undefined;
	if (match[1] || match[4]) return null;
	return Number(match[2].replace(/,/g, '')) * 100 + Number(match[3]);
}

interface Piece {
	caption: string;
	captionTokens: Token[];
	amount?: { minor: number; token: Token };
}

/** Splits a row into its caption words and an amount at the right end. */
function split(row: Row): Piece {
	const tokens = [...row.tokens];
	while (tokens.length > 1 && CURRENCY.test(tokens.at(-1)!.text)) tokens.pop();
	let amount: Piece['amount'];
	// "£ 12.34" can come apart into a currency sign and a number.
	const last = tokens.at(-1);
	const minor = last && amountOf(last.text);
	if (last && typeof minor === 'number') {
		amount = { minor, token: last };
		tokens.pop();
	} else if (last && minor === null) {
		tokens.pop();
	}
	const words = tokens
		.map((t) => t.text.toUpperCase().replace(/[£*:=#.\-_()[\]]+/g, ''))
		.filter((w) => w !== '')
		.map((w) => (/[A-Z]/.test(w) ? w.replace(/[0-9]/g, (d) => DIGIT_AS_LETTER[d] ?? d) : w));
	// A count of items is often printed with the total: "4 BALANCE DUE", "TOTAL 12 ITEMS",
	// "Total ( 7 items )". Read on its own line, the count is not a caption at all.
	let caption = words
		.join(' ')
		.replace(/\b\d+ (ITEMS?|ARTICLES?)\b/g, '')
		.replace(/\b(ITEMS?|ARTICLES?) \d+\b/g, '')
		.replace(/^\d+ /, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (/^(\d+|ITEMS?|ARTICLES?)( (\d+|ITEMS?|ARTICLES?))*$/.test(caption)) caption = '';
	return {
		caption,
		captionTokens: tokens.filter((t) => /[a-z]/i.test(t.text)),
		amount
	};
}

/**
 * The slope of the paper: the median slope of the longer lines. A short word ("Change") gives a
 * poor estimate of its own.
 */
function paperAngle(rows: Row[]): number {
	const long = rows.filter((r) => chars(r) >= 8);
	const angles = (long.length ? long : rows).map((r) => r.angle).sort((a, b) => a - b);
	return angles.length ? angles[Math.floor(angles.length / 2)] : 0;
}

const chars = (row: Row) => row.text.replace(/\s/g, '').length;

/**
 * The slope of the line joining a caption on the left to an amount on the right, first guess. A
 * receipt shot at an angle is not tilted evenly: perspective slopes the captions one way and the
 * amounts another, and the line joining them follows roughly the average of the two. A short
 * word's own slope is unreliable, so it leans on the paper's.
 */
function guessSlope(caption: Row, amount: Row, paper: number): number {
	const slope = (row: Row) => {
		const trust = Math.min(1, chars(row) / 12);
		return row.angle * trust + paper * (1 - trust);
	};
	return (slope(caption) + slope(amount)) / 2;
}

/** How far `amount` sits from the line through `caption` at `angle`, in text heights. */
function offsetAt(caption: Row, amount: Row, angle: number): number {
	const offset = amount.cy - yAt({ cx: caption.cx, cy: caption.cy, angle }, amount.cx);
	return Math.abs(offset) / Math.min(caption.height, amount.height);
}

/** Which amount row each caption row is printed beside, by row index. */
type Pairing = Map<number, number>;

/**
 * Pairs caption rows with the amount rows printed beside them (receipts are tabulated, amounts
 * flush right). Each pairing must be mutual: no other caption lines up better with the amount.
 */
function pairRows(
	rows: Row[],
	pieces: Piece[],
	slopeFor: (caption: Row, amount: Row) => number,
	tolerance: number
): Pairing {
	const captions = rows.map((_, i) => i).filter((i) => pieces[i].caption !== '');
	const amounts = rows.map((_, i) => i).filter((i) => pieces[i].caption === '' && pieces[i].amount);
	const fits = (c: number, a: number) => {
		const caption = rows[c];
		const amount = rows[a];
		if (amount.box.x0 < caption.box.x1) return Infinity;
		const ratio = Math.max(caption.height, amount.height) / Math.min(caption.height, amount.height);
		if (ratio > 1.6) return Infinity;
		return offsetAt(caption, amount, slopeFor(caption, amount));
	};
	const pairing: Pairing = new Map();
	for (const c of captions) {
		let best: { a: number; offset: number } | undefined;
		for (const a of amounts) {
			const offset = fits(c, a);
			if (offset > tolerance || (best && offset >= best.offset)) continue;
			if (captions.some((other) => other !== c && fits(other, a) < offset)) continue;
			best = { a, offset };
		}
		if (best) pairing.set(c, best.a);
	}
	return pairing;
}

/**
 * Pairs in two passes. The first, on a guessed slope with a tight tolerance, pairs most item
 * lines; the slopes those pairs actually have then give the local slope for the second pass.
 */
function pairLocally(rows: Row[], pieces: Piece[], paper: number): Pairing {
	const first = pairRows(rows, pieces, (c, a) => guessSlope(c, a, paper), 0.35);
	const seen = [...first].map(([c, a]) => ({
		y: rows[c].cy,
		angle: Math.atan2(rows[a].cy - rows[c].cy, rows[a].cx - rows[c].cx)
	}));
	if (seen.length < 2) return pairRows(rows, pieces, (c, a) => guessSlope(c, a, paper), 0.5);
	const localSlope = (caption: Row) => {
		const near = [...seen]
			.sort((p, q) => Math.abs(p.y - caption.cy) - Math.abs(q.y - caption.cy))
			.slice(0, 5);
		const angles = near.map((p) => p.angle).sort((a, b) => a - b);
		return angles[Math.floor(angles.length / 2)];
	};
	return pairRows(rows, pieces, (c) => localSlope(c), 0.5);
}

const DEGREE = Math.PI / 180;

/**
 * Every plausible way to pair the receipt's lines. A curled receipt shifts the amount column up
 * or down against the captions, so the slope joining them can differ from any word's own slope
 * by several degrees, and a wrong guess pairs each caption with the next line's amount. Each
 * slope that pairs nearly as many lines as the best is kept; the arithmetic of the payment lines
 * then tells them apart.
 */
function pairings(rows: Row[], pieces: Piece[]): Pairing[] {
	const paper = paperAngle(rows);
	const found: Pairing[] = [pairLocally(rows, pieces, paper)];
	// A line printed in a larger type (a total) can have its amount sit most of a line off the
	// caption's. Pairing that loosely is only believed when the payment lines confirm it.
	const loose = pairRows(rows, pieces, (c, a) => guessSlope(c, a, paper), 1);
	if (!same(found[0], loose)) found.push(loose);
	const sweep: Pairing[] = [];
	for (let step = -40; step <= 40; step++) {
		const angle = paper + step * 0.25 * DEGREE;
		sweep.push(pairRows(rows, pieces, () => angle, 0.3));
	}
	const most = Math.max(...sweep.map((p) => p.size));
	sweep.forEach((pairing, i) => {
		const peak =
			pairing.size >= 0.75 * most &&
			pairing.size >= (sweep[i - 1]?.size ?? 0) &&
			pairing.size >= (sweep[i + 1]?.size ?? 0);
		if (peak && !found.some((p) => same(p, pairing))) found.push(pairing);
	});
	return found;
}

const same = (a: Pairing, b: Pairing) =>
	a.size === b.size && [...a].every(([c, amount]) => b.get(c) === amount);

function tenderOf(caption: string): Tender | undefined {
	if (CHANGE_CAPTIONS.has(caption)) return 'change';
	if (CASHBACK_CAPTIONS.has(caption)) return 'cashback';
	const words = caption.split(' ');
	// A masked card number ("************1234") may sit on the line.
	const named = words.filter((w) => !/^\d+$/.test(w));
	if (named.length && named.every((w) => PAID_WORDS.has(w))) return 'paid';
	return undefined;
}

interface Candidate {
	minor: number;
	confidence: number;
}

interface Judgement {
	reading: ReceiptReading;
	/** Every total the pairing found, to tell whether the pairings agree. */
	totals: Set<number>;
	hasPaid: boolean;
}

/** What one pairing of the lines says the total is. */
function judge(rows: Row[], pieces: Piece[], pairing: Pairing): Judgement {
	const totals: Candidate[] = [];
	const tenders: { kind: Tender; minor: number }[] = [];
	rows.forEach((_, i) => {
		const piece = pieces[i];
		if (!piece.caption) return;
		const beside = pairing.get(i);
		const amount = piece.amount ?? (beside === undefined ? undefined : pieces[beside].amount);
		if (!amount) return;
		if (TOTAL_CAPTIONS.has(piece.caption)) {
			const confidence = Math.min(
				amount.token.confidence,
				...piece.captionTokens.map((t) => t.confidence)
			);
			totals.push({ minor: amount.minor, confidence });
			return;
		}
		const kind = tenderOf(piece.caption);
		if (kind) tenders.push({ kind, minor: amount.minor });
	});

	const values = new Set(totals.map((t) => t.minor));
	const hasPaid = tenders.some((t) => t.kind === 'paid');
	const empty = (confidence: number) => ({
		reading: { confidence, confirmedByPayment: false },
		totals: values,
		hasPaid
	});
	if (totals.length === 0) return empty(0);

	const paid = tenders.reduce((sum, t) => sum + (t.kind === 'paid' ? t.minor : -t.minor), 0);
	const confirmed = totals.filter((t) => hasPaid && t.minor === paid);
	if (confirmed.length) {
		const confidence = Math.max(...confirmed.map((t) => t.confidence));
		return {
			reading: {
				totalMinor: confidence >= MIN_CONFIDENCE.confirmed ? confirmed[0].minor : undefined,
				confidence,
				confirmedByPayment: true
			},
			totals: values,
			hasPaid
		};
	}

	// Several different totals (before and after a coupon, or one misread) with no payment to
	// settle it, or payments that add up to something else (a misread, or a voucher we cannot
	// read): better to ask than to guess.
	const confidence = Math.min(...totals.map((t) => t.confidence));
	if (values.size > 1 || hasPaid) return empty(confidence);
	return {
		reading: {
			totalMinor: confidence >= MIN_CONFIDENCE.alone ? totals[0].minor : undefined,
			confidence,
			confirmedByPayment: false
		},
		totals: values,
		hasPaid
	};
}

export function parseReceipt(lines: TextLine[]): ReceiptReading {
	const rows = buildRows(lines);
	const pieces = rows.map(split);
	const judgements = pairings(rows, pieces).map((pairing) => judge(rows, pieces, pairing));

	// A total the payments confirm, provided no other pairing confirms a different one.
	const confirmed = judgements.filter(
		(j) => j.reading.confirmedByPayment && j.reading.totalMinor !== undefined
	);
	if (confirmed.length) {
		const values = new Set(confirmed.map((j) => j.reading.totalMinor));
		if (values.size === 1) {
			return confirmed.reduce((a, b) => (b.reading.confidence > a.reading.confidence ? b : a))
				.reading;
		}
		return { confidence: 0, confirmedByPayment: false };
	}

	// A total nothing confirms is only taken when every pairing reads the same one: otherwise
	// the photo is too skewed to tell which amount is on the total's line.
	const [first] = judgements;
	const seen = new Set(judgements.flatMap((j) => [...j.totals]));
	if (seen.size === 1 && !judgements.some((j) => j.hasPaid)) return first.reading;
	return { confidence: first.reading.confidence, confirmedByPayment: false };
}
