export const PHOTO_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 240;
export const JPEG_QUALITY = 0.8;

export interface CompressedPhoto {
	blob: Blob;
	thumbBlob: Blob;
}

/** Scales to fit within `maxEdge` on the long side; never enlarges. */
export function fitWithin(
	width: number,
	height: number,
	maxEdge: number
): { width: number; height: number } {
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

async function encode(bitmap: ImageBitmap, maxEdge: number): Promise<Blob> {
	const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(width, height);
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Could not process the photo.');
		context.drawImage(bitmap, 0, 0, width, height);
		return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
	}
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Could not process the photo.');
	context.drawImage(bitmap, 0, 0, width, height);
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Could not process the photo.'))),
			'image/jpeg',
			JPEG_QUALITY
		)
	);
}

/** Does the work; called inside the compression worker, or on the main thread as a fallback. */
export async function compressInPlace(source: Blob): Promise<CompressedPhoto> {
	// Applies the EXIF rotation that phone cameras rely on.
	const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
	try {
		const [blob, thumbBlob] = await Promise.all([
			encode(bitmap, PHOTO_MAX_EDGE),
			encode(bitmap, THUMB_MAX_EDGE)
		]);
		return { blob, thumbBlob };
	} finally {
		bitmap.close();
	}
}

/**
 * Resizes a camera photo for storage (1600 px long edge, JPEG 80%) and makes a 240 px
 * thumbnail. Runs in a worker where OffscreenCanvas exists, so the UI stays responsive.
 */
export async function compressPhoto(source: Blob): Promise<CompressedPhoto> {
	if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined') {
		return compressInPlace(source);
	}
	const worker = new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module' });
	try {
		return await new Promise<CompressedPhoto>((resolve, reject) => {
			worker.onmessage = (event: MessageEvent<CompressedPhoto | { error: string }>) =>
				'error' in event.data ? reject(new Error(event.data.error)) : resolve(event.data);
			worker.onerror = (event) =>
				reject(new Error(event.message || 'Could not process the photo.'));
			worker.postMessage(source);
		});
	} finally {
		worker.terminate();
	}
}
