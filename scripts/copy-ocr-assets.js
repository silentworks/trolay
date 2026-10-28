// Copies the label reader's runtime files into static/ocr/<id>/ so they are served from our own
// origin and work offline (see scripts/ocr-assets.js). Runs on install (`prepare`) and before
// every build. The copies are not committed.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { OCR_FILES, ocrAssetsId } from './ocr-assets.js';

const outRoot = 'static/ocr';
const id = ocrAssetsId();
const out = join(outRoot, id);

mkdirSync(out, { recursive: true });
// Older versions would otherwise be precached alongside the new one.
for (const name of readdirSync(outRoot)) {
	if (name !== id) rmSync(join(outRoot, name), { recursive: true, force: true });
}
for (const [name, source] of Object.entries(OCR_FILES)) copyFileSync(source, join(out, name));
