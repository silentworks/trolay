import { isValidGtin } from './gtin.ts';

export interface OcrWord {
	text: string;
	/** 0–100, as Tesseract reports it. */
	confidence: number;
}

/** One line of recognised text, as the OCR engine reports it. */
export interface OcrLine {
	text: string;
	/** 0–100, as Tesseract reports it. */
	confidence: number;
	/**
	 * Height of the line's bounding box in pixels of the full-size image; the item price is
	 * usually the biggest text.
	 */
	height: number;
	/** When given, a price is scored on its own words, so a noisy neighbour can't sink it. */
	words?: OcrWord[];
}

export interface ReadField<T> {
	value: T;
	/** 0–1. */
	confidence: number;
}

export interface LabelReading {
	description?: ReadField<string>;
	unitPriceMinor?: ReadField<number>;
	/** Absent when the label says nothing about VAT; the store's setting applies. */
	priceIncludesTax?: ReadField<boolean>;
	barcode?: ReadField<string>;
}

/** Below this a field is left empty for the shopper to fill in, never guessed. */
export const MIN_FIELD_CONFIDENCE = 0.6;

const MIN_DESCRIPTION_LINE_CONFIDENCE = 55;

// "64p per litre", "£2.10/kg", "16.9p per 100g", "58.3p per roll"
const UNIT_PRICE =
	/(\bper\b|\/)\s*(\d+\s*)?(kg|g|ml|cl|l|ltr|litre|liter|m|metre|sheet|roll|wash|pack|unit|each|ea)\b/i;
const EACH_PRICE = /^\s*(per\s+|\/\s*)?(each|ea)\b/i;
const OLD_PRICE = /\b(was|rrp)\b/i;
// "Any 2 for £2.50", "3 for £5", "2 x £3"
const MULTI_BUY = /\b\d+\s*(for|x)\s*£/i;
const PROMO =
	/\b(offer|save|half price|price drop|multi ?buy|special|reduced|clubcard|new|rollback|deal)\b/i;
const INC_VAT = /\binc(l(uding|usive)?)?\.?\s*vat\b/i;
const EX_VAT = /\bex(c(l(uding|usive)?)?)?\.?\s*vat\b/i;

// Characters OCR commonly confuses inside a number.
const DIGIT_FIXES: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', S: '5' };
const fixDigits = (s: string) => s.replace(/[OoIlS]/g, (c) => DIGIT_FIXES[c]);

// £1.45, £ 1,45, £l.45, 1.45 (no £), 85p
const PRICE_TOKEN =
	/(£)\s?([\dOoIl]{1,4})\s?[.,]\s?([\dOoIlS]{2})(?![\d])|(?<![\d.,])(\d{1,4})[.,](\d{2})(?![\d.,])(?!\s?(kg|g|ml|cl|l|ltr)\b)|(?<![\d.£])(\d{1,2})\s?p\b/gi;

// Very large text often comes back broken up: "£ 1 | 5 0" for £1.50.
const BROKEN_PRICE_LINE = /^£[\s\d|!_.,]+$/;

interface Candidate {
	minor: number;
	line: OcrLine;
	pass: number;
	confidence: number;
	kind: 'price' | 'each' | 'excluded';
}

/** Lowest confidence of the words that overlap [start, end) of the line's text. */
function spanConfidence(line: OcrLine, start: number, end: number): number {
	if (!line.words?.length) return line.confidence;
	let offset = 0;
	let lowest = Infinity;
	for (const word of line.words) {
		const wordEnd = offset + word.text.length;
		if (wordEnd > start && offset < end) lowest = Math.min(lowest, word.confidence);
		offset = wordEnd + 1;
	}
	return Number.isFinite(lowest) ? lowest : line.confidence;
}

function classify(text: string, after: string): Candidate['kind'] {
	if (OLD_PRICE.test(text) || MULTI_BUY.test(text)) return 'excluded';
	// "£0.18 each" is the item price when nothing bigger was read.
	if (EACH_PRICE.test(after)) return 'each';
	if (UNIT_PRICE.test(after)) return 'excluded';
	return 'price';
}

