import { sample, type Raster, type RotatedRect } from './raster.ts';

// PP-OCRv5 recognition (SVTR + CTC). Pre-processing follows PaddleOCR's resize_norm_img:
// height 48, width by aspect ratio, padded to at least 320, BGR scaled to [-1, 1].
export const REC_HEIGHT = 48;
const MIN_WIDTH = 320;
const MAX_WIDTH = 3200;

export interface RecInput {
	data: Float32Array;
	/** Tensor width, including padding. */
	width: number;
	/** Width actually covered by the text crop. */
	contentWidth: number;
}

/**
 * Samples the rotated region upright into the recogniser's input, so slightly tilted labels
 * read as if straight. Unlike PaddleOCR, tall regions are not turned for vertical text: on a
 * shelf label a tall region is a big digit of the price ("2", "1"), and turning it misreads it.
 */
export function prepareRecognition(image: Raster, region: RotatedRect): RecInput {
	const { width: w, height: h, angle } = region;
	const contentWidth = Math.min(MAX_WIDTH, Math.max(1, Math.ceil((REC_HEIGHT * w) / h)));
	const width = Math.max(MIN_WIDTH, contentWidth);
	const plane = REC_HEIGHT * width;
	const data = new Float32Array(3 * plane); // Padding stays 0, i.e. mid-grey.
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	for (let y = 0; y < REC_HEIGHT; y++) {
		const v = ((y + 0.5) / REC_HEIGHT - 0.5) * h;
		for (let x = 0; x < contentWidth; x++) {
			const u = ((x + 0.5) / contentWidth - 0.5) * w;
			const sx = region.cx + u * cos - v * sin;
			const sy = region.cy + u * sin + v * cos;
			const i = y * width + x;
			// RGBA in, BGR out.
			for (let c = 0; c < 3; c++) {
				data[c * plane + i] = sample(image, sx, sy, 2 - c) / 127.5 - 1;
			}
		}
	}
	return { data, width, contentWidth };
}

export interface DecodedChar {
	char: string;
	/** 0–1. */
	confidence: number;
	/** Position along the line, 0 (start) to 1 (end of the text crop). */
	position: number;
}

/**
 * Greedy CTC decoding: best class per time step, repeats collapsed, blanks dropped.
 * Classes are [blank, ...dictionary, space], as PaddleOCR's CTCLabelDecode with spaces on.
 */
export function decodeCtc(
	probs: Float32Array,
	steps: number,
	classes: number,
	dictionary: string[],
	contentFraction: number
): DecodedChar[] {
	const chars: DecodedChar[] = [];
	let previous = -1;
	for (let t = 0; t < steps; t++) {
		let best = 0;
		let bestProb = -Infinity;
		const offset = t * classes;
		for (let k = 0; k < classes; k++) {
			if (probs[offset + k] > bestProb) {
				bestProb = probs[offset + k];
				best = k;
			}
		}
		if (best !== 0 && best !== previous) {
			const char = best === dictionary.length + 1 ? ' ' : dictionary[best - 1];
			const position = Math.min(1, (t + 0.5) / steps / contentFraction);
			chars.push({ char, confidence: bestProb, position });
		}
		previous = best;
	}
	return chars;
}
