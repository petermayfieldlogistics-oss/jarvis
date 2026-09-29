/** Standard trading card proportions (63 × 88 mm). */
export const CARD_ASPECT = 63 / 88;

/** Normalised card size we crop every scan to before reading regions off it. */
export const CARD_W = 1000;
export const CARD_H = Math.round(CARD_W / CARD_ASPECT);

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not supported in this browser');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/**
 * Where the on-screen card guide lands in the camera frame. The <video> uses
 * object-fit: cover, so part of the frame is cropped off-screen.
 */
export function guideToVideoRect(
  video: { videoWidth: number; videoHeight: number },
  element: { width: number; height: number },
  guide: Rect,
): Rect {
  const scale = Math.max(element.width / video.videoWidth, element.height / video.videoHeight);
  const offX = (video.videoWidth * scale - element.width) / 2;
  const offY = (video.videoHeight * scale - element.height) / 2;
  return {
    x: (guide.x + offX) / scale,
    y: (guide.y + offY) / scale,
    w: guide.w / scale,
    h: guide.h / scale,
  };
}

/** Crop `rect` out of `source` and stretch it to the normalised card size. */
export function cropCard(source: CanvasImageSource, rect: Rect): HTMLCanvasElement {
  const c = makeCanvas(CARD_W, CARD_H);
  ctx2d(c).drawImage(source, rect.x, rect.y, rect.w, rect.h, 0, 0, CARD_W, CARD_H);
  return c;
}

/** Scale an image so its longest side is at most `maxSide` (never upscales). */
export function fitImage(source: CanvasImageSource & { width: number; height: number }, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const c = makeCanvas(source.width * scale, source.height * scale);
  ctx2d(c).drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export type Polarity = 'auto' | 'normal' | 'inverted';

/**
 * Cut a horizontal band out of the card (fractions of card height/width),
 * upscale it and clean it up for OCR: greyscale and stretch contrast.
 * OCR wants dark text on a light background, so `polarity` can flip it —
 * Magic's black border has white text. 'auto' flips mostly-dark bands.
 */
export function cardRegion(
  card: HTMLCanvasElement,
  region: { top: number; bottom: number; left?: number; right?: number },
  scale: number,
  polarity: Polarity = 'auto',
): { canvas: HTMLCanvasElement; inverted: boolean } {
  const sx = (region.left ?? 0) * card.width;
  const sw = ((region.right ?? 1) - (region.left ?? 0)) * card.width;
  const sy = region.top * card.height;
  const sh = (region.bottom - region.top) * card.height;
  const c = makeCanvas(sw * scale, sh * scale);
  const ctx = ctx2d(c);
  ctx.drawImage(card, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const inverted = enhanceForOcr(ctx, c.width, c.height, polarity);
  return { canvas: c, inverted };
}

/** Greyscale + contrast stretch in place. Returns whether the image was inverted. */
export function enhanceForOcr(ctx: CanvasRenderingContext2D, w: number, h: number, polarity: Polarity = 'auto'): boolean {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = g;
    hist[g]++;
    sum += g;
  }
  const n = d.length / 4;
  // Stretch between the 2nd and 98th percentile.
  let lo = 0;
  let hi = 255;
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.02) {
      lo = v;
      break;
    }
  }
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= n * 0.02) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  const invert = polarity === 'auto' ? sum / n < 110 : polarity === 'inverted';
  for (let i = 0; i < d.length; i += 4) {
    let g = ((d[i] - lo) * 255) / range;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return invert;
}

export async function loadImageFile(file: Blob): Promise<ImageBitmap> {
  // createImageBitmap applies the photo's EXIF rotation in current browsers.
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/** True if the image is already roughly card-shaped (e.g. a cropped scan). */
export function looksLikeCardCrop(w: number, h: number): boolean {
  const aspect = w / h;
  return Math.abs(aspect - CARD_ASPECT) < 0.06;
}
