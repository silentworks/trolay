/** An RGBA image in memory: canvas ImageData in the browser, decoded pixels in Node. */
export interface Raster {
	width: number;
	height: number;
	/** RGBA, 4 bytes per pixel, row by row. */
	data: Uint8ClampedArray | Uint8Array;
}

/** A rotated rectangle: centre, size along its own axes, and angle of the width axis (radians). */
export interface RotatedRect {
	cx: number;
	cy: number;
	width: number;
	height: number;
	angle: number;
}

/** Bilinear sample of one channel at a fractional position, clamped to the image. */
export function sample(image: Raster, x: number, y: number, channel: number): number {
	const { width, height, data } = image;
	const fx = Math.min(Math.max(x, 0), width - 1);
	const fy = Math.min(Math.max(y, 0), height - 1);
	const x0 = Math.floor(fx);
	const y0 = Math.floor(fy);
	const x1 = Math.min(x0 + 1, width - 1);
	const y1 = Math.min(y0 + 1, height - 1);
	const dx = fx - x0;
	const dy = fy - y0;
	const at = (px: number, py: number) => data[(py * width + px) * 4 + channel];
	const top = at(x0, y0) * (1 - dx) + at(x1, y0) * dx;
	const bottom = at(x0, y1) * (1 - dx) + at(x1, y1) * dx;
	return top * (1 - dy) + bottom * dy;
}

/** Resizes with area averaging when shrinking (no aliasing) and bilinear when enlarging. */
export function resize(image: Raster, width: number, height: number): Raster {
	const out = new Uint8ClampedArray(width * height * 4);
	const sx = image.width / width;
	const sy = image.height / height;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			if (sx <= 1 && sy <= 1) {
				for (let c = 0; c < 4; c++) {
					out[o + c] = sample(image, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, c);
				}
				continue;
			}
			// Average the source pixels this output pixel covers.
			const x0 = Math.floor(x * sx);
			const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
			const y0 = Math.floor(y * sy);
			const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
			const sums = [0, 0, 0, 0];
			for (let yy = y0; yy < y1; yy++) {
				for (let xx = x0; xx < x1; xx++) {
					const i = (yy * image.width + xx) * 4;
					for (let c = 0; c < 4; c++) sums[c] += image.data[i + c];
				}
			}
			const n = (x1 - x0) * (y1 - y0);
			for (let c = 0; c < 4; c++) out[o + c] = sums[c] / n;
		}
	}
	return { width, height, data: out };
}

/** The four corners of a rotated rectangle, clockwise from top-left. */
export function corners(rect: RotatedRect): [number, number][] {
	const cos = Math.cos(rect.angle);
	const sin = Math.sin(rect.angle);
	const hw = rect.width / 2;
	const hh = rect.height / 2;
	return [
		[-hw, -hh],
		[hw, -hh],
		[hw, hh],
		[-hw, hh]
	].map(([u, v]) => [rect.cx + u * cos - v * sin, rect.cy + u * sin + v * cos]);
}

/** Axis-aligned bounds of a rotated rectangle. */
export function bounds(rect: RotatedRect): { x0: number; y0: number; x1: number; y1: number } {
	const pts = corners(rect);
	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	return {
		x0: Math.min(...xs),
		y0: Math.min(...ys),
		x1: Math.max(...xs),
		y1: Math.max(...ys)
	};
}
