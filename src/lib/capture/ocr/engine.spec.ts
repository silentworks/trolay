import { describe, expect, it } from 'vitest';
import { coveredShare, findTextRegions, minAreaRect, normaliseRect } from './detect';
import { corners } from './raster';
import { decodeCtc } from './recognize';

const deg = (r: number) => (r * 180) / Math.PI;

describe('minAreaRect', () => {
	it('fits an axis-aligned block of pixels', () => {
		const points: [number, number][] = [];
		for (let x = 10; x < 30; x++) for (let y = 5; y < 10; y++) points.push([x, y]);
		const rect = minAreaRect(points);
		expect(rect.width).toBeCloseTo(20);
		expect(rect.height).toBeCloseTo(5);
		expect(rect.cx).toBeCloseTo(19.5);
		expect(rect.cy).toBeCloseTo(7);
		expect(deg(rect.angle)).toBeCloseTo(0);
	});

	it('fits a tilted line of text, keeping the width along the text', () => {
		const points: [number, number][] = [];
		const angle = (10 * Math.PI) / 180;
		for (let u = 0; u < 200; u++) {
			for (let v = 0; v < 20; v++) {
				points.push([
					Math.round(100 + u * Math.cos(angle) - v * Math.sin(angle)),
					Math.round(50 + u * Math.sin(angle) + v * Math.cos(angle))
				]);
			}
		}
		const rect = minAreaRect(points);
		expect(deg(rect.angle)).toBeCloseTo(10, 0);
		expect(rect.width).toBeGreaterThan(rect.height * 5);
	});
});

describe('normaliseRect', () => {
	it('keeps a tall single glyph upright instead of turning it on its side', () => {
		const rect = normaliseRect({ cx: 0, cy: 0, width: 287, height: 153, angle: Math.PI / 2 });
		expect(deg(rect.angle)).toBeCloseTo(0);
		expect(rect).toMatchObject({ width: 153, height: 287 });
	});
});

describe('findTextRegions', () => {
	it('finds a block of text probability and grows it back by the unclip distance', () => {
		const width = 64;
		const height = 32;
		const prob = new Float32Array(width * height);
		for (let y = 12; y < 18; y++) for (let x = 10; x < 50; x++) prob[y * width + x] = 0.9;
		const regions = findTextRegions(prob, { width, height, scaleX: 2, scaleY: 2 });
		expect(regions).toHaveLength(1);
		const [r] = regions;
		// 40 × 6 core, unclip distance = 40·6·1.5 / (2·46) ≈ 3.9 each side, then ×2 to the photo.
		expect(r.width).toBeCloseTo((40 + 2 * 3.913) * 2, 0);
		expect(r.height).toBeCloseTo((6 + 2 * 3.913) * 2, 0);
		expect(r.score).toBeCloseTo(0.9);
	});

	it('drops faint regions below the box threshold', () => {
		const prob = new Float32Array(32 * 32);
		for (let y = 10; y < 16; y++) for (let x = 5; x < 25; x++) prob[y * 32 + x] = 0.45;
		expect(findTextRegions(prob, { width: 32, height: 32, scaleX: 1, scaleY: 1 })).toEqual([]);
	});
});

describe('coveredShare', () => {
	it('measures how much of a region another region covers', () => {
		const a = { cx: 50, cy: 50, width: 100, height: 20, angle: 0 };
		expect(coveredShare(a, [a])).toBe(1);
		// Half the grid columns, plus the one on the shared edge.
		expect(coveredShare(a, [{ ...a, cx: 100 }])).toBeCloseTo(4 / 7, 5);
		expect(coveredShare(a, [{ ...a, cy: 200 }])).toBe(0);
	});
});

describe('corners', () => {
	it('returns clockwise corners of a rotated rectangle', () => {
		const pts = corners({ cx: 0, cy: 0, width: 4, height: 2, angle: 0 });
		expect(pts).toEqual([
			[-2, -1],
			[2, -1],
			[2, 1],
			[-2, 1]
		]);
	});
});

describe('decodeCtc', () => {
	// Classes: [blank, '1', '2', '.', space].
	const dictionary = ['1', '2', '.'];
	const steps = (...best: number[]) => {
		const probs = new Float32Array(best.length * 5);
		best.forEach((k, t) => (probs[t * 5 + k] = 0.9));
		return probs;
	};

	it('collapses repeats and drops blanks', () => {
		const chars = decodeCtc(steps(1, 1, 0, 3, 2, 2, 0, 2), 8, 5, dictionary, 1);
		expect(chars.map((c) => c.char).join('')).toBe('1.22');
	});

	it('reads the last class as a space and places characters along the line', () => {
		const chars = decodeCtc(steps(1, 4, 2, 0), 4, 5, dictionary, 0.5);
		expect(chars.map((c) => c.char).join('')).toBe('1 2');
		// Half the tensor is padding, so step 0 (centre 0.125 of the tensor) is 0.25 of the text.
		expect(chars[0].position).toBeCloseTo(0.25);
	});
});
