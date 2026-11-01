// All amounts are integer pence ("minor units") and tax rates are integer basis points
// (2000 = 20%), so every calculation stays in exact integer arithmetic.

export const DEFAULT_VAT_BPS = 2000;
const BPS_SCALE = 10_000;

export type TotalMode = 'incl' | 'excl';
export type BudgetStatus = 'ok' | 'warning' | 'over';

export interface PricedLine {
	unitPriceMinor: number;
	quantity: number;
	priceIncludesTax: boolean;
}

export interface LineTotals {
	inclMinor: number;
	exclMinor: number;
}

export interface TripTotals extends LineTotals {
	taxMinor: number;
	itemCount: number;
}

/** n ÷ d rounded to the nearest integer, halves rounded up. Both must be non-negative integers. */
function divideRoundHalfUp(n: number, d: number): number {
	return Math.floor((2 * n + d) / (2 * d));
}

/**
 * Line totals with and without VAT. The entered figure is exact; the other one is derived
 * from it and rounded to the nearest penny, half up.
 */
export function lineTotals(line: PricedLine, taxRateBps: number): LineTotals {
	const entered = line.unitPriceMinor * line.quantity;
	if (line.priceIncludesTax) {
		return {
			inclMinor: entered,
			exclMinor: divideRoundHalfUp(entered * BPS_SCALE, BPS_SCALE + taxRateBps)
		};
	}
	return {
		inclMinor: divideRoundHalfUp(entered * (BPS_SCALE + taxRateBps), BPS_SCALE),
		exclMinor: entered
	};
}

/** Each line is rounded on its own, then the lines are summed. */
export function tripTotals(lines: PricedLine[], taxRateBps: number): TripTotals {
	let inclMinor = 0;
	let exclMinor = 0;
	let itemCount = 0;
	for (const line of lines) {
		const totals = lineTotals(line, taxRateBps);
		inclMinor += totals.inclMinor;
		exclMinor += totals.exclMinor;
		itemCount += line.quantity;
	}
	return { inclMinor, exclMinor, taxMinor: inclMinor - exclMinor, itemCount };
}

/** A discount off the whole trolley: pence off (`amount`) or basis points of the total (`percent`). */
export interface Discount {
	kind: 'amount' | 'percent';
	value: number;
}

export interface DiscountedTotals extends TripTotals {
	/** What was taken off the total incl. VAT. */
	discountMinor: number;
	/** The total incl. VAT before the discount. */
	beforeMinor: number;
}

/**
 * Takes a discount off a trolley's totals. It comes off what is paid (incl. VAT) and can never
 * take it below £0. The VAT falls in proportion, so the total excl. VAT is the same share of the
 * new total as it was of the old one.
 */
export function applyDiscount(
	totals: TripTotals,
	discount: Discount | undefined
): DiscountedTotals {
	const before = totals.inclMinor;
	const wanted = !discount
		? 0
		: discount.kind === 'amount'
			? discount.value
			: divideRoundHalfUp(before * discount.value, BPS_SCALE);
	const discountMinor = Math.min(wanted, before);
	const inclMinor = before - discountMinor;
	const exclMinor = before === 0 ? 0 : divideRoundHalfUp(totals.exclMinor * inclMinor, before);
	return {
		inclMinor,
		exclMinor,
		taxMinor: inclMinor - exclMinor,
		itemCount: totals.itemCount,
		discountMinor,
		beforeMinor: before
	};
}

export function headlineTotal(totals: LineTotals, mode: TotalMode): number {
	return mode === 'incl' ? totals.inclMinor : totals.exclMinor;
}

/** Amber from 90% of the budget, red once the budget is exceeded. */
export function budgetStatus(spentMinor: number, budgetMinor: number): BudgetStatus {
	if (spentMinor > budgetMinor) return 'over';
	if (spentMinor * 10 >= budgetMinor * 9) return 'warning';
	return 'ok';
}

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function formatGBP(minor: number): string {
	return gbp.format(minor / 100);
}

/** Parses "1.5", "£1.50" or "1,234.50" into pence; null when it is not a valid amount. */
export function parsePounds(input: string): number | null {
	const cleaned = input.trim().replace(/^£/, '').replace(/,/g, '');
	const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
	if (!match || (match[1] === '' && match[2] === undefined)) return null;
	const pounds = Number(match[1] || '0');
	const pence = Number((match[2] ?? '').padEnd(2, '0'));
	return pounds * 100 + pence;
}

/** Pence as an editable input value, e.g. 150 → "1.50". */
export function minorToInput(minor: number): string {
	return (minor / 100).toFixed(2);
}

/** Parses a percentage such as "20" or "17.5" into basis points; null outside 0–100%. */
export function parsePercent(input: string): number | null {
	const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ''));
	if (!match) return null;
	const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
	return bps <= BPS_SCALE ? bps : null;
}

/** Basis points as a percentage string without trailing zeros, e.g. 2000 → "20", 1750 → "17.5". */
export function formatPercent(bps: number): string {
	return String(bps / 100);
}
