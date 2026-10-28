import { compressPhoto, type CompressedPhoto } from './image.ts';

/**
 * One snapped label, from shutter to saved item. Work starts as soon as it is created, so the
 * add sheet can open straight away and fill in as results arrive.
 */
export class CaptureSession {
	/** Object URL of the original photo, for the preview; released by dispose(). */
	readonly previewUrl: string;
	photo = $state<CompressedPhoto>();
	barcode = $state<string>();
	status = $state<'working' | 'done' | 'failed'>('working');
	error = $state('');
	/** Resolves with the compressed photo once it is ready to store. */
	readonly ready: Promise<CompressedPhoto>;

	constructor(source: Blob, barcode?: string) {
		this.previewUrl = URL.createObjectURL(source);
		this.barcode = barcode;
		this.ready = this.process(source);
		this.ready.catch(() => {
			// Reported through status; the item can still be saved without a photo.
		});
	}

	private async process(source: Blob): Promise<CompressedPhoto> {
		try {
			this.photo = await compressPhoto(source);
			this.status = 'done';
			return this.photo;
		} catch (error) {
			this.status = 'failed';
			this.error = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	dispose(): void {
		URL.revokeObjectURL(this.previewUrl);
	}
}
