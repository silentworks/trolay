/// <reference lib="webworker" />
// Runs the OCR engine off the main thread: the page stays responsive while a label is read.
import * as ort from 'onnxruntime-web/wasm';
import { createPaddleOcr, type OrtModule, type PaddleOcr, type TextLine } from './engine.ts';
import type { Raster } from './raster.ts';

export type OcrCommand = { type: 'load'; base: string } | { type: 'read'; photo: Blob };
export type OcrRequest = OcrCommand & { id: number };
export type OcrResponse = { id: number; lines?: TextLine[]; error?: string };

let engine: Promise<PaddleOcr> | undefined;

async function load(base: string): Promise<PaddleOcr> {
	// The WebAssembly runtime and its loader are served from the same folder as the models.
	ort.env.wasm.wasmPaths = base;
	// Threads need a cross-origin isolated page (static/_headers); otherwise one thread.
	ort.env.wasm.numThreads = self.crossOriginIsolated
		? Math.min(4, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1))
		: 1;
	const fetchBytes = async (name: string) => {
		const response = await fetch(base + name);
		if (!response.ok) throw new Error(`Could not load the label reader (${name}).`);
		return new Uint8Array(await response.arrayBuffer());
	};
	const [detection, recognition, dictionary] = await Promise.all([
		fetchBytes('detection.onnx'),
		fetchBytes('recognition.onnx'),
		fetch(base + 'dictionary.txt').then((r) => r.text())
	]);
	return createPaddleOcr(ort as unknown as OrtModule, {
		detection,
		recognition,
		dictionary: dictionary.split('\n').slice(0, -1)
	});
}

async function decode(photo: Blob): Promise<Raster> {
	const bitmap = await createImageBitmap(photo, { imageOrientation: 'from-image' });
	const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Could not read the photo.');
	context.drawImage(bitmap, 0, 0);
	bitmap.close();
	const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
	return { data, width, height };
}

self.onmessage = async (event: MessageEvent<OcrRequest>) => {
	const request = event.data;
	try {
		if (request.type === 'load') {
			engine ??= load(request.base).catch((error) => {
				engine = undefined;
				throw error;
			});
			await engine;
			self.postMessage({ id: request.id } satisfies OcrResponse);
		} else {
			if (!engine) throw new Error('The label reader is not loaded.');
			const lines = await (await engine).read(await decode(request.photo));
			self.postMessage({ id: request.id, lines } satisfies OcrResponse);
		}
	} catch (error) {
		self.postMessage({
			id: request.id,
			error: error instanceof Error ? error.message : String(error)
		} satisfies OcrResponse);
	}
};
