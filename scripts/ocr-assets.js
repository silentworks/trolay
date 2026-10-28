// The label reader's runtime files: PP-OCRv5 models (committed in models/ocr) and the ONNX
// Runtime WebAssembly build with its loader (from node_modules; served as files rather than
// bundled, so the runtime can start its own thread workers from them). They are served from
// static/ocr/<id>/, where the id is a hash of the files, so a change gets a new URL and a fresh
// cache entry.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const OCR_FILES = {
	'detection.onnx': 'models/ocr/PP-OCRv5_mobile_det.onnx',
	'recognition.onnx': 'models/ocr/en_PP-OCRv5_mobile_rec.onnx',
	'dictionary.txt': 'models/ocr/en_PP-OCRv5_mobile_rec.dict.txt',
	'ort-wasm-simd-threaded.wasm': require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm'),
	'ort-wasm-simd-threaded.mjs': require.resolve('onnxruntime-web/ort-wasm-simd-threaded.mjs')
};

export function ocrAssetsId() {
	const hash = createHash('sha256');
	for (const source of Object.values(OCR_FILES)) hash.update(readFileSync(source));
	return hash.digest('hex').slice(0, 12);
}
