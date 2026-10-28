/// <reference lib="webworker" />
import { compressInPlace } from './image.ts';

self.onmessage = async (event: MessageEvent<Blob>) => {
	try {
		self.postMessage(await compressInPlace(event.data));
	} catch (error) {
		self.postMessage({ error: error instanceof Error ? error.message : String(error) });
	}
};
