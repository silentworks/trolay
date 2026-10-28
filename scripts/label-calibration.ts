// Calibration report: for every fixture in a set (default dev), the description and price the
// parser picked before any threshold, whether each is right, and its confidence measures. Used to
// choose the thresholds in label/parse.ts on dev only. Reads the OCR cache from label-accuracy.ts.
// Usage: node scripts/label-calibration.ts [set]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLabel } from '../src/lib/capture/label/parse.ts';

const set = process.argv[2] ?? 'dev';
const dir = join('fixtures/labels', set);
const version = /ENGINE_VERSION = '([^']+)'/.exec(
	readFileSync('scripts/label-accuracy.ts', 'utf8')
)![1];
const expected: Record<string, { description: string[]; unitPriceMinor: number }> = JSON.parse(
	readFileSync(join(dir, 'expected.json'), 'utf8')
);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const rows: {
	field: string;
	right: boolean;
	min: number;
	mean: number;
	file: string;
	value: string;
}[] = [];
for (const [file, want] of Object.entries(expected)) {
	const key = createHash('sha1')
		.update(version)
		.update(readFileSync(join(dir, file)))
		.digest('hex');
	const cache = `.cache/ocr/${key}.json`;
	if (!existsSync(cache)) continue;
	const reading = parseLabel(JSON.parse(readFileSync(cache, 'utf8')));
	if (reading.description) {
		const d = reading.description;
		rows.push({
			field: 'description',
			right: want.description.some((w: string) => norm(w) === norm(d.value)),
			min: d.confidence,
			mean: d.meanConfidence,
			file,
			value: d.value
		});
	}
	if (reading.unitPriceMinor) {
		const p = reading.unitPriceMinor;
		rows.push({
			field: 'price',
			right: p.value === want.unitPriceMinor,
			min: p.confidence,
			mean: p.confidence,
			file,
			value: String(p.value)
		});
	}
}
for (const field of ['price', 'description']) {
	const r = rows.filter((x) => x.field === field);
	console.log(`\n== ${field}: ${r.length} picked, ${r.filter((x) => x.right).length} right`);
	for (const measure of ['min', 'mean'] as const) {
		const wrong = r
			.filter((x) => !x.right)
			.map((x) => x[measure])
			.sort((a, b) => b - a);
		console.log(
			`  ${measure}: highest wrong ${
				wrong
					.slice(0, 5)
					.map((v) => v.toFixed(3))
					.join(', ') || '-'
			}`
		);
		for (const t of [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
			const filled = r.filter((x) => x[measure] >= t);
			console.log(
				`    ≥ ${t.toFixed(2)}: fills ${filled.filter((x) => x.right).length} right, ${filled.filter((x) => !x.right).length} wrong`
			);
		}
	}
	for (const x of r.filter((x) => !x.right)) {
		console.log(
			`  wrong: ${x.file} min ${x.min.toFixed(3)} mean ${x.mean.toFixed(3)}  "${x.value}"`
		);
	}
}
