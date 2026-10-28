// Measures the receipt reader on fixture photos, through the same OCR engine and parser as the
// app, and scores the total strictly, like the label check:
//   right  the total filled in is exactly right, to the penny,
//   empty  left for the shopper because the reader was not sure,
//   wrong  filled in with a wrong total, or with any total when the photo shows none. Must stay
//          at zero: the check fails otherwise.
//
// Usage: pnpm test:receipts [set...] [--filter text] [--verbose] [--no-cache]
//   sets: real, dev, test (default: all). Each is a folder in fixtures/receipts with expected.json.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildRows } from '../src/lib/capture/label/layout.ts';
import { parseReceipt } from '../src/lib/capture/receipt/parse.ts';
import { readCached, wilsonUpper } from './lib/accuracy.ts';
import { loadNodeOcr } from './lib/node-ocr.ts';

interface Expected {
	/** The total paid in pence, or null when the photo does not show one (e.g. only a subtotal). */
	totalMinor: number | null;
}

type Outcome = 'right' | 'empty' | 'wrong';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const filter = option('--filter') ?? '';
const sets = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--filter');
const ROOT = 'fixtures/receipts';

const ocr = await loadNodeOcr();
let failed = false;
for (const set of sets.length ? sets : ['real', 'dev', 'test']) {
	const dir = join(ROOT, set);
	if (!existsSync(join(dir, 'expected.json'))) continue;
	const expected: Record<string, Expected> = JSON.parse(
		readFileSync(join(dir, 'expected.json'), 'utf8')
	);
	const missing = Object.keys(expected).filter((file) => !existsSync(join(dir, file)));
	if (missing.length) {
		console.log(`\n== ${set}: ${missing.length} photos missing; run \`pnpm fixtures:receipts\``);
		failed = true;
		continue;
	}

	const tally: Record<Outcome, number> = { right: 0, empty: 0, wrong: 0 };
	let confirmed = 0;
	let none = 0;
	let filled = 0;
	let ocrMs = 0;
	let ocrRuns = 0;
	const problems: string[] = [];
	for (const [file, want] of Object.entries(expected)) {
		if (!file.includes(filter)) continue;
		const { lines, ms } = await readCached(ocr, join(dir, file), !flag('--no-cache'));
		if (ms) {
			ocrMs += ms;
			ocrRuns++;
		}
		const reading = parseReceipt(lines);
		const got = reading.totalMinor;
		// With no total on the photo, leaving it empty is the right answer.
		const outcome: Outcome =
			got === undefined
				? want.totalMinor === null
					? 'right'
					: 'empty'
				: got === want.totalMinor
					? 'right'
					: 'wrong';
		tally[outcome]++;
		if (got !== undefined) filled++;
		if (want.totalMinor === null) none++;
		if (outcome === 'right' && reading.confirmedByPayment) confirmed++;
		if (outcome !== 'right' || flag('--verbose')) {
			const report = [
				`${file}\n  ${outcome.padEnd(5)} read ${got ?? '—'}  expected ${want.totalMinor ?? 'none'}` +
					`  (confidence ${reading.confidence.toFixed(2)}${reading.confirmedByPayment ? ', confirmed by payment' : ''})`
			];
			if (flag('--verbose')) {
				for (const row of buildRows(lines)) {
					report.push(
						`    [${Math.round(row.confidence * 100)} h${Math.round(row.height)}] ${row.text}`
					);
				}
			}
			problems.push(report.join('\n'));
		}
	}
	const total = tally.right + tally.empty + tally.wrong;
	if (!total) continue;
	const pct = (n: number) => `${((n / total) * 100).toFixed(1)}%`;
	const speed = ocrRuns ? `, ${Math.round(ocrMs / ocrRuns)} ms OCR per receipt` : '';
	console.log(`\n== ${set}: ${total} receipts (${none} with no total to find)${speed}`);
	console.log(
		`total  right ${pct(tally.right)}  empty ${pct(tally.empty)}  wrong ${pct(tally.wrong)}` +
			`   wrong fills ${tally.wrong} of ${filled} (≤ ${(wilsonUpper(tally.wrong, filled) * 100).toFixed(1)}%)`
	);
	console.log(`confirmed by the payment lines: ${confirmed} of ${tally.right} right`);
	if (problems.length) console.log('\n' + problems.join('\n'));
	if (tally.wrong > 0) failed = true;
}
await ocr.release();
// A wrong total would hide or invent a receipt mismatch.
if (failed) process.exitCode = 1;
