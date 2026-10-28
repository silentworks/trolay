// Copies the Tesseract.js worker, WebAssembly core and English language data into
// static/ocr/<version>/, so label reading is served from our own origin and works offline.
// Runs on install (`prepare`) and before every build. The files are not committed.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const tesseractDir = dirname(require.resolve('tesseract.js/package.json'));
const coreDir = dirname(
	createRequire(join(tesseractDir, 'package.json')).resolve('tesseract.js-core/package.json')
);
const langDir = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
const { version } = require('tesseract.js/package.json');

const outRoot = 'static/ocr';
const out = join(outRoot, version);

mkdirSync(out, { recursive: true });
// Old versions would otherwise be precached alongside the new one.
for (const name of readdirSync(outRoot)) {
	if (name !== version) rmSync(join(outRoot, name), { recursive: true, force: true });
}

copyFileSync(join(tesseractDir, 'dist/worker.min.js'), join(out, 'worker.min.js'));
// Wasm SIMD is in every browser the app supports (Chrome 91+, Safari 16.4+), and the
// LSTM-only build is all the integer "best" model needs.
copyFileSync(
	join(coreDir, 'tesseract-core-simd-lstm.wasm.js'),
	join(out, 'tesseract-core-simd-lstm.wasm.js')
);
copyFileSync(join(langDir, '4.0.0_best_int/eng.traineddata.gz'), join(out, 'eng.traineddata.gz'));
