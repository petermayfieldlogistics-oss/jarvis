// Copies the Tesseract OCR worker, WebAssembly core and English language data
// into public/ocr so the app serves them itself instead of pulling from a CDN.
// That keeps scanning working offline and on networks that block CDNs.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'ocr');

const files = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // Only the LSTM builds are needed (we never use the legacy engine). The worker
  // picks one of these at runtime based on the browser's SIMD support.
  ['tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz'],
];

for (const [from, to] of files) {
  const src = join(nm, from);
  const dest = join(out, to);
  if (!existsSync(src)) {
    console.error(`Missing OCR asset: ${src}. Did you run npm install?`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
console.log(`OCR assets copied to ${out}`);
