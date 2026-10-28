/** False on insecure origins and browsers without camera access; use the file picker then. */
export function canUseCamera(): boolean {
	return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** The rear camera at up to 1080p, which is plenty for a label after compression. */
export function openRearCamera(): Promise<MediaStream> {
	return navigator.mediaDevices.getUserMedia({
		audio: false,
		video: {
			facingMode: { ideal: 'environment' },
			width: { ideal: 1920 },
			height: { ideal: 1080 }
		}
	});
}

export function stopCamera(stream: MediaStream | undefined): void {
	for (const track of stream?.getTracks() ?? []) track.stop();
}

/** The current video frame at full resolution, as a JPEG. */
export function grabFrame(video: HTMLVideoElement): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	const context = canvas.getContext('2d');
	if (!context || !canvas.width) return Promise.reject(new Error('The camera is not ready yet.'));
	context.drawImage(video, 0, 0);
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
