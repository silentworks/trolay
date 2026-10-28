import { isValidGtin } from './gtin.ts';

// Retail product barcodes only.
const FORMATS = ['ean_13', 'upc_a', 'ean_8'] as const;

interface Detector {
	detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

interface NativeDetectorClass {
	new (options: { formats: string[] }): Detector;
	getSupportedFormats(): Promise<string[]>;
}

let detector: Promise<Detector> | undefined;

async function load(): Promise<Detector> {
	// Android Chrome has a built-in detector; use it when it reads retail barcodes.
	const Native = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
	if (Native) {
		try {
			const supported = await Native.getSupportedFormats();
			const formats = FORMATS.filter((f) => supported.includes(f));
			if (formats.length) return new Native({ formats });
		} catch {
			// Fall through to ZXing.
		}
	}
	// Elsewhere (iOS Safari), ZXing compiled to WebAssembly. The .wasm is bundled with the app
	// rather than fetched from a CDN, so it works offline.
	const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
		import('barcode-detector/ponyfill'),
		import('zxing-wasm/reader/zxing_reader.wasm?url')
	]);
	prepareZXingModule({
		overrides: {
			locateFile: (path: string, prefix: string) =>
				path.endsWith('.wasm') ? wasmUrl : prefix + path
		}
	});
	return new BarcodeDetector({ formats: [...FORMATS] });
}

/** Loads the detector ahead of the first scan. */
export function warmUpBarcodes(): Promise<Detector> {
	detector ??= load().catch((error: unknown) => {
		detector = undefined;
		throw error;
	});
	return detector;
}

/** The first valid retail barcode in view, if any. */
export async function detectBarcode(source: ImageBitmapSource): Promise<string | undefined> {
	const results = await (await warmUpBarcodes()).detect(source);
	return results.map((r) => r.rawValue).find(isValidGtin);
}

/** Detects a barcode in a photo file. */
export async function detectBarcodeInPhoto(photo: Blob): Promise<string | undefined> {
	const bitmap = await createImageBitmap(photo);
	try {
		return await detectBarcode(bitmap);
	} finally {
		bitmap.close();
	}
}
