import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The real shelf-label photo the fake camera shows (see fixtures/labels/real/ATTRIBUTION.md). */
export const FAKE_CAMERA_LABEL = 'fixtures/labels/real/uk-cully-sully-chowder.jpg';
/** Printed below the label, outside the guide, so live scanning has a barcode to find. */
export const FAKE_CAMERA_BARCODE = '5391511420780';
export const FAKE_CAMERA_VIDEO = resolve('e2e/.generated/label.y4m');

// EAN-13 encoding tables.
const L = [
	'0001101',
	'0011001',
	'0010011',
	'0111101',
	'0100011',
	'0110001',
	'0101111',
	'0111011',
	'0110111',
	'0001011'
];
const G = L.map((c) =>
	[...c]
		.map((b) => (b === '0' ? '1' : '0'))
		.reverse()
		.join('')
);
const R = L.map((c) => [...c].map((b) => (b === '0' ? '1' : '0')).join(''));
const PARITY = [
	'LLLLLL',
	'LLGLGG',
	'LLGGLG',
	'LLGGGL',
	'LGLLGG',
	'LGGLLG',
	'LGGGLL',
	'LGLGLG',
	'LGLGGL',
	'LGGLGL'
];

function ean13Svg(code: string, module = 6, height = 220): string {
	const d = [...code].map(Number);
	let bits = '101';
	for (let i = 1; i <= 6; i++) bits += (PARITY[d[0]][i - 1] === 'L' ? L : G)[d[i]];
	bits += '01010';
	for (let i = 7; i <= 12; i++) bits += R[d[i]];
	bits += '101';
	const quiet = module * 11;
	const width = bits.length * module + quiet * 2;
	const bars = [...bits]
		.map((b, i) =>
			b === '1'
				? `<rect x="${quiet + i * module}" y="20" width="${module}" height="${height}"/>`
				: ''
		)
		.join('');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 40}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars}</g></svg>`;
}

/**
 * Builds the one-frame portrait video Chromium's fake camera loops (needs ffmpeg, rsvg-convert,
 * magick), at the 1440 × 2560 the app asks for so it is not rescaled. The label fills the app's
 * guide frame as it falls on a Pixel 7 screen (412 × 915 CSS px, video scaled by 915 / 2560): the
 * guide is 88% of the width and centred about 49% down, so a snapped photo is cropped to the label
 * as on a phone.
 */
export default function globalSetup() {
	const dir = 'e2e/.generated';
	mkdirSync(dir, { recursive: true });
	writeFileSync(`${dir}/barcode.svg`, ean13Svg(FAKE_CAMERA_BARCODE));
	execFileSync('rsvg-convert', ['-o', `${dir}/barcode.png`, `${dir}/barcode.svg`]);
	execFileSync('magick', [
		'-size',
		'1440x2560',
		'xc:#8a8f8c',
		'(',
		FAKE_CAMERA_LABEL,
		'-resize',
		'980x',
		')',
		'-gravity',
		'center',
		'-geometry',
		'+0-30',
		'-composite',
		'(',
		`${dir}/barcode.png`,
		'-resize',
		'700x',
		')',
		'-geometry',
		'+0+700',
		'-composite',
		`${dir}/frame.png`
	]);
	execFileSync('ffmpeg', [
		'-loglevel',
		'error',
		'-y',
		'-i',
		`${dir}/frame.png`,
		'-frames:v',
		'1',
		'-pix_fmt',
		'yuv420p',
		FAKE_CAMERA_VIDEO
	]);
}
