import { detectBarcodeInPhoto } from './barcode.ts';
import { compressPhoto, type CompressedPhoto } from './image.ts';
import { readLabelText } from './ocr.ts';
import { parseLabel, type LabelReading } from './parse-label.ts';

/**
 * One snapped label, from shutter to saved item. Work starts as soon as it is created, so the
 * add sheet can open straight away and fill in as results arrive: the photo is compressed,
 * then read for text and, if none was seen while aiming, checked for a barcode.
 */
export class CaptureSession {
	/** Object URL of the original photo, for the preview; released by dispose(). */
	readonly previewUrl: string;
	photo = $state<CompressedPhoto>();
	barcode = $state<string>();
	reading = $state<LabelReading>();
	stage = $state<'compressing' | 'reading' | 'done' | 'failed'>('compressing');
	error = $state('');
	/** Resolves with the compressed photo once it is ready to store. */
	readonly ready: Promise<CompressedPhoto>;

	constructor(source: Blob, barcode?: string) {
		this.previewUrl = URL.createObjectURL(source);
		this.barcode = barcode;
		this.ready = this.compress(source);
		this.ready.then(
			(photo) => this.read(photo),
			() => {
				// Reported through stage; the item can still be saved without a photo.
			}
		);
	}

	private async compress(source: Blob): Promise<CompressedPhoto> {
		try {
			this.photo = await compressPhoto(source);
			return this.photo;
		} catch (error) {
			this.stage = 'failed';
			this.error = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	private async read(photo: CompressedPhoto): Promise<void> {
		this.stage = 'reading';
		const [text, barcode] = await Promise.allSettled([
			readLabelText(photo.blob),
			this.barcode ? Promise.resolve(this.barcode) : detectBarcodeInPhoto(photo.blob)
		]);
		if (barcode.status === 'fulfilled') this.barcode = barcode.value;
		if (text.status === 'fulfilled') {
			this.reading = parseLabel(...text.value);
			this.stage = 'done';
		} else {
			console.error('Label reading failed:', text.reason);
			this.stage = 'failed';
			this.error = 'The label could not be read';
		}
	}

	dispose(): void {
		URL.revokeObjectURL(this.previewUrl);
	}
}
