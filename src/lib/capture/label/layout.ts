import type { TextLine } from '../ocr/engine.ts';

export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

/** One word as read, with where it sits on the label. */
export interface Token {
	text: string;
	/** 0–1: the lowest character confidence in the word. */
	confidence: number;
	box: Box;
	/** Text height of the line the word is in, in pixels: a proxy for font size. */
	height: number;
}

/** Words that sit side by side at the same size: one line of the label. */
export interface Row {
	tokens: Token[];
	text: string;
	/** 0–1: the lowest word confidence in the row. */
	confidence: number;
	/** 0–1: mean character confidence of the row's text. */
	meanConfidence: number;
	box: Box;
	height: number;
	/** Centre of the text itself; on a tilted label the box above is taller than the text. */
	cx: number;
	cy: number;
	/** Slope of the text baseline (radians); labels photographed at an angle tilt every line. */
	angle: number;
}

/**
 * The lowest confidence among words with letters or digits. The OCR is persistently unsure of a
 * lone "&" or "-" even when right, and a slip there does not change what the product is.
 */
function weakest(tokens: Token[]): number {
	const words = tokens.filter((t) => /[a-z0-9]/i.test(t.text));
	return Math.min(...(words.length ? words : tokens).map((t) => t.confidence));
}

/** Where the row's centre line is at horizontal position x, following its tilt. */
export const yAt = (row: Pick<Row, 'cx' | 'cy' | 'angle'>, x: number) =>
	row.cy + (x - row.cx) * Math.tan(row.angle);

/** Vertical distance between two rows' centre lines, measured where they are compared. */
function rowOffset(a: Pick<Row, 'cx' | 'cy' | 'angle'>, b: Pick<Row, 'cx' | 'cy' | 'angle'>) {
	return b.cy - yAt(a, b.cx);
}

const toBox = (points: [number, number][]): Box => ({
	x0: Math.min(...points.map((p) => p[0])),
	y0: Math.min(...points.map((p) => p[1])),
	x1: Math.max(...points.map((p) => p[0])),
	y1: Math.max(...points.map((p) => p[1]))
});

export const union = (a: Box, b: Box): Box => ({
	x0: Math.min(a.x0, b.x0),
	y0: Math.min(a.y0, b.y0),
	x1: Math.max(a.x1, b.x1),
	y1: Math.max(a.y1, b.y1)
});

/** Overlap of two intervals as a share of the shorter one. */
export function overlapShare(a0: number, a1: number, b0: number, b1: number): number {
	const overlap = Math.min(a1, b1) - Math.max(a0, b0);
	return Math.max(0, overlap) / Math.max(1e-6, Math.min(a1 - a0, b1 - b0));
}

/**
 * Groups detected lines into rows. The detector sometimes splits one line of the label into
 * pieces ("Porridge" | "Oats"); pieces that overlap vertically, have a similar size and sit
 * close together are joined, left to right.
 */
export function buildRows(lines: TextLine[]): Row[] {
	const pieces = lines
		.map((line) => ({
			chars: line.text.replace(/\s/g, '').length,
			sum: line.confidence * line.text.replace(/\s/g, '').length,
			height: line.region.height,
			cx: line.region.cx,
			cy: line.region.cy,
			angle: line.region.angle,
			width: line.region.width,
			tokens: line.words.map((w) => ({
				text: w.text,
				confidence: w.confidence,
				box: toBox(w.box),
				height: line.region.height
			})),
			box: toBox(line.words.flatMap((w) => w.box))
		}))
		.filter((p) => p.tokens.length)
		.sort((a, b) => a.box.x0 - b.box.x0);

	const rows: {
		chars: number;
		sum: number;
		height: number;
		cx: number;
		cy: number;
		angle: number;
		width: number;
		box: Box;
		tokens: Token[];
	}[] = [];
	for (const piece of pieces) {
		const row = rows.find((r) => {
			const ratio = Math.max(r.height, piece.height) / Math.min(r.height, piece.height);
			const gap = piece.box.x0 - r.box.x1;
			// Pieces of one line are the same size with at most a word space or two between them;
			// anything looser could be two different prices side by side.
			return (
				ratio <= 1.3 &&
				Math.abs(rowOffset(r, piece)) <= 0.5 * Math.min(r.height, piece.height) &&
				gap <= Math.min(r.height, piece.height) &&
				gap >= -0.5 * Math.min(r.height, piece.height)
			);
		});
		if (row) {
			row.tokens.push(...piece.tokens);
			row.chars += piece.chars;
			row.sum += piece.sum;
			row.box = union(row.box, piece.box);
			row.height = Math.max(row.height, piece.height);
			// The longest piece gives the best estimate of the tilt.
			if (piece.width > row.width) Object.assign(row, { angle: piece.angle, width: piece.width });
		} else {
			rows.push({ ...piece, tokens: [...piece.tokens] });
		}
	}

	return rows
		.sort((a, b) => {
			// Measured along the longer row's tilt, which is the more reliable estimate.
			const offset = a.width >= b.width ? rowOffset(a, b) : -rowOffset(b, a);
			const sameBand = Math.abs(offset) < 0.5 * Math.min(a.height, b.height);
			return sameBand ? a.box.x0 - b.box.x0 : -offset;
		})
		.map(({ tokens, box, height, cx, cy, angle, chars, sum }) => ({
			tokens,
			box,
			height,
			cx,
			cy,
			angle,
			meanConfidence: chars ? sum / chars : 0,
			text: tokens.map((t) => t.text).join(' '),
			confidence: weakest(tokens)
		}));
}
