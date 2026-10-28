import type { OcrLine } from './parse-label.ts';

// The label is read twice, and both the app and scripts/label-accuracy.ts use these settings:
// - detail: the full-size photo with Sauvola (local) thresholding, which copes with coloured
//   bands and uneven light, for the description, VAT marker and small print;
// - large: a one-third-size copy with Tesseract's default global thresholding, where the big
//   price is a normal text size instead of being broken up into pieces.
export const DETAIL_PARAMS = { thresholding_method: '2' };
export const LARGE_PARAMS = { thresholding_method: '0' };
export const LARGE_PASS_SCALE = 1 / 3;

/** The parts of Tesseract's result we read (tesseract.js `recognize` with `blocks: true`). */
export interface TesseractPage {
	blocks:
		| {
				paragraphs: {
					lines: {
						text: string;
						confidence: number;
						bbox: { y0: number; y1: number };
						words: { text: string; confidence: number }[];
					}[];
				}[];
		  }[]
		| null;
}

/** Flattens a result into lines, with heights in full-size pixels (`scale` is the pass's). */
export function toOcrLines(page: TesseractPage, scale = 1): OcrLine[] {
	return (page.blocks ?? []).flatMap((block) =>
		block.paragraphs.flatMap((paragraph) =>
			paragraph.lines.map((line) => ({
				text: line.text,
				confidence: line.confidence,
				height: (line.bbox.y1 - line.bbox.y0) / scale,
				words: line.words.map(({ text, confidence }) => ({ text, confidence }))
			}))
		)
	);
}
