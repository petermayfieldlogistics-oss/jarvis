import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';

export type ProgressFn = (status: string, progress: number) => void;

let workerPromise: Promise<Worker> | null = null;
let listener: ProgressFn | null = null;

function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/** Start (or reuse) the OCR engine. First call downloads ~4 MB, then it's cached. */
export function getOcrWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      // Served from our own site (see scripts/copy-ocr-assets.mjs), not a CDN.
      workerPath: assetUrl('ocr/worker.min.js'),
      corePath: assetUrl('ocr/core/'),
      langPath: assetUrl('ocr/lang'),
      gzip: true,
      logger: (m) => listener?.(m.status, m.progress),
    });
    await worker.setParameters({
      // Cards have scattered bits of text rather than paragraphs.
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
      // Sauvola local thresholding copes better with foil glare and
      // gradients than a single global threshold.
      thresholding_method: '2',
      // Our crops are normalised to roughly 300 DPI; saying so skips a noisy guess.
      user_defined_dpi: '300',
    });
    return worker;
  })();
  workerPromise.catch(() => (workerPromise = null));
  return workerPromise;
}

export interface OcrLine {
  text: string;
  confidence: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Height of the line's box in pixels — card names are printed large. */
  height: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  timedOut?: boolean;
}

class OcrTimeout extends Error {}

/**
 * OCR one image. Busy, noisy images can make Tesseract crawl, so a read that
 * runs past `timeoutMs` is abandoned and comes back empty (the engine
 * restarts on the next read). The first-run download doesn't count.
 */
export async function readText(image: HTMLCanvasElement, onProgress?: ProgressFn, timeoutMs = 12000): Promise<OcrResult> {
  // Set before starting the worker so first-run download progress is reported too.
  listener = onProgress ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const worker = await getOcrWorker();
    const recognition = worker.recognize(image, {}, { text: true, blocks: true });
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new OcrTimeout()), timeoutMs);
    });
    let data: Awaited<typeof recognition>['data'];
    try {
      ({ data } = await Promise.race([recognition, deadline]));
    } catch (err) {
      if (!(err instanceof OcrTimeout)) throw err;
      // Tesseract can't be interrupted mid-page; replace the worker instead.
      recognition.catch(() => {});
      workerPromise = null;
      void worker.terminate().catch(() => {});
      return { text: '', lines: [], timedOut: true };
    }
    const lines = (data.blocks ?? [])
      .flatMap((b) => b.paragraphs)
      .flatMap((p) => p.lines)
      .map((l) => ({ text: l.text.trim(), confidence: l.confidence, box: l.bbox, height: l.bbox.y1 - l.bbox.y0 }))
      .filter((l) => l.text);
    return { text: data.text ?? '', lines };
  } finally {
    clearTimeout(timer);
    listener = null;
  }
}
