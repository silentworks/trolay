// Shows how the parser sees one fixture: OCR lines, rows, and its reading. Uses the OCR cache
// written by label-accuracy.ts. Usage: node scripts/label-debug.ts fixtures/labels/real/x.jpg
import { existsSync, readFileSync } from 'node:fs';
import { buildRows } from '../src/lib/capture/label/layout.ts';
import { parseLabel } from '../src/lib/capture/label/parse.ts';
import { cachePath } from './lib/accuracy.ts';
import { loadNodeOcr, readRaster } from './lib/node-ocr.ts';

const path = process.argv[2];
const cache = cachePath(path);
const lines = existsSync(cache)
	? JSON.parse(readFileSync(cache, 'utf8'))
	: await (await loadNodeOcr()).read(readRaster(path));
for (const r of buildRows(lines)) {
	console.log(
		`row cy${Math.round(r.cy)} h${Math.round(r.height)} x${Math.round(r.box.x0)}-${Math.round(r.box.x1)} y${Math.round(r.box.y0)}-${Math.round(r.box.y1)} c${Math.round(r.confidence * 100)}  ${r.tokens.map((t) => `${t.text}:${Math.round(t.confidence * 100)}`).join(' ')}`
	);
}
console.log(JSON.stringify(parseLabel(lines), null, 1));
