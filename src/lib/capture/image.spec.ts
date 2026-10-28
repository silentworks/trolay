import { describe, expect, it } from 'vitest';
import { fitWithin, PHOTO_MAX_EDGE, THUMB_MAX_EDGE } from './image';

describe('fitWithin', () => {
	it('scales the long edge down to the limit, keeping the aspect ratio', () => {
		expect(fitWithin(4032, 3024, PHOTO_MAX_EDGE)).toEqual({ width: 1600, height: 1200 });
		expect(fitWithin(3024, 4032, PHOTO_MAX_EDGE)).toEqual({ width: 1200, height: 1600 });
		expect(fitWithin(4032, 3024, THUMB_MAX_EDGE)).toEqual({ width: 240, height: 180 });
	});

	it('never enlarges a small image', () => {
		expect(fitWithin(800, 600, PHOTO_MAX_EDGE)).toEqual({ width: 800, height: 600 });
	});

	it('keeps at least one pixel on each side', () => {
		expect(fitWithin(10_000, 1, THUMB_MAX_EDGE)).toEqual({ width: 240, height: 1 });
	});
});
