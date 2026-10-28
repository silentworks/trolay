import { createWorker, OEM, type Worker } from 'tesseract.js';
import { downscale } from './image.ts';
import {
	DETAIL_PARAMS,
	LARGE_PARAMS,
	LARGE_PASS_SCALE,
	toOcrLines,
	type TesseractPage
} from './ocr-passes.ts';
import type { OcrLine } from './parse-label.ts';

// Copied from node_modules by scripts/copy-ocr-assets.js, precached by the service worker.
const base = () => new URL(`ocr/${__TESSERACT_VERSION__}/`, document.baseURI).href;

let engine: Promise<Worker> | undefined;

/**
 * Starts the OCR engine in its Web Worker (~7 MB of code and language data, then a second or
 * two to initialise on a phone). Called when a trip opens so the first capture is quick.
 */
export function warmUpOcr(): Promise<Worker> {
	engine ??= createWorker('eng', OEM.LSTM_ONLY, {
		workerPath: `${base()}worker.min.js`,
		// Wasm SIMD is in every supported browser; see scripts/copy-ocr-assets.js.
		corePath: `${base()}tesseract-core-simd-lstm.wasm.js`,
		langPath: base(),
		// Load the worker from our origin (not a blob: URL) so the service worker serves it.
		workerBlobURL: false,
		// Also kept in IndexedDB by Tesseract, so it loads offline even where the service
		// worker can't intercept requests from inside a worker.
		cacheMethod: 'write'
	}).catch((error: unknown) => {
		engine = undefined;
		throw error;
	});
	return engine;
}

/** Reads a label photo in two passes (see ocr-passes.ts), ready for parseLabel. */
export async function readLabelText(photo: Blob): Promise<OcrLine[][]> {
	const worker = await warmUpOcr();
	const small = await downscale(photo, LARGE_PASS_SCALE);
	await worker.setParameters(DETAIL_PARAMS);
	const detail = await worker.recognize(photo, {}, { blocks: true });
	await worker.setParameters(LARGE_PARAMS);
	const large = await worker.recognize(small, {}, { blocks: true });
	return [
		toOcrLines(detail.data as TesseractPage),
		toOcrLines(large.data as TesseractPage, LARGE_PASS_SCALE)
	];
}
