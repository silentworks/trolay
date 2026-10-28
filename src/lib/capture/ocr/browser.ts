import type { TextLine } from './engine.ts';
import type { OcrCommand, OcrRequest, OcrResponse } from './ocr.worker.ts';

// Served from static/ocr/<id>/ (scripts/copy-ocr-assets.js) and precached by the service worker.
const base = () => new URL(`ocr/${__OCR_ASSETS_ID__}/`, document.baseURI).href;

let worker: Worker | undefined;
let ready: Promise<void> | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (r: OcrResponse) => void }>();

function call(request: OcrCommand): Promise<OcrResponse> {
	worker ??= (() => {
		const w = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
		w.onmessage = (event: MessageEvent<OcrResponse>) => {
			pending.get(event.data.id)?.resolve(event.data);
			pending.delete(event.data.id);
		};
		return w;
	})();
	const id = ++nextId;
	return new Promise((resolve) => {
		pending.set(id, { resolve });
		worker!.postMessage({ ...request, id } as OcrRequest);
	});
}

/**
 * Loads the OCR models and runtime in their worker (about 24 MB the first time, then from the
 * cache, and a second or two to initialise on a phone). Called when a trip opens so the first
 * capture is quick.
 */
export function warmUpOcr(): Promise<void> {
	ready ??= call({ type: 'load', base: base() }).then((response) => {
		if (response.error) {
			ready = undefined;
			throw new Error(response.error);
		}
	});
	return ready;
}

/** Reads every line of text in a photo, with where each word is. */
export async function readText(photo: Blob): Promise<TextLine[]> {
	await warmUpOcr();
	const response = await call({ type: 'read', photo });
	if (response.error) throw new Error(response.error);
	return response.lines ?? [];
}
