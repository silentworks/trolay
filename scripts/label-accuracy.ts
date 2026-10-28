// Runs every label in fixtures/labels/ through the same OCR engine and parser the app uses,
// and reports accuracy per field. A field is "right", "left empty" (low confidence, so the
// shopper fills it in) or "wrong" (filled in with a bad value — the case that matters most).
//
// Usage: pnpm test:labels [file-name-filter]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
	DETAIL_PARAMS,
	LARGE_PARAMS,
	LARGE_PASS_SCALE,
	toOcrLines
} from '../src/lib/capture/ocr-passes.ts';
import { confident, parseLabel } from '../src/lib/capture/parse-label.ts';

interface Expected {
	description: string;
	unitPriceMinor: number;
	priceIncludesTax: boolean;
}

type Outcome = 'right' | 'empty' | 'wrong';

const require = createRequire(import.meta.url);
const { createWorker, OEM } = require('tesseract.js');
const { version } = require('tesseract.js/package.json');

const dir = 'fixtures/labels';
const filter = process.argv[2] ?? '';
const expected: Record<string, Expected> = JSON.parse(
	readFileSync(join(dir, 'expected.json'), 'utf8')
);

const normalise = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();

// Descriptions only need to be close, since the shopper sees and can correct them: right
// when most of what was read is on the label and it covers at least the product name.
function descriptionMatches(actual: string, wanted: string): boolean {
	const read = normalise(actual).split(' ');
	const want = normalise(wanted).split(' ');
	const precision = read.filter((w) => want.includes(w)).length / read.length;
	const recall = want.filter((w) => read.includes(w)).length / want.length;
	return precision >= 0.75 && recall >= 0.4;
}

const worker = await createWorker('eng', OEM.LSTM_ONLY, {
	langPath: join(process.cwd(), 'static/ocr', version),
	cacheMethod: 'none',
	gzip: true
});

// The app scales in the browser; here ImageMagick makes the one-third-size copy.
const downscale = (path: string) =>
	execFileSync('magick', [path, '-resize', `${LARGE_PASS_SCALE * 100}%`, 'png:-']);

const fields = ['description', 'price', 'vat'] as const;
const tally = Object.fromEntries(
	fields.map((f) => [f, { right: 0, empty: 0, wrong: 0 }])
) as Record<(typeof fields)[number], Record<Outcome, number>>;
const problems: string[] = [];
let total = 0;
let ms = 0;

for (const [file, want] of Object.entries(expected)) {
	if (!file.includes(filter)) continue;
	total++;
	const path = join(dir, file);
	const small = downscale(path);
	const started = performance.now();
	await worker.setParameters(DETAIL_PARAMS);
	const detail = await worker.recognize(path, {}, { blocks: true });
	await worker.setParameters(LARGE_PARAMS);
	const large = await worker.recognize(small, {}, { blocks: true });
	ms += performance.now() - started;

	const passes = [toOcrLines(detail.data), toOcrLines(large.data, LARGE_PASS_SCALE)];
	const reading = parseLabel(...passes);
	if (process.env.DEBUG) {
		for (const [i, lines] of passes.entries())
			for (const l of lines)
				console.log(
					`${file} pass ${i} [${Math.round(l.confidence)} h${Math.round(l.height)}] ${l.text.trim()}`
				);
	}

	const description = confident(reading.description);
	const price = confident(reading.unitPriceMinor);
	// No VAT marker means the store's setting applies: incl. VAT for a normal UK store,
	// excl. for a trade store. Fixtures marked ex VAT come from trade-style labels.
	const vat = confident(reading.priceIncludesTax);
	const outcomes: Record<(typeof fields)[number], Outcome> = {
		description:
			description === undefined
				? 'empty'
				: descriptionMatches(description, want.description)
					? 'right'
					: 'wrong',
		price: price === undefined ? 'empty' : price === want.unitPriceMinor ? 'right' : 'wrong',
		vat:
			vat === undefined
				? want.priceIncludesTax
					? 'right'
					: 'empty'
				: vat === want.priceIncludesTax
					? 'right'
					: 'wrong'
	};
	for (const field of fields) {
		tally[field][outcomes[field]]++;
		if (outcomes[field] !== 'right') {
			problems.push(
				`${file}  ${field}: ${outcomes[field]}  (read ${JSON.stringify(
					field === 'description' ? description : field === 'price' ? price : vat
				)}, expected ${JSON.stringify(
					field === 'description'
						? want.description
						: field === 'price'
							? want.unitPriceMinor
							: want.priceIncludesTax
				)})`
			);
		}
	}
}
await worker.terminate();

const pct = (n: number) => `${Math.round((n / total) * 100)}%`.padStart(4);
console.log(`\n${total} labels, ${Math.round(ms / total)} ms OCR per label on this machine\n`);
console.log('field        right  left empty  wrong');
for (const field of fields) {
	const t = tally[field];
	console.log(`${field.padEnd(12)} ${pct(t.right)}   ${pct(t.empty)}       ${pct(t.wrong)}`);
}
if (problems.length) console.log(`\n${problems.join('\n')}`);

// A confidently wrong price is the failure that would silently mislead the shopper.
if (tally.price.wrong > 0) process.exitCode = 1;
