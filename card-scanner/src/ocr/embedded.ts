// Single-file build only: runs the OCR engine from code packed into the page,
// so Card-Scanner.html works when opened straight from a computer's disk.
import { coreCode, langGzBase64, workerCode } from 'virtual:ocr-embedded';

/** A made-up address the worker answers itself (see the prelude below). */
export const EMBEDDED_LANG_PATH = 'https://embedded.invalid/tessdata';

/**
 * Build the OCR worker from one blob: a small prelude, then the engine core,
 * then tesseract's worker. With the core already defined, the worker skips
 * downloading it; the prelude serves the language data when the worker
 * fetches it from EMBEDDED_LANG_PATH.
 */
export function embeddedWorkerUrl(): string {
  const prelude = `
    const __langGz = ${JSON.stringify(langGzBase64)};
    const __fetch = self.fetch.bind(self);
    self.fetch = (input, init) =>
      String(input).startsWith(${JSON.stringify(EMBEDDED_LANG_PATH)})
        ? Promise.resolve(new Response(Uint8Array.from(atob(__langGz), (c) => c.charCodeAt(0))))
        : __fetch(input, init);
  `;
  const blob = new Blob([prelude, '\n', coreCode, '\n', workerCode], { type: 'text/javascript' });
  return URL.createObjectURL(blob);
}
