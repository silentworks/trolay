// Shared by the accuracy checks: cached OCR readings and the error-rate bound they report.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PaddleOcr, TextLine } from '../../src/lib/capture/ocr/engine.ts';
import { readRaster } from './node-ocr.ts';

const CACHE = '.cache/ocr';
// Bump when the OCR engine or its settings change, so cached readings are not reused.
export const ENGINE_VERSION = 'pp-ocrv5-mobile-8';

export function cachePath(path: string): string {
	const key = createHash('sha1').update(ENGINE_VERSION).update(readFileSync(path)).digest('hex');
	return join(CACHE, `${key}.json`);
}

/** Reads a photo through the OCR, or from the cache; `ms` is 0 when it came from the cache. */
export async function readCached(
	ocr: PaddleOcr,
	path: string,
	useCache = true
): Promise<{ lines: TextLine[]; ms: number }> {
	const cached = cachePath(path);
	if (useCache && existsSync(cached)) {
		return { lines: JSON.parse(readFileSync(cached, 'utf8')), ms: 0 };
	}
	const image = readRaster(path);
	const started = performance.now();
	const lines = await ocr.read(image);
	const ms = performance.now() - started;
	mkdirSync(CACHE, { recursive: true });
	writeFileSync(cached, JSON.stringify(lines));
	return { lines, ms };
}

/** Wilson score interval upper bound for k events in n trials, 95%. */
export function wilsonUpper(k: number, n: number): number {
	if (!n) return 1;
	const z = 1.959964;
	const p = k / n;
	const centre = p + (z * z) / (2 * n);
	const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
	return Math.min(1, (centre + margin) / (1 + (z * z) / n));
}
