/** False on insecure origins and browsers without camera access; use the file picker then. */
export function canUseCamera(): boolean {
	return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/**
 * The rear camera, asking for frames in the screen's orientation (portrait when the phone is
 * upright) at up to 1440 × 2560: a mismatched request makes some browsers crop or stretch the
 * frame, and the label in the guide should keep every pixel the camera has.
 */
export function openRearCamera(): Promise<MediaStream> {
	const portrait = window.innerHeight >= window.innerWidth;
	return navigator.mediaDevices.getUserMedia({
		audio: false,
		video: {
			facingMode: { ideal: 'environment' },
			width: { ideal: portrait ? 1440 : 2560 },
			height: { ideal: portrait ? 2560 : 1440 }
		}
	});
}

export function stopCamera(stream: MediaStream | undefined): void {
	for (const track of stream?.getTracks() ?? []) track.stop();
}

export interface FrameCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The part of the video frame under an element drawn over it (the label guide), in video
 * pixels, grown by `margin` of the guide's size on each side and kept inside the frame. The video
 * is shown with object-fit: cover, so it is scaled up and centred.
 */
export function cropUnder(video: HTMLVideoElement, guide: Element, margin = 0.15): FrameCrop {
	const view = video.getBoundingClientRect();
	const box = guide.getBoundingClientRect();
	const scale = Math.max(view.width / video.videoWidth, view.height / video.videoHeight);
	const left = view.left + (view.width - video.videoWidth * scale) / 2;
	const top = view.top + (view.height - video.videoHeight * scale) / 2;
	const x0 = Math.max(0, (box.left - box.width * margin - left) / scale);
	const y0 = Math.max(0, (box.top - box.height * margin - top) / scale);
	const x1 = Math.min(video.videoWidth, (box.right + box.width * margin - left) / scale);
	const y1 = Math.min(video.videoHeight, (box.bottom + box.height * margin - top) / scale);
	return {
		x: Math.round(x0),
		y: Math.round(y0),
		width: Math.round(x1 - x0),
		height: Math.round(y1 - y0)
	};
}

/** The current video frame (or the cropped part of it) at full resolution, as a JPEG. */
export function grabFrame(video: HTMLVideoElement, crop?: FrameCrop): Promise<Blob> {
	const area = crop ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
	const canvas = document.createElement('canvas');
	canvas.width = area.width;
	canvas.height = area.height;
	const context = canvas.getContext('2d');
	if (!context || !canvas.width || !canvas.height) {
		return Promise.reject(new Error('The camera is not ready yet.'));
	}
	context.drawImage(video, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Could not take the photo.'))),
			'image/jpeg',
			0.92
		)
	);
}

/** A readable reason for a getUserMedia failure. */
export function cameraErrorMessage(error: unknown): string {
	const name = error instanceof DOMException ? error.name : '';
	if (name === 'NotAllowedError' || name === 'SecurityError') {
		return 'Camera access is turned off for this app.';
	}
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found.';
	if (name === 'NotReadableError') return 'The camera is being used by another app.';
	return 'The camera could not be started.';
}
