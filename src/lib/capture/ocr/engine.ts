import {
	coveredShare,
	DET_DEFAULTS,
	findTextRegions,
	prepareDetection,
	type DetOptions,
	type TextRegion
} from './detect.ts';
import { corners, type Raster, type RotatedRect } from './raster.ts';
import { decodeCtc, prepareRecognition, REC_HEIGHT, type DecodedChar } from './recognize.ts';

/** The parts of onnxruntime (onnxruntime-web in the app, onnxruntime-node in scripts) we use. */
export interface OrtTensor {
	readonly dims: readonly number[];
	readonly data: unknown;
}
export interface OrtSession {
	readonly inputNames: readonly string[];
	readonly outputNames: readonly string[];
	run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
	release(): Promise<void>;
}
export interface OrtModule {
	InferenceSession: { create(model: Uint8Array, options?: object): Promise<OrtSession> };
	Tensor: new (type: 'float32', data: Float32Array, dims: readonly number[]) => OrtTensor;
}

export interface OcrWord {
	text: string;
	/** 0–1: the lowest character confidence in the word. */
	confidence: number;
	/** Corners in image pixels, clockwise from top-left. */
	box: [number, number][];
}

export interface TextLine {
	text: string;
	/** 0–1: mean character confidence (scaled by agreement when the line was read several ways). */
	confidence: number;
	/** The detected region in image pixels; `height` is the text's cap-to-descender height. */
	region: RotatedRect;
	words: OcrWord[];
}

export interface OcrModels {
	detection: Uint8Array;
	recognition: Uint8Array;
	/** The recogniser's character list, one entry per class after the CTC blank. */
	dictionary: string[];
}

export interface PaddleOcr {
	read(image: Raster, options?: Partial<DetOptions>): Promise<TextLine[]>;
	release(): Promise<void>;
}

/** Splits a decoded line into words with boxes placed along the line by character position. */
function toWords(
	chars: ReturnType<typeof decodeCtc>,
	region: RotatedRect,
	contentWidth: number
): OcrWord[] {
	const words: OcrWord[] = [];
	let current: typeof chars = [];
	const flush = () => {
		if (!current.length) return;
		// Half a character's width either side of the first and last character centres.
		const pad = 0.5 / Math.max(1, (contentWidth / REC_HEIGHT) * 1.6);
		const start = Math.max(0, current[0].position - pad);
		const end = Math.min(1, current.at(-1)!.position + pad);
		const width = (end - start) * region.width;
		const offset = (start + end) / 2 - 0.5;
		const cos = Math.cos(region.angle);
		const sin = Math.sin(region.angle);
		words.push({
			text: current.map((c) => c.char).join(''),
			confidence: Math.min(...current.map((c) => c.confidence)),
			box: corners({
				cx: region.cx + offset * region.width * cos,
				cy: region.cy + offset * region.width * sin,
				width,
				height: region.height,
				angle: region.angle
			}) as [number, number][]
		});
		current = [];
	};
	for (const c of chars) {
		if (c.char === ' ') flush();
		else current.push(c);
	}
	flush();
	return words;
}

// Crop variants for regions read by vote: tighter heights (the detector's margin is generous
// for big text), and a little extra width (never narrower, which can clip a thin last letter).
const VOTE_HEIGHTS = [0.5, 0.6, 0.7, 0.85];
const VOTE_WIDTHS = [1, 1.08];
/** Regions whose angle differs from the label's tilt by more than this are also read at the tilt. */
const TILT_TOLERANCE = (1 * Math.PI) / 180;
const MAX_VOTED_REGIONS = 3;
/** Each of the three quick crops must be at least this sure for the vote to stop early. */
const UNANIMOUS_CONFIDENCE = 0.9;
/** Crops per recognition call; bigger batches gain little and use more memory. */
const MAX_BATCH = 16;
/** Only short readings are voted on: prices, not description lines. */
const MAX_VOTED_CHARS = 8;