function findCandidates(line: OcrLine, pass: number): Candidate[] {
	const { text } = line;
	const candidates: Candidate[] = [];
	for (const match of text.matchAll(PRICE_TOKEN)) {
		let minor: number;
		let hasPoundSign = true; // "85p" is as explicit as a £ sign.
		if (match[1]) minor = Number(fixDigits(match[2])) * 100 + Number(fixDigits(match[3]));
		else if (match[4]) {
			minor = Number(match[4]) * 100 + Number(match[5]);
			hasPoundSign = false;
		} else minor = Number(match[7]);
		if (!Number.isFinite(minor)) continue;

		const start = match.index ?? 0;
		const end = start + match[0].length;
		let confidence = spanConfidence(line, start, end) / 100;
		if (!hasPoundSign) confidence *= 0.8;
		candidates.push({ minor, line, pass, confidence, kind: classify(text, text.slice(end)) });
	}
	if (candidates.length) return candidates;

	// Only when the line didn't read normally.
	if (BROKEN_PRICE_LINE.test(text)) {
		const repaired = text.replace(/[\s_]/g, '').replace(/[|!,]+/g, '.');
		const match = /^£(\d{1,4})\.(\d{2})$/.exec(repaired);
		if (match) {
			const minor = Number(match[1]) * 100 + Number(match[2]);
			return [{ minor, line, pass, confidence: (line.confidence / 100) * 0.7, kind: 'price' }];
		}
	}
	return [];
}

interface PassPick {
	value: number;
	confidence: number;
	line: OcrLine;
}

/** The biggest eligible price in one pass, with the doubts that pass alone can raise. */
function pickInPass(lines: OcrLine[], candidates: Candidate[]): PassPick | undefined {
	const prices = candidates.filter((c) => c.kind === 'price');
	const pool = prices.length ? prices : candidates.filter((c) => c.kind === 'each');
	if (!pool.length) return undefined;

	const ranked = [...pool].sort(
		(a, b) => b.line.height - a.line.height || b.confidence - a.confidence
	);
	const chosen = ranked[0];
	let confidence = chosen.confidence;
	if (!prices.length) confidence *= 0.85;
	// Two different prices of a similar size: unsure which is the item price.
	const rival = ranked.find((c) => c.minor !== chosen.minor);
	if (rival && rival.line.height >= chosen.line.height * 0.8) confidence *= 0.6;
	// Much bigger text with digits that didn't read as a price is probably the real price.
	const priceLines = new Set(candidates.map((c) => c.line));
	if (
		lines.some(
			(l) => !priceLines.has(l) && /\d/.test(l.text) && l.height >= chosen.line.height * 1.8
		)
	) {
		confidence *= 0.5;
	}
	return { value: chosen.minor, confidence, line: chosen.line };
}

/**
 * True when the pass has big text (well above the usual line height) with digits that gave
 * no price: it may hold the real one.
 */
function bigTextUnread(lines: OcrLine[], candidates: Candidate[]): boolean {
	const heights = lines.map((l) => l.height).sort((a, b) => a - b);
	const median = heights[Math.floor(heights.length / 2)] ?? 0;
	const priceLines = new Set(candidates.map((c) => c.line));
	return lines.some((l) => l.height >= median * 2 && /\d/.test(l.text) && !priceLines.has(l));
}

/**
 * Each pass picks its own price (heights are not comparable between passes); agreement
 * raises confidence and disagreement lowers it.
 */
function pickPrice(passes: OcrLine[][], candidates: Candidate[]): PassPick | undefined {
	const picks: PassPick[] = [];
	let doubts = 0;
	passes.forEach((lines, pass) => {
		const own = candidates.filter((c) => c.pass === pass);
		const pick = pickInPass(lines, own);
		if (pick) picks.push(pick);
		else if (bigTextUnread(lines, own)) doubts++;
	});
	if (!picks.length) return undefined;

	const best = picks.reduce((a, b) => (b.confidence > a.confidence ? b : a));
	const others = picks.filter((p) => p !== best);
	let confidence = best.confidence;
	if (others.some((p) => p.value !== best.value)) {
		const closest = Math.max(
			...others.filter((p) => p.value !== best.value).map((p) => p.confidence)
		);
		confidence *= best.confidence - closest >= 0.3 ? 0.8 : 0.6;
	} else if (others.length) {
		confidence = Math.min(1, confidence + 0.15);
	}
	if (doubts) confidence *= 0.6;
	return { ...best, confidence };
}

