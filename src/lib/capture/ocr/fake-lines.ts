import type { TextLine } from './engine';

// For tests: OCR output built by hand, laid out as the engine reports it.

/**
 * A line of OCR output: text centred at (cx, cy), `height` pixels tall, words spread evenly
 * across `width` (default: 0.55 × height per character), at an optional tilt in degrees.
 */
export function line(
	text: string,
	cx: number,
	cy: number,
	height: number,
	{ width = text.length * height * 0.55, confidence = 0.99, angle = 0 } = {}
): TextLine {
	const rad = (angle * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	let offset = 0;
	const words = text.split(' ').map((word) => {
		const start = offset / text.length;
		const end = (offset + word.length) / text.length;
		offset += word.length + 1;
		const u0 = (start - 0.5) * width;
		const u1 = (end - 0.5) * width;
		const corner = (u: number, v: number): [number, number] => [
			cx + u * cos - v * sin,
			cy + u * sin + v * cos
		];
		return {
			text: word,
			confidence,
			box: [
				corner(u0, -height / 2),
				corner(u1, -height / 2),
				corner(u1, height / 2),
				corner(u0, height / 2)
			]
		};
	});
	return { text, confidence, region: { cx, cy, width, height, angle: rad }, words };
}
