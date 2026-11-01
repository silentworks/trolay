import { isValidGtin } from '../gtin.ts';
import type { TextLine } from '../ocr/engine.ts';
import { buildRows, overlapShare, union, type Box, type Row, type Token } from './layout.ts';

export interface ReadField<T> {
	value: T;
	/** 0–1. */
	confidence: number;
}

export interface LabelReading {
	description?: ReadField<string> & {
		/** Mean character confidence of the description lines, before any threshold. */
		meanConfidence: number;
	};
	unitPriceMinor?: ReadField<number>;
	/** Absent when the label says nothing about VAT; the store's setting applies. */
	priceIncludesTax?: ReadField<boolean>;
	barcode?: ReadField<string>;
	/** "2 for £3.00": buy `quantity`, pay `totalMinor` for them (at the same VAT basis as the price). */
	multiBuy?: ReadField<{ quantity: number; totalMinor: number }>;
	/** The printed unit price, as text for showing: "£2.50 per kg", "49.8p per 100g". */
	perUnit?: ReadField<string>;
	/** How the price was confirmed by other numbers on the label, for display and debugging. */
	checks: string[];
}

/**
 * Below these a field is left empty for the shopper, never guessed. Set on the development
 * fixtures (scripts/label-calibration.ts) with a margin above the most confident wrong reading,
 * then checked on the held-out fixtures and real photos (scripts/label-accuracy.ts).
 */
export const MIN_CONFIDENCE = { price: 0.85, description: 0.85, vat: 0.9 } as const;
/**
 * A description is only as good as its weakest character: below this one doubtful letter
 * ("3OOG" for "300G") makes the whole description doubtful, however sure the rest is.
 */
const MIN_DESCRIPTION_CHAR_CONFIDENCE = 0.6;
/** Each reading in a price ÷ pack size = unit price check must be at least this sure to count. */
const MIN_CHECK_CONFIDENCE = 0.4;

/** The field's value when it is confident enough to fill in, otherwise undefined. */
export function confident<T>(field: ReadField<T> | undefined, min: number): T | undefined {
	return field && field.confidence >= min ? field.value : undefined;
}

/** What the reader fills in from a label: the values it is sure of, nothing else. */
export function filledFields(reading: LabelReading | undefined) {
	return {
		description: confident(reading?.description, MIN_CONFIDENCE.description),
		unitPriceMinor: confident(reading?.unitPriceMinor, MIN_CONFIDENCE.price),
		// VAT says what the price includes: without a price it would describe a number the
		// shopper never sees.
		priceIncludesTax:
			confident(reading?.unitPriceMinor, MIN_CONFIDENCE.price) === undefined
				? undefined
				: confident(reading?.priceIncludesTax, MIN_CONFIDENCE.vat),
		barcode: confident(reading?.barcode, MIN_CONFIDENCE.price),
		// An offer is only worth applying when the price it is measured against is sure too.
		multiBuy:
			confident(reading?.unitPriceMinor, MIN_CONFIDENCE.price) === undefined
				? undefined
				: confident(reading?.multiBuy, MIN_CONFIDENCE.price),
		perUnit: confident(reading?.perUnit, MIN_CONFIDENCE.price)
	};
}

// ---------------------------------------------------------------------------------------------
// Vocabulary

const QUANTITY_UNIT = '(?:kg|g|gm|grams?|mg|l|ltr|litres?|liters?|lt|ml|cl|pints?|pt|oz|lb)';
const PER_UNIT =
	'(?:kg|kilo|g|100\\s?g|10\\s?g|l|ltr|litre|liter|lt|ml|100\\s?ml|10\\s?ml|cl|75\\s?cl|m|metre|meter|each|ea|sheets?|rolls?|wash(?:es)?|pack|pk|pints?|pt|lb|oz|dozen|doz|units?|items?|portions?|servings?|tablets?|tabs?|capsules?|pods?|pieces?|pcs?|bags?|nappies|wipes?)';
/** What follows a unit price: "/kg", "per 100g", "per litre". */
const UNIT_SUFFIX = new RegExp(
	`^\\s*(?:/|per\\b|a\\b)\\s*(?:\\d+(?:\\.\\d+)?\\s*)?${PER_UNIT}\\b`,
	'i'
);
const EACH_SUFFIX = /^\s*(?:each|ea)\b/i;
/** A caption naming the number under it a unit price: "PRICE PER LITER", "Unit price". */
const UNIT_CAPTION = /\bper\b|\bunit\s*price\b|\bprice\s*per\b|^\s*\/\s*\w+/i;
const OLD_CONTEXT = /\b(?:was|rrp|before|previously)\b/i;
const SAVING_CONTEXT = /\b(?:save|saving|off)\b/i;
const MULTI_BUY_BEFORE = /(?:\b\d+\s*(?:for|x)|\bany\s*\d+|\bbuy\s*\d+|\b\d+\s*items?\s*for)\s*$/i;
const LOYALTY_CONTEXT =
	/\b(?:clubcard|nectar|members?|loyalty|card\s*price|lidl\s*plus|with\s*(?:your\s*)?card|my\s*waitrose|app\s*price)\b/i;
const POSITIVE_CAPTION =
	/\b(?:sell(?:ing)?\s*price|our\s*price|price|now|only|special|today|offer\s*price|deal)\b/i;