/** PP-OCRv5 text detection and recognition on ONNX Runtime. */
export async function createPaddleOcr(
	ort: OrtModule,
	models: OcrModels,
	// Errors only: the converted models trigger harmless "unused initializer" warnings.
	sessionOptions: object = { logSeverityLevel: 3 }
): Promise<PaddleOcr> {
	const [det, rec] = await Promise.all([
		ort.InferenceSession.create(models.detection, sessionOptions),
		ort.InferenceSession.create(models.recognition, sessionOptions)
	]);

	type Reading = {
		chars: DecodedChar[];
		contentWidth: number;
		text: string;
		/** Mean character confidence. */
		confidence: number;
	};

	/**
	 * Reads many regions at once. Crops are grouped by padded width (most are the minimum, 320)
	 * and each group runs as one batch: WebAssembly inference has a high cost per call, so this
	 * is several times faster than one call per crop, with the same padding as a single crop.
	 */
	async function recogniseAll(image: Raster, regions: RotatedRect[]): Promise<(Reading | null)[]> {
		const crops = regions.map((region) => prepareRecognition(image, region));
		const results: (Reading | null)[] = new Array(regions.length).fill(null);
		const groups = new Map<number, number[]>();
		crops.forEach((crop, i) => groups.set(crop.width, [...(groups.get(crop.width) ?? []), i]));
		for (const [width, members] of groups) {
			for (let start = 0; start < members.length; start += MAX_BATCH) {
				const batch = members.slice(start, start + MAX_BATCH);
				const size = 3 * REC_HEIGHT * width;
				const data = new Float32Array(batch.length * size);
				batch.forEach((i, b) => data.set(crops[i].data, b * size));
				const out = await run(rec, data, [batch.length, 3, REC_HEIGHT, width]);
				const [, steps, classes] = out.dims;
				batch.forEach((i, b) => {
					const probs = out.data.subarray(b * steps * classes, (b + 1) * steps * classes);
					const chars = decodeCtc(
						probs,
						steps,
						classes,
						models.dictionary,
						crops[i].contentWidth / width
					);
					const real = chars.filter((c) => c.char !== ' ');
					if (!real.length) return;
					results[i] = {
						chars,
						contentWidth: crops[i].contentWidth,
						text: chars
							.map((c) => c.char)
							.join('')
							.trim(),
						confidence: real.reduce((s, c) => s + c.confidence, 0) / real.length
					};
				});
			}
		}
		return results;
	}

	/**
	 * Big, short text (the price) is easily misread from a single crop: the detector's margin is
	 * generous for big text, and its angle is poorly measured on a few wide glyphs, so "£1.99" can
	 * come back as "1.9". Such regions are read in several crops (tighter heights, a little extra
	 * width, and the label's own tilt when it differs) and the readings vote, weighted by their
	 * confidence. The winner's confidence is scaled by its share of the weight.
	 */
	function variantsOf(region: RotatedRect, tilt: number | undefined): RotatedRect[] {
		const angles = [region.angle];
		if (tilt !== undefined && Math.abs(tilt - region.angle) > TILT_TOLERANCE) angles.push(tilt);
		return angles.flatMap((angle) =>
			VOTE_HEIGHTS.flatMap((h) =>
				VOTE_WIDTHS.map((w) => ({
					...region,
					angle,
					height: region.height * h,
					width: region.width * w
				}))
			)
		);
	}

	/** Three tight crops at the label's tilt: the crops that read big text best. */
	function quickVariantsOf(region: RotatedRect, tilt: number | undefined): RotatedRect[] {
		const angle = tilt ?? region.angle;
		return [
			{ ...region, angle, height: region.height * 0.55 },
			{ ...region, angle, height: region.height * 0.65, width: region.width * 1.08 },
			{ ...region, angle, height: region.height * 0.75 }
		];
	}

	/** All crops read the same text, each confidently. */
	function unanimous(readings: (Reading | null)[]): boolean {
		const keys = readings.map(
			(r) => r && r.confidence >= UNANIMOUS_CONFIDENCE && r.text.replace(/\s/g, '')
		);
		return keys.every((k) => k && k === keys[0]);
	}

	function vote(variants: RotatedRect[], readings: (Reading | null)[]) {
		const tally = new Map<string, { weight: number; best: number }>();
		let total = 0;
		readings.forEach((reading, i) => {
			if (!reading) return;
			total += reading.confidence;
			const key = reading.text.replace(/\s/g, '');
			const entry = tally.get(key) ?? { weight: 0, best: i };
			entry.weight += reading.confidence;
			if (reading.confidence > readings[entry.best]!.confidence) entry.best = i;
			tally.set(key, entry);
		});
		const winner = [...tally.values()].sort((a, b) => b.weight - a.weight)[0];
		if (!winner) return null;
		const reading = readings[winner.best]!;
		const share = winner.weight / total;
		return {
			...reading,
			region: variants[winner.best],
			confidence: reading.confidence * share,
			share
		};
	}

	async function run(session: OrtSession, data: Float32Array, dims: number[]) {
		const output = await session.run({
			[session.inputNames[0]]: new ort.Tensor('float32', data, dims)
		});
		const tensor = output[session.outputNames[0]];
		return { data: tensor.data as Float32Array, dims: tensor.dims };
	}

	return {
		async read(image, options = {}) {
			const { limitSide, coarseSide } = { ...DET_DEFAULTS, ...options };
			const detect = async (side: number) => {
				const input = prepareDetection(image, side);
				const prob = await run(det, input.data, [1, 3, input.height, input.width]);
				return findTextRegions(prob.data, input, options);
			};
			const regions: TextRegion[] = await detect(limitSide);
			if (coarseSide && Math.max(image.width, image.height) > coarseSide * 1.5) {
				// Keep only what the fine pass did not already find.
				const fine = [...regions];
				for (const region of await detect(coarseSide)) {
					if (coveredShare(region, fine) < 0.4) regions.push(region);
				}
			}

			const firstReadings = await recogniseAll(image, regions);
			const first = regions.map((region, i) => ({ region, reading: firstReadings[i] }));
			// The regions most likely to hold the price: the biggest text, and the biggest with digits.
			const heights = first.map((f) => f.region.height).sort((a, b) => a - b);
			const median = heights[Math.floor(heights.length / 2)] ?? 0;
			const byHeight = first
				.filter((f) => (f.reading?.text.replace(/\s/g, '').length ?? 0) <= MAX_VOTED_CHARS)
				.sort((a, b) => b.region.height - a.region.height);
			// Only big text: small print reads reliably from one crop.
			const big = byHeight.filter((f) => f.region.height >= 1.3 * median);
			const voted = new Set(
				[
					...big.filter((f) => f.region.height >= 1.5 * median),
					...big.filter((f) => /\d/.test(f.reading?.text ?? ''))
				].slice(0, MAX_VOTED_REGIONS)
			);

			// The label's tilt: the median angle of long lines of text, which measure it well.
			const long = regions.filter((r) => r.width >= 4 * r.height).map((r) => r.angle);
			long.sort((a, b) => a - b);
			const tilt = long.length >= 2 ? long[Math.floor(long.length / 2)] : undefined;

			// Voting is adaptive: three quite different crops first; when they agree confidently
			// the rest would only confirm it. Otherwise every variant is read. Batched throughout.
			const votes = new Map<(typeof first)[number], ReturnType<typeof vote>>();
			const readVotes = async (
				entries: (typeof first)[number][],
				pick: (r: RotatedRect) => RotatedRect[]
			) => {
				const variants = entries.map((f) => pick(f.region));
				const readings = await recogniseAll(image, variants.flat());
				let offset = 0;
				return entries.map((f, i) => {
					const count = variants[i].length;
					const result = {
						f,
						variants: variants[i],
						readings: readings.slice(offset, offset + count)
					};
					offset += count;
					return result;
				});
			};
			const quick = await readVotes([...voted], (r) => quickVariantsOf(r, tilt));
			const undecided = quick.filter(({ readings }) => !unanimous(readings));
			for (const { f, variants, readings } of quick) {
				if (!undecided.some((u) => u.f === f)) votes.set(f, vote(variants, readings));
			}
			for (const { f, variants, readings } of await readVotes(
				undecided.map((u) => u.f),
				(r) => variantsOf(r, tilt)
			)) {
				votes.set(f, vote(variants, readings));
			}

			const lines: TextLine[] = [];
			for (const f of first) {
				const reading = voted.has(f)
					? votes.get(f)
					: f.reading && { ...f.reading, region: f.region, share: 1 };
				if (!reading?.text) continue;
				lines.push({
					text: reading.text,
					confidence: reading.confidence,
					region: f.region,
					// A split vote makes every word in the line as doubtful as the line.
					words: toWords(reading.chars, reading.region, reading.contentWidth).map((w) => ({
						...w,
						confidence: w.confidence * reading.share
					}))
				});
			}
			// Reading order: top to bottom, then left to right within a band of the same text.
			return lines.sort((a, b) => {
				const sameRow =
					Math.abs(a.region.cy - b.region.cy) < Math.min(a.region.height, b.region.height) / 2;
				return sameRow ? a.region.cx - b.region.cx : a.region.cy - b.region.cy;
			});
		},
		async release() {
			await Promise.all([det.release(), rec.release()]);
		}
	};
}
