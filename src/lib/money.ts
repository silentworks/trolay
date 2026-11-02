import { appLocale, numberSeparators } from './locale.ts';

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
	/** A multi-buy offer: every `offerQuantity` items cost `offerPriceMinor` together. */
	offerQuantity?: number;
	offerPriceMinor?: number;
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
 * What the line costs at the price as entered: the multi-buy offer for each full set of items,
 * the single price for the rest ("2 for £3.00" at quantity 5 is two offers and one single).
 */
export function enteredTotal(line: PricedLine): number {
	const { offerQuantity: n, offerPriceMinor: offer } = line;
	if (!n || n < 2 || offer === undefined || offer <= 0) return line.unitPriceMinor * line.quantity;
	// Never dearer than buying them singly, whatever was typed.
	const set = Math.min(offer, n * line.unitPriceMinor);
	return Math.floor(line.quantity / n) * set + (line.quantity % n) * line.unitPriceMinor;
}

/**
 * Line totals with and without VAT. The entered figure is exact; the other one is derived
 * from it and rounded to the nearest penny, half up.
 */
export function lineTotals(line: PricedLine, taxRateBps: number): LineTotals {
	const entered = enteredTotal(line);
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

/** A store with no currency set shows amounts in pounds, as Trolay always has. */
export const DEFAULT_CURRENCY = 'GBP';

const moneyFormats = new Map<string, Intl.NumberFormat>();

function moneyFormat(currency: string, locale: string): Intl.NumberFormat {
	const key = `${locale} ${currency}`;
	let format = moneyFormats.get(key);
	if (!format) {
		format = new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			currencyDisplay: 'narrowSymbol'
		});
		moneyFormats.set(key, format);
	}
	return format;
}

/** e.g. "£1,234.56" in en-GB, "1.234,56 €" for EUR in de-DE. */
export function formatMoney(
	minor: number,
	currency = DEFAULT_CURRENCY,
	locale = appLocale()
): string {
	return moneyFormat(currency, locale).format(minor / 100);
}

/** The symbol for a currency, e.g. "£", "€" or "$", for field labels. */
export function currencySymbol(currency = DEFAULT_CURRENCY, locale = appLocale()): string {
	const parts = moneyFormat(currency, locale).formatToParts(1);
	return parts.find((part) => part.type === 'currency')?.value ?? currency;
}

/** Spaces and apostrophes between digits group them ("1 234,50", "1'234.50") in any locale. */
const SPACE_GROUP = /(\d)[\s\u00a0\u202f'’](?=\d)/g;

/**
 * Digits grouped with `mark`: the first group 1–3 digits, the last 3, any between 2 or 3 (as in
 * India's 1,23,456). The digits alone, or null when the groups are not laid out like that.
 */
function ungroup(text: string, mark: string): string | null {
	const groups = text.split(mark);
	const [first, ...rest] = groups;
	if (!/^\d{1,3}$/.test(first)) return null;
	const last = rest.pop();
	if (last !== undefined && !/^\d{3}$/.test(last)) return null;
	if (rest.some((group) => !/^\d{2,3}$/.test(group))) return null;
	return groups.join('');
}

/**
 * Parses an amount as typed into minor units, or null when it is not one.
 *
 * A "." or "," followed by one or two digits at the end is the decimal mark in every locale, so
 * "4,50" and "4.50" are both 450. With both marks, the last is the decimal mark ("1.234,50",
 * "1,234.50"). One mark followed by three digits ("1,234") is a thousands mark only where the
 * locale groups with it; elsewhere it could be either, so it is refused rather than guessed.
 */
export function parsePounds(input: string, locale = appLocale()): number | null {
	const cleaned = input
		.trim()
		.replace(/^[£€$]\s*|\s*[£€$]$/g, '')
		.replace(SPACE_GROUP, '$1');
	const marks = cleaned.match(/[.,]/g) ?? [];
	let whole: string | null = cleaned;
	let fraction = '';
	if (marks.length) {
		const at = Math.max(cleaned.lastIndexOf('.'), cleaned.lastIndexOf(','));
		const mark = cleaned[at];
		const after = cleaned.slice(at + 1);
		const before = cleaned.slice(0, at);
		const other = marks.find((m) => m !== mark);
		const repeated = marks.filter((m) => m === mark).length > 1;
		if (other !== undefined || (!repeated && after.length <= 2)) {
			if (repeated || !/^\d{1,2}$/.test(after)) return null;
			whole = other === undefined || before === '' ? before : ungroup(before, other);
			fraction = after;
		} else if (repeated || mark === numberSeparators(locale).group) {
			whole = ungroup(cleaned, mark);
		} else {
			return null;
		}
	}
	if (whole === null || !/^\d*$/.test(whole) || (whole === '' && fraction === '')) return null;
	return Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
}

/** Minor units as an editable input value in the locale's form, e.g. 150 → "1.50" or "1,50". */
export function minorToInput(minor: number, locale = appLocale()): string {
	return (minor / 100).toFixed(2).replace('.', numberSeparators(locale).decimal);
}

/** Parses a percentage such as "20", "17.5" or "17,5" into basis points; null outside 0–100%. */
export function parsePercent(input: string): number | null {
	const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim().replace(/\s*%$/, ''));
	if (!match) return null;
	const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
	return bps <= BPS_SCALE ? bps : null;
}

/**
 * Basis points as a percentage without trailing zeros in the locale's form, e.g. 2000 → "20",
 * 1750 → "17.5" or "17,5".
 */
export function formatPercent(bps: number, locale = appLocale()): string {
	return String(bps / 100).replace('.', numberSeparators(locale).decimal);
}
