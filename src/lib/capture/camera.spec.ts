import { describe, expect, it } from 'vitest';
import { cropUnder } from './camera';

const rect = (left: number, top: number, width: number, height: number) =>
	({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

/** A video element of the given frame size, shown in a view, and a guide drawn over it. */
function crop(frame: [number, number], view: DOMRect, guide: DOMRect, margin?: number) {
	const video = {
		videoWidth: frame[0],
		videoHeight: frame[1],
		getBoundingClientRect: () => view
	} as HTMLVideoElement;
	return cropUnder(video, { getBoundingClientRect: () => guide } as Element, margin);
}

describe('cropUnder', () => {
	it('maps the guide onto a frame shown whole, with bars above and below', () => {
		// A 1200 × 1600 frame in a 400 × 800 view is shown 400 × 533, centred (133 px bars).
		const photo = crop([1200, 1600], rect(0, 0, 400, 800), rect(40, 200, 320, 200), 0);
		expect(photo).toEqual({ x: 120, y: 200, width: 960, height: 600 });
	});

	it('keeps the crop inside the frame', () => {
		const photo = crop([1200, 1600], rect(0, 0, 400, 800), rect(0, 100, 400, 700), 0.15);
		expect(photo.x).toBe(0);
		expect(photo.y).toBe(0);
		expect(photo.width).toBe(1200);
		expect(photo.height).toBe(1600);
	});
});
