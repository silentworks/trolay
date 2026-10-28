import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const FAKE_CAMERA_LABEL = 'fixtures/labels/synthetic-01-classic.png';
export const FAKE_CAMERA_VIDEO = resolve('e2e/.generated/label.y4m');

/** Turns a label fixture into the one-frame video Chromium's fake camera loops (needs ffmpeg). */
export default function globalSetup() {
	mkdirSync('e2e/.generated', { recursive: true });
	execFileSync('ffmpeg', [
		'-loglevel',
		'error',
		'-y',
		'-i',
		FAKE_CAMERA_LABEL,
		'-frames:v',
		'1',
		'-pix_fmt',
		'yuv420p',
		FAKE_CAMERA_VIDEO
	]);
}
