import { resize, type Raster, type RotatedRect } from './raster.ts';

// PP-OCRv5 detection (DBNet). Pre- and post-processing follow PaddleOCR's DetResizeForTest,
// NormalizeImage and DBPostProcess, with the settings from the model's inference.yml.
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];
export const DET_DEFAULTS = {
	/** Long side the photo is scaled to before detection. */
	limitSide: 960,
	/**
	 * A second, coarse detection pass at this long side finds very large glyphs the fine pass
	 * misses: a price's big "1" is just a bar at 960 px, but ordinary text at 320. 0 turns it off.
	 */
	coarseSide: 320,
	/** Probability above which a pixel counts as text. */
	thresh: 0.3,
	/** Minimum mean probability for a region to be kept. */
	boxThresh: 0.6,
	/** How far a region is grown back out to cover the whole text (DB shrinks it in training). */
	unclipRatio: 1.5,
	minSize: 3
};
export type DetOptions = typeof DET_DEFAULTS;

export interface DetInput {
	/** NCHW float tensor data, channels in BGR order as PaddleOCR was trained. */
	data: Float32Array;
	width: number;
	height: number;
	/** Original pixels per detector pixel, per axis. */
	scaleX: number;
	scaleY: number;
}

export function prepareDetection(image: Raster, limitSide = DET_DEFAULTS.limitSide): DetInput {
	const ratio = Math.min(1, limitSide / Math.max(image.width, image.height));
	const round32 = (n: number) => Math.max(32, Math.round(n / 32) * 32);
	const width = round32(image.width * ratio);
	const height = round32(image.height * ratio);
	const small = resize(image, width, height);
	const plane = width * height;
	const data = new Float32Array(3 * plane);
	for (let i = 0; i < plane; i++) {
		// RGBA in, BGR out.
		for (let c = 0; c < 3; c++) {
			data[c * plane + i] = (small.data[i * 4 + (2 - c)] / 255 - MEAN[c]) / STD[c];
		}
	}
	return { data, width, height, scaleX: image.width / width, scaleY: image.height / height };
}

export interface TextRegion extends RotatedRect {
	/** Mean text probability inside the region, 0–1. */
	score: number;
}

