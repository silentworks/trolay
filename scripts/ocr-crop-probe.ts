// Debug tool: reads one region of an image in many crop variants (height, width, angle), to see
// how sensitive recognition is to the crop. Usage:
//   node scripts/ocr-crop-probe.ts <image> <cx> <cy> <width> <height> <angle-degrees> [angles...]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { decodeCtc, prepareRecognition, REC_HEIGHT } from '../src/lib/capture/ocr/recognize.ts';
import { readDictionary, readRaster } from './lib/node-ocr.ts';

const require = createRequire(import.meta.url);
const ort = await import('onnxruntime-web/wasm');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = dirname(require.resolve('onnxruntime-web/wasm')) + '/';
const rec = await ort.InferenceSession.create(
	readFileSync('models/ocr/en_PP-OCRv5_mobile_rec.onnx'),
	{
		logSeverityLevel: 3
	}
);
const dictionary = readDictionary();
const [file, cx, cy, w, h, ...angles] = process.argv.slice(2);
const image = readRaster(file);
for (const angle of angles.map(Number)) {
	for (const hs of [0.55, 0.65, 0.8, 1]) {
		for (const ws of [1, 1.08]) {
			const region = {
				cx: +cx,
				cy: +cy,
				width: +w * ws,
				height: +h * hs,
				angle: (angle * Math.PI) / 180
			};
			const crop = prepareRecognition(image, region);
			const out = await rec.run({
				x: new ort.Tensor('float32', crop.data, [1, 3, REC_HEIGHT, crop.width])
			});
			const t = out[rec.outputNames[0]];
			const chars = decodeCtc(
				t.data as Float32Array,
				t.dims[1],
				t.dims[2],
				dictionary,
				crop.contentWidth / crop.width
			);
			console.log(
				`a${angle} h${hs} w${ws}`.padEnd(18),
				chars
					.map((c) => c.char)
					.join('')
					.padEnd(8),
				chars.map((c) => Math.round(c.confidence * 100)).join(',')
			);
		}
	}
}