// Banner words. A row made only of these is a promotion, not a product name.
const PROMO_WORDS =
	/\b(?:special|offers?|save|half|price[sd]?|drop(?:ped)?|cuts?|multi|buy|reduced|new|rollback|deals?|great|low|lower|match(?:ed)?|clearance|best|big|bonus|hot|only|now|today|limited|edition|exclusive|sale|was|everyday|range|wow|value|lowest|promo(?:tion)?|any|for|aldi|lidl|plus|card|discount|dauer|preis|prices|dropped)\b/gi;
const isPromo = (text: string) => text.replace(PROMO_WORDS, '').replace(/[^a-z]/gi, '').length < 3;
// Printed marks that are not product text: nutrition and labelling schemes.
const LABEL_FURNITURE =
	/\b(?:[nm]u[tl]r?[ia]{1,2}[-\s]?score|score|srp|rrp|traffic\s*light|vegan|vegetarian|gluten\s*free|organic)\b/i;
// Currency words printed beside prices ("kr", "AED").
const CURRENCY_WORD = /^(?:kr|sek|nok|dkk|eur|euro|usd|aed|dhs?|gbp|chf)$/i;
const INC_VAT = /\b(?:inc|incl|including|inclusive)\b\.?\s*(?:of\s*)?vat\b/i;
const EX_VAT =
	/(?:\b(?:ex|exc|excl|excluding|exclusive)\b\.?\s*(?:of\s*)?vat\b|\+\s*vat\b|\bplus\s*vat\b)/i;
