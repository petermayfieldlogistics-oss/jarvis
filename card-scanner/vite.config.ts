import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);

/**
 * `virtual:ocr-embedded` — the OCR engine and its English data as strings, so
 * the single-file build (scripts/build-single.mjs) needs nothing but itself.
 * Only loaded by that build; the normal build fetches these files instead.
 */
function embeddedOcr(): Plugin {
  const id = 'virtual:ocr-embedded';
  return {
    name: 'ocr-embedded',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load(loadId) {
      if (loadId !== `\0${id}`) return;
      const file = (p: string) => readFileSync(require.resolve(p));
      return [
        `export const workerCode = ${JSON.stringify(file('tesseract.js/dist/worker.min.js').toString('utf8'))};`,
        // SIMD build: supported by every current browser (Safari 16.4+).
        `export const coreCode = ${JSON.stringify(file('tesseract.js-core/tesseract-core-simd-lstm.wasm.js').toString('utf8'))};`,
        `export const langGzBase64 = ${JSON.stringify(file('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz').toString('base64'))};`,
      ].join('\n');
    },
  };
}

export default defineConfig({
  // Relative base so the same build works at a GitHub Pages sub-path
  // (https://<user>.github.io/<repo>/) or at a domain root.
  base: './',
  plugins: [react(), embeddedOcr()],
  test: {
    environment: 'node',
  },
});
