// Measures the label reader on fixture photos, through the same OCR engine and parser as the
// app, and scores every field strictly:
//   right  the value filled in is exactly right (descriptions ignoring case and spacing),
//   empty  left for the shopper because the reader was not sure,
//   wrong  filled in with a wrong value: the failure that matters, and must stay at zero.
// For each set it prints a 95% upper bound on the wrong-fill rate (Wilson score interval), so a
// clean run says how rare mistakes must be, not just that none happened to occur.
//
// Usage: pnpm test:labels [set...] [--filter text] [--verbose] [--no-cache]
//   sets: real, dev, test, holdout (default: all). Each is a folder in fixtures/labels with expected.json.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filledFields, parseLabel, type LabelReading } from '../src/lib/capture/label/parse.ts';
import { readCached, wilsonUpper } from './lib/accuracy.ts';
import { loadNodeOcr } from './lib/node-ocr.ts';

interface Expected {
	/** Acceptable descriptions; a brand line under the product name may be in or out. */
	description: string[];
	unitPriceMinor: number;
	/** The VAT marker printed on the label, or null when there is none. */
	vat: 'inc' | 'ex' | null;
	barcode?: string;
}

type Outcome = 'right' | 'empty' | 'wrong';
const FIELDS = ['price', 'description', 'vat'] as const;
type Field = (typeof FIELDS)[number];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const filter = option('--filter') ?? '';
const sets = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--filter');
const ROOT = 'fixtures/labels';

const normalise = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, '');

function score(reading: LabelReading, want: Expected): Record<Field, Outcome> {
	const filled = filledFields(reading);
	const price = filled.unitPriceMinor;
	const description = filled.description;
	const vat = filled.priceIncludesTax;
	const wantVat = want.vat === null ? undefined : want.vat === 'inc';
	return {
		price: price === undefined ? 'empty' : price === want.unitPriceMinor ? 'right' : 'wrong',
		description:
			description === undefined
				? 'empty'
				: want.description.some((d) => normalise(d) === normalise(description))
					? 'right'
					: 'wrong',
		// No marker on the label: the right answer is to say nothing (the store's setting applies).
		vat: vat === wantVat ? 'right' : vat === undefined ? 'empty' : 'wrong'
	};
}

const ocr = await loadNodeOcr();

let failed = false;
const names = sets.length ? sets : ['real', 'dev', 'test', 'holdout'];
for (const set of names) {
	const dir = join(ROOT, set);
	if (!existsSync(join(dir, 'expected.json'))) continue;
	const expected: Record<string, Expected> = JSON.parse(
		readFileSync(join(dir, 'expected.json'), 'utf8')
	);
	const tally = Object.fromEntries(
		FIELDS.map((f) => [f, { right: 0, empty: 0, wrong: 0 }])
	) as Record<Field, Record<Outcome, number>>;
	const problems: string[] = [];
	let total = 0;
	let complete = 0;
	let ocrMs = 0;
	let ocrRuns = 0;

	const missing = Object.keys(expected).filter((file) => !existsSync(join(dir, file)));
	if (missing.length) {
		console.log(
			`\n== ${set}: ${missing.length} photos missing; run \`pnpm fixtures:labels\` first`
		);
		failed = true;
		continue;
	}
	for (const [file, want] of Object.entries(expected)) {
		if (!file.includes(filter)) continue;
		total++;
		const { lines, ms } = await readCached(ocr, join(dir, file), !flag('--no-cache'));
		if (ms) {
			ocrMs += ms;
			ocrRuns++;
		}
		const reading = parseLabel(lines);
		const outcome = score(reading, want);
		for (const f of FIELDS) tally[f][outcome[f]]++;
		if (outcome.price === 'right' && outcome.description === 'right') complete++;
		const bad = FIELDS.filter((f) => outcome[f] !== 'right');
		if (bad.length || flag('--verbose')) {
			const got = {
				price: reading.unitPriceMinor,
				description: reading.description,
				vat: reading.priceIncludesTax
			};
			const wanted = { price: want.unitPriceMinor, description: want.description, vat: want.vat };
			const report = FIELDS.map(
				(f) =>
					`  ${outcome[f].padEnd(5)} ${f.padEnd(11)} read ${JSON.stringify(got[f])}  expected ${JSON.stringify(wanted[f])}`
			);
			if (reading.checks.length) report.push(`  checks: ${reading.checks.join('; ')}`);
			if (flag('--verbose')) {
				for (const l of lines) {
					report.push(
						`    [${Math.round(l.confidence * 100)} h${Math.round(l.region.height)}] ${l.text}`
					);
				}
			}
			problems.push(`${file}\n${report.join('\n')}`);
		}
	}
	if (!total) continue;

	const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`.padStart(7);
	const speed = ocrRuns ? `, ${Math.round(ocrMs / ocrRuns)} ms OCR per label` : '';
	console.log(`\n== ${set}: ${total} labels${speed}`);
	console.log('field          right   empty   wrong   wrong fills (95% upper bound on rate)');
	for (const f of FIELDS) {
		const t = tally[f];
		const filled = t.right + t.wrong;
		const bound = (wilsonUpper(t.wrong, filled) * 100).toFixed(1);
		console.log(
			`${f.padEnd(12)} ${pct(t.right)} ${pct(t.empty)} ${pct(t.wrong)}   ${t.wrong} of ${filled} (≤ ${bound}%)`
		);
	}
	console.log(`price and description both right: ${pct(complete).trim()}`);
	if (problems.length) console.log('\n' + problems.join('\n'));
	if (FIELDS.some((f) => tally[f].wrong > 0)) failed = true;
}
await ocr.release();
// A field filled in wrongly would silently mislead the shopper.
if (failed) process.exitCode = 1;