/** Convex hull (Andrew's monotone chain) of integer points. */
function convexHull(points: [number, number][]): [number, number][] {
	const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (pts.length < 3) return pts;
	const cross = (o: number[], a: number[], b: number[]) =>
		(a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const lower: [number, number][] = [];
	for (const p of pts) {
		while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
		lower.push(p);
	}
	const upper: [number, number][] = [];
	for (const p of pts.reverse()) {
		while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
		upper.push(p);
	}
	return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Smallest rotated rectangle around the points (rotating calipers over the hull edges). */
export function minAreaRect(points: [number, number][]): RotatedRect {
	const hull = convexHull(points);
	let best: RotatedRect | undefined;
	let bestArea = Infinity;
	const edges = hull.length > 1 ? hull.length : 1;
	for (let i = 0; i < edges; i++) {
		const a = hull[i];
		const b = hull[(i + 1) % hull.length] ?? a;
		const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) || 0;
		const cos = Math.cos(angle);
		const sin = Math.sin(angle);
		let minU = Infinity;
		let maxU = -Infinity;
		let minV = Infinity;
		let maxV = -Infinity;
		for (const [x, y] of hull) {
			const u = x * cos + y * sin;
			const v = -x * sin + y * cos;
			minU = Math.min(minU, u);
			maxU = Math.max(maxU, u);
			minV = Math.min(minV, v);
			maxV = Math.max(maxV, v);
		}
		// Pixel centres: a single row of pixels is one pixel tall, not zero.
		const width = maxU - minU + 1;
		const height = maxV - minV + 1;
		if (width * height < bestArea) {
			bestArea = width * height;
			const u = (minU + maxU) / 2;
			const v = (minV + maxV) / 2;
			best = { cx: u * cos - v * sin, cy: u * sin + v * cos, width, height, angle };
		}
	}
	return normaliseRect(best!);
}

/** Puts the long side along the width, with an angle in (-45°, 45°], so text reads left to right. */
export function normaliseRect(rect: RotatedRect): RotatedRect {
	let { width, height, angle } = rect;
	// Bring the angle into (-90°, 90°].
	while (angle > Math.PI / 2) angle -= Math.PI;
	while (angle <= -Math.PI / 2) angle += Math.PI;
	if (angle > Math.PI / 4) {
		angle -= Math.PI / 2;
		[width, height] = [height, width];
	} else if (angle <= -Math.PI / 4) {
		angle += Math.PI / 2;
		[width, height] = [height, width];
	}
	return { ...rect, width, height, angle };
}

/**
 * Turns the probability map into text regions in original image coordinates: connected
 * regions above `thresh`, scored by mean probability, then grown back by DB's unclip distance
 * (area × ratio ÷ perimeter).
 */
export function findTextRegions(
	prob: Float32Array,
	input: Pick<DetInput, 'width' | 'height' | 'scaleX' | 'scaleY'>,
	options: Partial<DetOptions> = {}
): TextRegion[] {
	const { thresh, boxThresh, unclipRatio, minSize } = { ...DET_DEFAULTS, ...options };
	const { width, height } = input;
	const label = new Int32Array(width * height).fill(-1);
	const regions: TextRegion[] = [];
	const stack: number[] = [];

	for (let start = 0; start < width * height; start++) {
		if (label[start] !== -1 || prob[start] <= thresh) continue;
		// Flood-fill one 8-connected component.
		const points: [number, number][] = [];
		let sum = 0;
		label[start] = regions.length;
		stack.push(start);
		while (stack.length) {
			const i = stack.pop()!;
			const x = i % width;
			const y = (i - x) / width;
			points.push([x, y]);
			sum += prob[i];
			for (let dy = -1; dy <= 1; dy++) {
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
					const j = ny * width + nx;
					if (label[j] === -1 && prob[j] > thresh) {
						label[j] = regions.length;
						stack.push(j);
					}
				}
			}
		}
		const score = sum / points.length;
		const rect = minAreaRect(points);
		if (Math.min(rect.width, rect.height) < minSize || score < boxThresh) continue;

		const distance = (rect.width * rect.height * unclipRatio) / (2 * (rect.width + rect.height));
		const grown = { ...rect, width: rect.width + 2 * distance, height: rect.height + 2 * distance };
		if (Math.min(grown.width, grown.height) < minSize + 2) continue;
		regions.push(scaleRect(grown, input.scaleX, input.scaleY, score));
	}
	return regions;
}

/** Maps a rectangle from detector pixels to original pixels (scales may differ per axis). */
function scaleRect(rect: RotatedRect, sx: number, sy: number, score: number): TextRegion {
	const cos = Math.cos(rect.angle);
	const sin = Math.sin(rect.angle);
	// Scale the two axis vectors and re-measure them.
	const ux = rect.width * cos * sx;
	const uy = rect.width * sin * sy;
	const vx = -rect.height * sin * sx;
	const vy = rect.height * cos * sy;
	return {
		cx: (rect.cx + 0.5) * sx - 0.5,
		cy: (rect.cy + 0.5) * sy - 0.5,
		width: Math.hypot(ux, uy),
		height: Math.hypot(vx, vy),
		angle: Math.atan2(uy, ux),
		score
	};
}

/** Share of `region` covered by any of `others`, sampled on a grid across the region. */
export function coveredShare(region: RotatedRect, others: RotatedRect[], steps = 7): number {
	const cos = Math.cos(region.angle);
	const sin = Math.sin(region.angle);
	let covered = 0;
	for (let i = 0; i < steps; i++) {
		for (let j = 0; j < steps; j++) {
			const u = ((i + 0.5) / steps - 0.5) * region.width;
			const v = ((j + 0.5) / steps - 0.5) * region.height;
			const x = region.cx + u * cos - v * sin;
			const y = region.cy + u * sin + v * cos;
			const inside = others.some((o) => {
				const dx = x - o.cx;
				const dy = y - o.cy;
				const ou = dx * Math.cos(o.angle) + dy * Math.sin(o.angle);
				const ov = -dx * Math.sin(o.angle) + dy * Math.cos(o.angle);
				return Math.abs(ou) <= o.width / 2 && Math.abs(ov) <= o.height / 2;
			});
			if (inside) covered++;
		}
	}
	return covered / (steps * steps);
}
