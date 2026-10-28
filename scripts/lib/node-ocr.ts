// Runs the app's OCR engine in Node for scripts and accuracy checks: the same onnxruntime-web
// WebAssembly build and the same models the browser loads, with images decoded by ImageMagick.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
	createPaddleOcr,
	type OrtModule,
	type PaddleOcr
} from '../../src/lib/capture/ocr/engine.ts';
import type { Raster } from '../../src/lib/capture/ocr/raster.ts';

const require = createRequire(import.meta.url);
const MODELS = 'models/ocr';

/** Decodes any image ImageMagick can read (applying EXIF rotation) into RGBA pixels. */
export function readRaster(path: string | Buffer, extraArgs: string[] = []): Raster {
	const input = typeof path === 'string' ? path : '-';
	const options = typeof path === 'string' ? {} : { input: path };
	const size = execFileSync(
		'magick',
		[input, '-auto-orient', ...extraArgs, '-format', '%w %h', 'info:'],
		options
	)
		.toString()
		.trim()
		.split(' ')
		.map(Number);
	const data = execFileSync(
		'magick',
		[input, '-auto-orient', ...extraArgs, '-depth', '8', '-alpha', 'on', 'rgba:-'],
		{ ...options, maxBuffer: 1 << 30 }
	);
	return {
		width: size[0],
		height: size[1],
		data: new Uint8Array(data.buffer, data.byteOffset, data.length)
	};
}

export function readDictionary(): string[] {
	return readFileSync(join(MODELS, 'en_PP-OCRv5_mobile_rec.dict.txt'), 'utf8')
		.split('\n')
		.slice(0, -1);
}

export async function loadNodeOcr(): Promise<PaddleOcr> {
	const ort = (await import('onnxruntime-web/wasm')) as unknown as OrtModule & {
		env: { wasm: { numThreads: number; wasmPaths: string } };
	};
	ort.env.wasm.numThreads = 1;
	ort.env.wasm.wasmPaths = dirname(require.resolve('onnxruntime-web/wasm')) + '/';
	return createPaddleOcr(ort, {
		detection: readFileSync(join(MODELS, 'PP-OCRv5_mobile_det.onnx')),
		recognition: readFileSync(join(MODELS, 'en_PP-OCRv5_mobile_rec.onnx')),
		dictionary: readDictionary()
	});
}