const DATE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const PACK_SIZE = new RegExp(
	`^\\s*(?:\\d+\\s*[x×]\\s*)?\\d+(?:[.,]\\d+)?\\s*(?:${QUANTITY_UNIT}|m|cm|mm|metres?|meters?|pack|pk|rolls?|sheets?|pieces?|pcs|eggs|bags|capsules|tablets|pods|washes)\\b`,
	'i'
);
// Retailer names printed on labels are not part of the product description.
const RETAILER =
	/^(?:tesco|sainsbury'?s|asda|morrisons|aldi|lidl|co-?op|waitrose|iceland|m\s*&\s*s|marks\s*&\s*spencer|costco|booker|makro|spar|ocado|farmfoods|home\s*bargains|b\s*&\s*m|delhaize|kirkland\s*signature)$/i;

const strip = (s: string) => s.replace(/^[^\w£€$]+|[^\w%]+$/g, '');

// ---------------------------------------------------------------------------------------------
// Money

type Kind = 'price' | 'each' | 'unit' | 'old' | 'multibuy' | 'saving' | 'loyalty';

interface Money {
	minor: number;
	tokens: Token[];
	box: Box;
	height: number;
	confidence: number;
	currency: boolean;
	row: Row;
	kind: Kind;
	/** A small caption above or beside it that names it the selling price. */
	captioned: boolean;
	/**
	 * Other values the same digits could mean. "149" beside a £ may be £149 or £1⁴⁹ with the
	 * raised pence merged in; only the printed unit price can settle it.
	 */
	alternatives?: number[];
	/** For a multi-buy price: how many it is for ("2" in "2 for £3"). */
	offerQuantity?: number;
}

interface PlainNumber {
	value: number;
	decimals: number;
	pence: boolean;
}

/** "19.99", "£1.45", "€4,867", "9.995", "16.9p" → value in pounds. */
function parseNumber(text: string): (PlainNumber & { currency: boolean }) | undefined {
	const t = strip(text);
	const pence = /^(\d{1,3}(?:[.,]\d)?)p$/i.exec(t);
	if (pence) {
		const value = Number(pence[1].replace(',', '.')) / 100;
		return {
			value,
			decimals: pence[1].includes('.') || pence[1].includes(',') ? 3 : 2,
			pence: true,
			currency: true
		};
	}
	// "4,867" without a currency sign is a decimal comma (European unit prices); "£1,299" or
	// "1,299.00" uses the comma for thousands.
	const thousands = /^[£€$]/.test(t) || /,\d{3}\./.test(t) || /,\d{3},/.test(t);
	const m = thousands
		? /^([£€$])?(\d{1,3}(?:,\d{3})+|\d{1,5})(?:[.](\d{1,3}))?$/.exec(t)
		: /^([£€$])?(\d{1,5})(?:[.,](\d{1,3}))?$/.exec(t);
	if (!m) return undefined;
	const whole = Number(m[2].replace(/,/g, ''));
	const fraction = m[3] ?? '';
	return {
		value: whole + (fraction ? Number(fraction) / 10 ** fraction.length : 0),
		decimals: fraction.length,
		pence: false,
		currency: Boolean(m[1])
	};
}

/** The text of a row before and after a run of its tokens. */
function context(row: Row, first: number, last: number) {
	return {
		before: row.tokens
			.slice(0, first)
			.map((t) => t.text)
			.join(' '),
		after: row.tokens
			.slice(last + 1)
			.map((t) => t.text)
			.join(' ')
	};
}

const isMoneyText = (text: string) => {
	const n = parseNumber(text);
	return Boolean(n && (n.decimals === 2 || n.pence || n.currency));
};

function rowHasMoney(row: Row): boolean {
	return row.tokens.some((t) => isMoneyText(t.text));
}

/** Small text above (or just left of) a box, read as its caption. */
function captionsFor(box: Box, height: number, rows: Row[], self: Row): Row[] {
	return rows.filter((r) => {
		if (r === self || r.height > height * 0.9 || rowHasMoney(r)) return false;
		const above =
			r.box.y1 <= box.y0 + 0.35 * height &&
			box.y0 - r.box.y1 <= Math.max(1.5 * r.height, 0.25 * height) &&
			(overlapShare(r.box.x0, r.box.x1, box.x0, box.x1) > 0 ||
				Math.abs((r.box.x0 + r.box.x1) / 2 - (box.x0 + box.x1) / 2) < height);
		const left =
			r.box.x1 <= box.x0 + 0.1 * height &&
			box.x0 - r.box.x1 <= height &&
			overlapShare(r.box.y0, r.box.y1, box.y0, box.y1) > 0.3;
		return above || left;
	});
}

/** Small text right next to (or just under) a box: "per kg", "each", "ex VAT". */
function suffixesFor(box: Box, height: number, rows: Row[], self: Row): Row[] {
	return rows.filter((r) => {
		if (r === self || r.height > height * 0.9 || rowHasMoney(r)) return false;
		const right =
			r.box.x0 >= box.x1 - 0.2 * height &&
			r.box.x0 - box.x1 <= 0.8 * height &&
			overlapShare(r.box.y0, r.box.y1, box.y0, box.y1) > 0.2;
		const below =
			r.box.y0 >= box.y1 - 0.3 * height &&
			r.box.y0 - box.y1 <= 0.5 * height &&
			overlapShare(r.box.x0, r.box.x1, box.x0, box.x1) > 0.3;
		return right || below;
	});
}

/** How many items a multi-buy price is for: "2 for", "any 3 for", "buy 2", "for 2". */
function offerQuantityIn(before: string[], after: string): number | undefined {
	for (const text of before) {
		const m =
			/\b(\d{1,2})\s*(?:for|x)\s*$/i.exec(text) ??
			/\b(\d{1,2})\s*items?\s*for\s*$/i.exec(text) ??
			/\bany\s*(\d{1,2})\b/i.exec(text) ??
			/\bbuy\s*(\d{1,2})\b/i.exec(text);
		if (m) return Number(m[1]);
	}
	const m = /^\s*(?:for|when\s*you\s*buy)\s*(\d{1,2})\b/i.exec(after);
	return m ? Number(m[1]) : undefined;
}

function classify(
	money: Omit<Money, 'kind' | 'captioned'>,
	rows: Row[],
	first: number,
	last: number
) {
	const { before, after } = context(money.row, first, last);
	const captions = captionsFor(money.box, money.height, rows, money.row).map((r) => r.text);
	const suffixes = suffixesFor(money.box, money.height, rows, money.row).map((r) => r.text);
	const nearby = [...captions, before];
	let kind: Kind = 'price';
	let offerQuantity: number | undefined;
	if (OLD_CONTEXT.test(before) || captions.some((c) => OLD_CONTEXT.test(c))) kind = 'old';
	else if (MULTI_BUY_BEFORE.test(before) || /^\s*(?:for\s*\d|when you buy)/i.test(after)) {
		kind = 'multibuy';
		offerQuantity = offerQuantityIn(nearby, after);
	} else if (SAVING_CONTEXT.test(before) || /^\s*off\b/i.test(after)) kind = 'saving';
	else if (
		UNIT_SUFFIX.test(after) ||
		suffixes.some((s) => UNIT_SUFFIX.test(' ' + s) || /^\s*per\b/i.test(s))
	)
		kind = 'unit';
	else if (captions.some((c) => UNIT_CAPTION.test(c)) || UNIT_CAPTION.test(before)) kind = 'unit';
	else if (nearby.some((c) => LOYALTY_CONTEXT.test(c))) kind = 'loyalty';
	else if (EACH_SUFFIX.test(after) || suffixes.some((s) => EACH_SUFFIX.test(s))) kind = 'each';
	const captioned = nearby.some((c) => POSITIVE_CAPTION.test(c) && !UNIT_CAPTION.test(c));
	return { kind, captioned, offerQuantity };
}

const CURRENCY_SIGN = /^[£€$]$/;
// A "$" or "£" printed big beside the price is sometimes read as a letter.
const CURRENCY_LOOKALIKE = /^[£€$Ss£fE]$/;
const charWidth = (row: Row) =>
	(row.box.x1 - row.box.x0) / Math.max(1, row.text.replace(/\s/g, '').length);

/** A lone currency sign (or its look-alike, if big) just left of a box, or one above it. */
function currencyBeside(box: Box, height: number, rows: Row[]): boolean {
	return rows.some((r) => {
		const text = r.text.trim();
		const left =
			r.box.x1 <= box.x0 + 0.3 * height &&
			box.x0 - r.box.x1 <= 0.6 * height &&
			overlapShare(r.box.y0, r.box.y1, box.y0, box.y1) > 0.3;
		const near = Math.abs(r.box.x0 - box.x1) < height && Math.abs(r.box.y0 - box.y0) < height * 1.3;
		return (
			(CURRENCY_SIGN.test(text) && (left || near)) ||
			(CURRENCY_LOOKALIKE.test(text) && left && r.height >= 0.4 * height)
		);
	});
}

/** A line of several separate numbers ("2 20 14 13 1 ZE", "330384 0439") is a code, not a price. */
const isCodeLine = (row: Row) =>
	row.tokens.filter((t) => /^\d[\d.,]*$/.test(strip(t.text))).length >= 3;

function findMoney(rows: Row[]): Money[] {
	const found: Money[] = [];
	const used = new Set<Token>();
	const add = (base: Omit<Money, 'kind' | 'captioned'>, first: number, last: number) => {
		found.push({ ...base, ...classify(base, rows, first, last) });
		base.tokens.forEach((t) => used.add(t));
	};

	// Prices printed with small raised pence beside a big number ("1⁴⁶", "2⁰⁹ €") come out as
	// two lines. Join them when the small one sits top-right of the big one and is visibly
	// smaller: by height, by character width, or by sitting higher.
	for (const big of rows) {
		if (big.tokens.length !== 1) continue;
		const whole = /^([£€$])?(\d{1,4})$/.exec(strip(big.tokens[0].text));
		if (!whole) continue;
		const pence = rows.find((r) => {
			if (r === big || r.tokens.length !== 1 || !/^\d{2}$/.test(strip(r.tokens[0].text)))
				return false;
			const adjacent =
				r.box.x0 >= big.box.x1 - 0.25 * big.height && r.box.x0 - big.box.x1 <= 0.6 * big.height;
			// Level with the big number's top, or clearly raised against it (the big number's box can
			// come out short when its glyph is a plain bar, like "1").
			const topAligned = Math.abs(r.box.y0 - big.box.y0) <= 0.35 * big.height;
			const raised =
				(r.box.y0 + r.box.y1) / 2 < (big.box.y0 + big.box.y1) / 2 &&
				r.box.y1 < big.box.y1 - 0.1 * big.height &&
				r.box.y0 >= big.box.y0 - 0.8 * big.height;
			const smaller =
				r.height <= 0.75 * big.height ||
				charWidth(r) <= 0.8 * charWidth(big) ||
				(r.box.y0 + r.box.y1) / 2 < (big.box.y0 + big.box.y1) / 2 - 0.1 * big.height;
			return adjacent && (topAligned || raised) && smaller;
		});
		if (!pence) continue;
		const box = union(big.box, pence.box);
		add(
			{
				minor: Number(whole[2]) * 100 + Number(strip(pence.tokens[0].text)),
				tokens: [big.tokens[0], pence.tokens[0]],
				box,
				height: big.height,
				confidence: Math.min(big.tokens[0].confidence, pence.tokens[0].confidence),
				currency: Boolean(whole[1]) || currencyBeside(box, big.height, rows),
				row: big
			},
			0,
			0
		);
	}

	for (const row of rows) {
		if (isCodeLine(row)) continue;
		row.tokens.forEach((token, i) => {
			if (used.has(token)) return;
			const text = strip(token.text);
			let first = i;
			let n = parseNumber(text);
			if (!n) return;
			let currency = n.currency;
			// "£ 1.45": a currency sign read as its own word.
			if (i > 0 && CURRENCY_SIGN.test(strip(row.tokens[i - 1].text))) {
				currency = true;
				first = i - 1;
			}
			// Pence read as a separate word: "£1 45", or small raised pence "1 ⁴⁶" on the same line.
			let last = i;
			const next = row.tokens[i + 1];
			if (n.decimals === 0 && !n.pence && next && /^\d{2}$/.test(strip(next.text))) {
				const width = (t: Token) => (t.box.x1 - t.box.x0) / Math.max(1, strip(t.text).length);
				const raised =
					Math.abs(next.box.y0 - token.box.y0) <= 0.35 * token.height &&
					next.box.x0 - token.box.x1 <= 0.6 * token.height &&
					(width(next) <= 0.8 * width(token) ||
						next.box.y1 - next.box.y0 <= 0.75 * (token.box.y1 - token.box.y0));
				if (currency || raised) {
					n = { ...n, value: n.value + Number(strip(next.text)) / 100, decimals: 2 };
					last = i + 1;
				}
			}
			const tokens = row.tokens.slice(first, last + 1);
			const box = tokens.map((t) => t.box).reduce(union);
			const { after } = context(row, first, last);
			// A whole number is money only with a currency sign beside it ("$11 ea", "£5"), and
			// never right of bigger text that could not be read: then it is probably the raised
			// pence of a price whose pounds were misread ("L⁷⁵" for "1⁷⁵").
			if (n.decimals === 0 && !n.pence) {
				if (!currency && row.tokens.length === 1)
					currency = currencyBeside(box, token.height, rows);
				const unreadLeft = rows.some(
					(r) =>
						r !== row &&
						r.height >= token.height &&
						!r.tokens.some((t) => parseNumber(t.text)) &&
						!CURRENCY_LOOKALIKE.test(r.text.trim()) &&
						r.box.x1 >= box.x0 - 0.8 * token.height &&
						r.box.x1 <= box.x0 + 0.3 * token.height &&
						overlapShare(r.box.y0, r.box.y1, box.y0, box.y1) > 0.3
				);
				if (unreadLeft) return;
			}
			const money = n.pence || n.decimals === 2 || (currency && n.decimals === 0);
			if (!money) return;
			// "1.50 L" or "2.27 kg" is a quantity, not money.
			if (!currency && new RegExp(`^\\s*${QUANTITY_UNIT}\\b`, 'i').test(after)) return;
			if (/^\s*%/.test(after) || text.endsWith('%')) return;
			if (n.pence && /[.,]/.test(text)) return; // "16.9p": only ever a unit price.
			let minor = Math.round(n.value * 100);
			let alternatives: number[] | undefined;
			let confidence = Math.min(...tokens.map((t) => t.confidence));
			const digits = strip(token.text).replace(/^[£€$]/, '');
			if (n.decimals === 0 && !n.pence) {
				if (/^0\d{2}$/.test(digits)) {
					// "£0⁸⁹" read as one word: pence.
					minor = Number(digits);
					confidence *= 0.95;
				} else if (digits.length >= 3) {
					alternatives = [Number(digits)];
				}
			}
			add(
				{ minor, tokens, box, height: token.height, confidence, currency, row, alternatives },
				first,
				last
			);
		});
	}
	return found;
}

/** Big text with digits that was not read as any money: probably the price, misread. */
function unreadBigDigits(rows: Row[], money: Money[], than: number): boolean {
	const moneyRows = new Set(money.map((m) => m.row));
	return rows.some(
		(r) =>
			!moneyRows.has(r) &&
			// Below this it is noise (a logo read as a digit), not evidence of a hidden price.
			r.confidence >= 0.4 &&
			/\d/.test(r.text) &&
			!isCodeLine(r) &&
			!/^\d{6,}$/.test(r.text.replace(/\s/g, '')) &&
			r.height >= 1.5 * than
	);
}

// ---------------------------------------------------------------------------------------------
// Cross-checks: independent numbers on the label that must agree with the price.

interface PackSize {
	/** Total quantity in base units: grams, millilitres or items. */
	amount: number;
	dimension: 'mass' | 'volume' | 'count';
	/** For counts, what is counted: "item" for each/pack, otherwise "roll", "sheet"… */
	item?: string;
}

/** The thing a count counts, so "per 100 sheets" is never compared with "24 pack". */
function countedItem(word: string): string {
	const w = word.toLowerCase();
	if (/^(?:each|ea|units?|items?|pack|pk|x)$/.test(w)) return 'item';
	return w.replace(/(?:es|s)$/, '');
}

const COUNT_UNIT =
	'(?:each|ea|units?|items?|rolls?|sheets?|bars?|pods?|cans?|bottles?|tins?|tablets?|tabs?|capsules?|washes|wash|pieces?|pcs?|pouches|pouch|bags?|eggs?|nappies|wipes?|portions?|servings?)';

const MASS: Record<string, number> = {
	kg: 1000,
	g: 1,
	gm: 1,
	gram: 1,
	grams: 1,
	oz: 28.3495,
	lb: 453.592
};
const VOLUME: Record<string, number> = {
	l: 1000,
	ltr: 1000,
	litre: 1000,
	litres: 1000,
	liter: 1000,
	liters: 1000,
	lt: 1000,
	ml: 1,
	cl: 10,
	pint: 568.261,
	pints: 568.261,
	pt: 568.261
};

function unitSize(unit: string): PackSize | undefined {
	const u = unit.toLowerCase().replace(/\s/g, '');
	const m = /^(\d+)?([a-z]+)$/.exec(u);
	if (!m) return undefined;
	const count = m[1] ? Number(m[1]) : 1;
	if (!count) return undefined; // "per 00g": a misread, not a unit.
	if (m[2] in MASS) return { amount: count * MASS[m[2]], dimension: 'mass' };
	if (m[2] in VOLUME) return { amount: count * VOLUME[m[2]], dimension: 'volume' };
	if (new RegExp(`^${COUNT_UNIT}$`).test(m[2])) {
		return { amount: count, dimension: 'count', item: countedItem(m[2]) };
	}
	return undefined;
}

/** "2 L", "4 x 415g", "2.272L 4 Pints", "1kg" → the pack's total quantity. */
export function packSize(text: string): PackSize | undefined {
	return packSizes(text).find((p) => p.dimension !== 'count');
}

/** Every quantity the description states: weight or volume, and a count ("6 Pack", "4 x 415g"). */
export function packSizes(text: string): PackSize[] {
	const found: PackSize[] = [];
	const measure =
		/(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|gm|ml|cl|l|ltr|litres?|liters?|lt|pints?|pt|oz|lb)\b/gi;
	for (const m of text.matchAll(measure)) {
		const unit = unitSize(m[3]);
		if (!unit) continue;
		const amount = (m[1] ? Number(m[1]) : 1) * Number(m[2].replace(',', '.')) * unit.amount;
		if (amount > 0) {
			found.push({ amount, dimension: unit.dimension });
			if (m[1]) found.push({ amount: Number(m[1]), dimension: 'count', item: 'item' });
			break;
		}
	}
	const count = new RegExp(`\\b(\\d+)\\s*(pack|pk|${COUNT_UNIT})\\b`, 'i').exec(text);
	if (count && Number(count[1]) > 0 && !found.some((p) => p.dimension === 'count')) {
		found.push({ amount: Number(count[1]), dimension: 'count', item: countedItem(count[2]) });
	}
	return found;
}

interface UnitPrice {
	/** Where it is printed: a price can never confirm itself. */
	token: Token;
	/** Pounds per `per` base units. */
	value: number;
	/** Half a unit of the last printed digit, in pounds. */
	tolerance: number;
	per: PackSize;
	confidence: number;
	/** The unit as printed, for showing: "kg", "100g", "each". */
	unit: string;
	/** The printed price in pence with the digits it was printed to, for showing. */
	display: string;
}

/** Unit prices printed on the label: "64p per litre", "£9.96 per kg", "PRICE PER LITER 9.995". */
function findUnitPrices(rows: Row[]): UnitPrice[] {
	const found: UnitPrice[] = [];
	for (const row of rows) {
		row.tokens.forEach((token, i) => {
			const n = parseNumber(token.text);
			if (!n || (n.decimals === 0 && !n.currency && !n.pence)) return;
			const after = context(row, i, i).after;
			// "/kg", "per 100g", or a plain "each" ("33p each").
			let unitText =
				new RegExp(`^\\s*(?:/|per|a)\\s*(\\d*\\s*[a-z]+)`, 'i').exec(after)?.[1] ??
				/^\s*(each|ea)\b/i.exec(after)?.[1];
			if (!unitText) {
				// The unit may be in a caption above: "PRICE PER LITER" over "9.995".
				const caption = captionsFor(token.box, token.height, rows, row)
					.map((r) => r.text)
					.find((c) => /\bper\b/i.test(c));
				unitText = caption && /\bper\s*(\d*\s*[a-z]+)/i.exec(caption)?.[1];
			}
			const per = unitText && unitSize(unitText);
			if (!per) return;
			const step = n.pence ? 10 ** -n.decimals : 10 ** -n.decimals;
			found.push({
				token,
				value: n.value,
				tolerance: step / 2 + 1e-9,
				per,
				confidence: token.confidence,
				unit: unitText!.replace(/\s+/g, '').toLowerCase(),
				display: n.pence
					? `${Number((n.value * 100).toFixed(2))}p`
					: `£${n.value.toFixed(Math.max(2, n.decimals))}`
			});
		});
	}
	return found;
}

// ---------------------------------------------------------------------------------------------
// Fields

function pickPrice(
	rows: Row[],
	money: Money[],
	unitPrices: UnitPrice[],
	packs: PackSize[],
	checks: string[]
): { field: ReadField<number>; money: Money } | undefined {
	const prices = money.filter((m) => m.kind === 'price');
	const pool = prices.length
		? prices
		: money.filter((m) => m.kind === 'each').length
			? money.filter((m) => m.kind === 'each')
			: money.filter((m) => m.kind === 'loyalty');
	if (!pool.length) return undefined;

	const ranked = [...pool].sort(
		(a, b) =>
			b.height - a.height ||
			Number(b.captioned) - Number(a.captioned) ||
			Number(b.currency) - Number(a.currency)
	);
	const chosen = ranked[0];
	let confidence = chosen.confidence;
	if (!prices.length) confidence *= pool[0].kind === 'each' ? 0.97 : 0.85;

	// Another price of a similar size with a different value: which is the item price?
	const rival = ranked.find((m) => m.minor !== chosen.minor && m.height >= chosen.height * 0.8);
	if (rival) confidence *= chosen.captioned && !rival.captioned ? 0.9 : 0.5;
	if (unreadBigDigits(rows, money, chosen.height)) {
		confidence *= 0.5;
		checks.push('bigger text with digits could not be read');
	}

	// Price ÷ pack size should give the printed unit price, to the precision it is printed.
	const independent = unitPrices.filter((u) => !chosen.tokens.includes(u.token));
	const pairs = independent.flatMap((unit) =>
		packs
			.filter((p) => p.dimension === unit.per.dimension && p.item === unit.per.item)
			.map((pack) => ({ unit, pack }))
	);
	const expectedUnit = (minor: number, { unit, pack }: (typeof pairs)[number]) =>
		(minor / 100) * (unit.per.amount / pack.amount);
	const agrees = (minor: number) =>
		pairs.find(
			(pair) =>
				Math.abs(expectedUnit(minor, pair) - pair.unit.value) <=
				pair.unit.tolerance + 0.005 * pair.unit.value
		)?.unit;
	let value = chosen.minor;
	if (chosen.alternatives) {
		// Ambiguous digits are only accepted when the unit price says which reading is right.
		const settled = [chosen.minor, ...chosen.alternatives].find((minor) => agrees(minor));
		if (settled === undefined)
			return { field: { value, confidence: confidence * 0.3 }, money: chosen };
		value = settled;
	}
	const unit = agrees(value);
	if (unit) {
		// Two numbers read from separate parts of the label agreeing to the printed precision is
		// strong evidence, even when each reading alone was doubtful.
		if (Math.min(chosen.confidence, unit.confidence) >= MIN_CHECK_CONFIDENCE)
			confidence = Math.max(confidence, 0.99);
		checks.push('price matches the unit price and pack size');
	} else if (
		pairs.some(
			(pair) =>
				Math.abs(expectedUnit(value, pair) - pair.unit.value) > 0.05 * pair.unit.value &&
				pair.unit.confidence >= 0.9
		)
	) {
		confidence *= 0.6;
		checks.push('price does not match the unit price and pack size');
	}
	return { field: { value, confidence }, money: chosen };
}

/**
 * "2 for £3.00": the offer total for a number of items. It has to be a real saving against the
 * single price (less than buying that many singly, more than buying one), and every offer on the
 * label has to say the same, or it is left for the shopper.
 */
function pickMultiBuy(
	money: Money[],
	price: ReadField<number> | undefined
): LabelReading['multiBuy'] {
	if (!price) return undefined;
	const offers = money.filter(
		(m) =>
			m.kind === 'multibuy' &&
			m.offerQuantity !== undefined &&
			m.offerQuantity >= 2 &&
			m.offerQuantity <= 24 &&
			m.minor > price.value &&
			m.minor < m.offerQuantity * price.value
	);
	if (!offers.length) return undefined;
	const same = (a: Money, b: Money) => a.offerQuantity === b.offerQuantity && a.minor === b.minor;
	if (offers.some((o) => !same(o, offers[0]))) return undefined;
	const best = offers.reduce((a, b) => (b.confidence > a.confidence ? b : a));
	return {
		value: { quantity: best.offerQuantity!, totalMinor: best.minor },
		confidence: Math.min(best.confidence, price.confidence)
	};
}

/** The unit price printed on the label other than the one the price was read from. */
function pickPerUnit(unitPrices: UnitPrice[], price: Money | undefined): LabelReading['perUnit'] {
	const best = unitPrices
		.filter((u) => !price?.tokens.includes(u.token))
		.sort((a, b) => b.confidence - a.confidence)[0];
	if (!best) return undefined;
	const unit =
		best.unit === 'each' || best.unit === 'ea' ? 'each' : `per ${best.unit.replace(/^\//, '')}`;
	return { value: `${best.display} ${unit}`, confidence: best.confidence };
}

function vatMarkerFor(money: Money, rows: Row[]): 'inc' | 'ex' | undefined {
	const near = [
		context(money.row, 0, -1).after,
		...suffixesFor(money.box, money.height, rows, money.row).map((r) => r.text),
		...captionsFor(money.box, money.height, rows, money.row).map((r) => r.text)
	].join(' ');
	// Only text after the price on its own row counts there; earlier words belong to others.
	const own = money.row.tokens
		.slice(money.row.tokens.indexOf(money.tokens.at(-1)!) + 1)
		.map((t) => t.text)
		.join(' ');
	const text = own + ' ' + near.replace(money.row.text, '');
	if (EX_VAT.test(text)) return 'ex';
	if (INC_VAT.test(text)) return 'inc';
	return undefined;
}

function pickVat(
	chosen: Money | undefined,
	money: Money[],
	rows: Row[],
	checks: string[]
): ReadField<boolean> | undefined {
	if (!chosen) return undefined;
	const marker = vatMarkerFor(chosen, rows);
	// Trade labels show both prices; inc VAT should be ex VAT plus 20%.
	const partner = money.find((m) => {
		if (m === chosen) return false;
		const ratio = m.minor / chosen.minor;
		return Math.abs(ratio - 1.2) < 0.01 || Math.abs(ratio - 1 / 1.2) < 0.01;
	});
	const partnerMarker = partner && vatMarkerFor(partner, rows);
	if (marker) {
		const value = marker === 'inc';
		if (partnerMarker && partnerMarker !== marker) checks.push('inc and ex VAT prices agree');
		return { value, confidence: 0.97 };
	}
	if (partner && partnerMarker) {
		// The other price is marked; this one is the opposite if the 20% relation holds.
		const consistent =
			partnerMarker === 'inc' ? partner.minor > chosen.minor : partner.minor < chosen.minor;
		if (consistent) {
			checks.push('inc and ex VAT prices agree');
			return { value: partnerMarker !== 'inc', confidence: 0.95 };
		}
	}
	if (rows.some((r) => EX_VAT.test(r.text))) return { value: false, confidence: 0.7 };
	if (rows.some((r) => INC_VAT.test(r.text))) return { value: true, confidence: 0.7 };
	return undefined;
}

function isDescriptionRow(row: Row, excluded: Set<Row>): boolean {
	const text = row.text.trim();
	const compact = text.replace(/\s/g, '');
	const letters = compact.replace(/[^a-z]/gi, '').length;
	if (excluded.has(row) || row.confidence < 0.5 || !letters) return false;
	if (PACK_SIZE.test(text)) return true;
	// "5% FAT 500G": a line ending in a pack size is description, however few its letters.
	if (
		packSizes(text).some((p) => p.dimension !== 'count') &&
		meaningfulWords(text).length &&
		!UNIT_CAPTION.test(text) &&
		!/[£€$]|\d\s*p\b/i.test(text)
	) {
		return true;
	}
	// Stray glyphs ("D" for a currency sign, "BC" from a logo) are not words.
	if (!meaningfulWords(text).length) return false;
	if (letters < compact.length * 0.5) return false;
	if (UNIT_CAPTION.test(text) || OLD_CONTEXT.test(text) || INC_VAT.test(text) || EX_VAT.test(text))
		return false;
	if (LOYALTY_CONTEXT.test(text) || RETAILER.test(text) || LABEL_FURNITURE.test(text)) return false;
	// A Nutri-Score badge reads as a run of the letters A–E.
	if ('ABCDE'.includes(compact.toUpperCase()) && compact.length >= 3) return false;
	// Captions ("SELL PRICE", "Now only") and promotional banners.
	if (
		/^(?:(?:sell(?:ing)?|our|regular|normal|standard|usual)\s*price|price|now|only|now\s*only|each)$/i.test(
			text
		)
	)
		return false;
	if (isPromo(text)) return false;
	return true;
}

/** "3OOG" → "300G": in a pack size, an O between digits and the unit can only be a zero. */
const fixPackSizeDigits = (word: string) =>
	/^\d[\dOo]*(?:[.,]\d+)?(?:g|kg|ml|l|cl|ltr)$/i.test(word)
		? word.replace(/^\d[\dOo]*/, (digits) => digits.replace(/[Oo]/g, '0'))
		: word;

const meaningfulWords = (text: string) =>
	text
		.split(/\s+/)
		.filter((w) => w.replace(/[^a-z]/gi, '').length >= 3 && !CURRENCY_WORD.test(strip(w)));

/** Enough to be a product name: two real words, or one long one ("Spaghetti"). */
const isProductName = (rows: Row[]) => {
	const words = meaningfulWords(rows.map((r) => r.text).join(' '));
	return words.length >= 2 || words.join('').replace(/[^a-z]/gi, '').length >= 6;
};

function pickDescription(rows: Row[], excluded: Set<Row>): LabelReading['description'] {
	const candidates = rows.filter((r) => isDescriptionRow(r, excluded));
	// Lines stacked closely, aligned left or centred, at a similar size, form a block.
	const blocks: Row[][] = [];
	const continues = (prev: Row, row: Row) => {
		const gap = row.box.y0 - prev.box.y1;
		const ratio = Math.max(row.height, prev.height) / Math.min(row.height, prev.height);
		const h = Math.max(row.height, prev.height);
		const aligned =
			Math.abs(row.box.x0 - prev.box.x0) <= 1.5 * h ||
			Math.abs((row.box.x0 + row.box.x1) / 2 - (prev.box.x0 + prev.box.x1) / 2) <= 1.5 * h;
		// Rows between the two that were excluded (a price, a caption) end the block. Only rows
		// in the same column count: a neighbouring label's fragment at the frame edge can fall
		// between the lines in reading order.
		const between = rows.some(
			(r) =>
				!candidates.includes(r) &&
				r.box.y0 >= prev.box.y1 - 1 &&
				r.box.y1 <= row.box.y0 + 1 &&
				overlapShare(
					r.box.x0,
					r.box.x1,
					Math.min(prev.box.x0, row.box.x0),
					Math.max(prev.box.x1, row.box.x1)
				) > 0
		);
		return gap <= 1.2 * h && ratio <= 1.8 && aligned && !between;
	};
	for (const row of candidates) {
		// Join whichever block this line continues, not only the latest: a neighbour's fragment
		// can start a block of its own in between.
		const block = blocks.find((b) => b.length < 4 && continues(b.at(-1)!, row));
		if (block) block.push(row);
		else blocks.push([row]);
	}
	// The product name is the most prominent block of words; ties go to the one nearer the top.
	const block = blocks
		.filter((b) => isProductName(b))
		.sort((a, b) => Math.max(...b.map((r) => r.height)) - Math.max(...a.map((r) => r.height)))[0];
	if (!block) return undefined;
	const value = block
		.map((r) => r.tokens.map((t) => fixPackSizeDigits(t.text)).join(' '))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	// The mean character confidence of the weakest line, unless any character is doubtful.
	const weakest = Math.min(...block.map((r) => r.confidence));
	const meanConfidence = Math.min(...block.map((r) => r.meanConfidence));
	const confidence = weakest >= MIN_DESCRIPTION_CHAR_CONFIDENCE ? meanConfidence : weakest;
	return { value, confidence, meanConfidence };
}

function pickBarcode(rows: Row[]): ReadField<string> | undefined {
	for (const row of rows) {
		for (const candidate of [
			row.text.replace(/\s/g, ''),
			...row.tokens.map((t) => strip(t.text))
		]) {
			if (isValidGtin(candidate)) return { value: candidate, confidence: row.confidence };
		}
	}
	return undefined;
}

/** "64p/litre" or "£2.10/kg" read as one word: split into the price and "/unit". */
function splitGluedUnits(rows: Row[]): Row[] {
	return rows.map((row) => ({
		...row,
		tokens: row.tokens.flatMap((token) => {
			// A slash is often read as "l", "I" or "|": "33pleach" is "33p/each".
			const text = token.text.replace(
				new RegExp(`^(\\d+(?:[.,]\\d+)?p)[lI|](${PER_UNIT})$`, 'i'),
				'$1/$2'
			);
			const m = /^([^/]*\d[^/]*)(\/.+)$/.exec(text);
			if (!m || !parseNumber(m[1])) return [token];
			const split =
				token.box.x0 + ((token.box.x1 - token.box.x0) * m[1].length) / token.text.length;
			return [
				{ ...token, text: m[1], box: { ...token.box, x1: split } },
				{ ...token, text: m[2], box: { ...token.box, x0: split } }
			];
		})
	}));
}

/** Turns the text read from a shelf label into item fields, each with a confidence. */
export function parseLabel(lines: TextLine[]): LabelReading {
	const rows = splitGluedUnits(buildRows(lines));
	const checks: string[] = [];
	const money = findMoney(rows);
	const unitPrices = findUnitPrices(rows);

	// Rows that are not description text: prices, numbers, captions, dates, codes.
	const excluded = new Set<Row>(money.map((m) => m.row));
	for (const row of rows) {
		const digitsOnly = /^[\d\s./-]+$/.test(row.text) || CURRENCY_LOOKALIKE.test(row.text.trim());
		if (digitsOnly || row.tokens.some((t) => DATE.test(strip(t.text)))) excluded.add(row);
		if (
			unitPrices.length &&
			row.tokens.some((t) => parseNumber(t.text) && /\d[.,]\d{3}$/.test(strip(t.text)))
		) {
			excluded.add(row);
		}
	}
	const description = pickDescription(rows, excluded);
	const packs = description ? packSizes(description.value) : [];
	// With no count in the name it is a single item, so a price "each" must equal the price.
	if (!packs.some((p) => p.dimension === 'count')) {
		packs.push({ amount: 1, dimension: 'count', item: 'item' });
	}
	const price = pickPrice(rows, money, unitPrices, packs, checks);
	return {
		description,
		unitPriceMinor: price?.field,
		priceIncludesTax: pickVat(price?.money, money, rows, checks),
		barcode: pickBarcode(rows),
		multiBuy: pickMultiBuy(money, price?.field),
		perUnit: pickPerUnit(unitPrices, price?.money),
		checks
	};
}
