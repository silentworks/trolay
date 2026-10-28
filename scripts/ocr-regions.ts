// Debug tool: lists every text region the detector finds in an image, with what the recogniser
// reads in each, before any voting or parsing. Optionally saves the detector's probability map.
// Usage: node scripts/ocr-regions.ts <image> [detector long side, default 960] [prob-map.png]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { prepareDetection, findTextRegions } from '../src/lib/capture/ocr/detect.ts';
import { prepareRecognition, decodeCtc, REC_HEIGHT } from '../src/lib/capture/ocr/recognize.ts';
import { readRaster, readDictionary } from './lib/node-ocr.ts';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
const require = createRequire(import.meta.url);
const ort = await import('onnxruntime-web/wasm');
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = dirname(require.resolve('onnxruntime-web/wasm')) + '/';
ort.env.logLevel = 'error';
const det = await ort.InferenceSession.create(readFileSync('models/ocr/PP-OCRv5_mobile_det.onnx'));
const rec = await ort.InferenceSession.create(
	readFileSync('models/ocr/en_PP-OCRv5_mobile_rec.onnx')
);
const dict = readDictionary();
const [file, limit, out] = [process.argv[2], Number(process.argv[3] ?? 960), process.argv[4]];
const img = readRaster(file);
const input = prepareDetection(img, limit);
const p = await det.run({
	x: new ort.Tensor('float32', input.data, [1, 3, input.height, input.width])
});
const prob = p[det.outputNames[0]].data as Float32Array;
if (out) {
	// save probability map
	const buf = Buffer.alloc(input.width * input.height);
	for (let i = 0; i < buf.length; i++) buf[i] = Math.round(prob[i] * 255);
	execFileSync(
		'magick',
		['-size', `${input.width}x${input.height}`, '-depth', '8', 'gray:-', out],
		{ input: buf }
	);
}
const regions = findTextRegions(prob, input);
console.log(`limit ${limit}: det ${input.width}x${input.height}, ${regions.length} regions`);
for (const r of regions) {
	const crop = prepareRecognition(img, r);
	const o = await rec.run({
		x: new ort.Tensor('float32', crop.data, [1, 3, REC_HEIGHT, crop.width])
	});
	const t = o[rec.outputNames[0]];
	const chars = decodeCtc(t.data, t.dims[1], t.dims[2], dict, crop.contentWidth / crop.width);
	console.log(
		`  c(${Math.round(r.cx)},${Math.round(r.cy)}) ${Math.round(r.width)}x${Math.round(r.height)} a${(r.angle * 57.3).toFixed(1)} s${r.score.toFixed(2)} → "${chars.map((c) => c.char).join('')}" [${chars.map((c) => Math.round(c.confidence * 100)).join(',')}]`
	);
}