function pickVat(lines: OcrLine[], priceLine: OcrLine | undefined): ReadField<boolean> | undefined {
	if (priceLine) {
		if (EX_VAT.test(priceLine.text)) return { value: false, confidence: 0.95 };
		if (INC_VAT.test(priceLine.text)) return { value: true, confidence: 0.95 };
		// Trade labels show both; the marker on the other price tells us what this one is.
		const others = lines.filter((l) => l.text !== priceLine.text);
		if (others.some((l) => INC_VAT.test(l.text))) return { value: false, confidence: 0.75 };
		if (others.some((l) => EX_VAT.test(l.text))) return { value: true, confidence: 0.75 };
		return undefined;
	}
	if (lines.some((l) => EX_VAT.test(l.text))) return { value: false, confidence: 0.6 };
	if (lines.some((l) => INC_VAT.test(l.text))) return { value: true, confidence: 0.6 };
	return undefined;
}

function pickDescription(
	lines: OcrLine[],
	priceLines: Set<OcrLine>
): ReadField<string> | undefined {
	const chosen: OcrLine[] = [];
	for (const line of lines) {
		if (chosen.length === 2) break;
		const text = line.text;
		const letters = text.replace(/[^a-z]/gi, '').length;
		if (
			priceLines.has(line) ||
			line.confidence < MIN_DESCRIPTION_LINE_CONFIDENCE ||
			letters === 0 ||
			letters < text.replace(/\s/g, '').length * 0.3 ||
			UNIT_PRICE.test(text) ||
			OLD_PRICE.test(text) ||
			INC_VAT.test(text) ||
			EX_VAT.test(text) ||
			(PROMO.test(text) && text === text.toUpperCase())
		) {
			continue;
		}
		chosen.push(line);
	}
	if (!chosen.length) return undefined;
	const value = chosen.map((l) => l.text).join(' ');
	const confidence = chosen.reduce((sum, l) => sum + l.confidence, 0) / chosen.length / 100;
	return { value, confidence };
}

function pickBarcode(lines: OcrLine[]): ReadField<string> | undefined {
	for (const line of lines) {
		const digits = line.text.replace(/\s/g, '');
		if (isValidGtin(digits)) return { value: digits, confidence: line.confidence / 100 };
	}
	return undefined;
}

function tidy(line: OcrLine): OcrLine {
	const words = line.words?.map((w) => ({ ...w, text: w.text.trim() })).filter((w) => w.text);
	const text = words ? words.map((w) => w.text).join(' ') : line.text.replace(/\s+/g, ' ').trim();
	return { ...line, text, words };
}

/**
 * Turns the OCR text of a UK shelf label into item fields, each with a confidence.
 *
 * Takes one or more OCR passes over the same photo. The first is the detailed pass and
 * supplies the description, VAT marker and barcode digits; prices are read from every pass,
 * because a downscaled pass reads the big price text that a full-size pass breaks up.
 */
export function parseLabel(...rawPasses: OcrLine[][]): LabelReading {
	const passes = rawPasses.map((lines) => lines.map(tidy).filter((l) => l.text));
	const candidates = passes.flatMap((lines, pass) =>
		lines.flatMap((line) => findCandidates(line, pass))
	);
	const price = pickPrice(passes, candidates);
	const detail = passes[0] ?? [];
	return {
		description: pickDescription(detail, new Set(candidates.map((c) => c.line))),
		unitPriceMinor: price && { value: price.value, confidence: price.confidence },
		priceIncludesTax: pickVat(detail, price?.line),
		barcode: pickBarcode(detail)
	};
}

/** The field's value when it is confident enough to fill in, otherwise undefined. */
export function confident<T>(field: ReadField<T> | undefined): T | undefined {
	return field && field.confidence >= MIN_FIELD_CONFIDENCE ? field.value : undefined;
}
