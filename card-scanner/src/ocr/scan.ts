import type { GameFilter, ScanHints } from '../types';
import { readText, type OcrLine, type OcrResult, type ProgressFn } from './engine';
import { CARD_ASPECT, cardRegion, cropCard, fitImage, looksLikeCardCrop, type Rect } from './image';
import { mergeHints, parseNames, parseScan } from './parse';

export interface ScanOutput {
  hints: ScanHints;
  /** The cropped card image, for showing next to the matches. */
  preview: string;
}

// Bands of the card we read, as fractions of its height.
const BOTTOM = { top: 0.82, bottom: 1 }; // collector numbers, set codes, One Piece ids + names, passcodes
const TOP = { top: 0.015, bottom: 0.14 }; // Pokémon / Magic / Yu-Gi-Oh! names
const UNDER_ART = { top: 0.64, bottom: 0.78, left: 0.35, right: 1 }; // Yu-Gi-Oh! set code

// Per-read time limits (ms). Retries get less time than first attempts.
const FIRST_TRY = 12000;
const RETRY = 6000;

function hasSomething(h: ScanHints): boolean {
  return h.onePieceIds.length + h.pokemonNumbers.length + h.magicPrints.length + h.names.length > 0;
}

function hasCode(h: ScanHints): boolean {
  return (
    h.onePieceIds.length +
      h.pokemonNumbers.length +
      h.magicPrints.filter((p) => p.set).length +
      h.yugiohSetCodes.length +
      h.yugiohPasscodes.length +
      h.lorcanaPrints.length >
    0
  );
}

/**
 * A read's biggest lines, largest first. A card's name is among its largest
 * print, while rules text (small, long, and plentiful) would crowd it out.
 */
function largestFirst(r: OcrResult, count = 6): string {
  return [...r.lines]
    .sort((a, b) => b.height - a.height)
    .slice(0, count)
    .map((l) => l.text)
    .join('\n');
}

/**
 * Guess where the card is in a photo from where legible text was found. Rules
 * text spans most of a card's width, and the lowest line (copyright, collector
 * number) sits just above its bottom edge — the part we most need to read.
 * Art-heavy tops (Lorcana) make the text's height a poor guide, so anchor low.
 */
export function estimateCardRect(lines: OcrLine[], width: number, height: number): Rect | null {
  const good = lines.filter((l) => l.confidence >= 55 && (l.text.match(/[A-Za-z0-9]/g) ?? []).length >= 3);
  if (good.length < 2) return null;
  const x0 = Math.min(...good.map((l) => l.box.x0));
  const x1 = Math.max(...good.map((l) => l.box.x1));
  const y0 = Math.min(...good.map((l) => l.box.y0));
  const y1 = Math.max(...good.map((l) => l.box.y1));
  const w = Math.min(width, height * CARD_ASPECT, Math.max((x1 - x0) / 0.88, ((y1 - y0) / 0.9) * CARD_ASPECT));
  const h = w / CARD_ASPECT;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), Math.max(0, max));
  return {
    x: clamp((x0 + x1) / 2 - w / 2, width - w),
    y: clamp(y1 + 0.03 * h - h, height - h),
    w,
    h,
  };
}

function interleave(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const s of [a[i], b[i]]) if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

function centredCardRect(width: number, height: number): Rect {
  const h = Math.min(height, width / CARD_ASPECT) * 0.95;
  const w = h * CARD_ASPECT;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Read a card that has already been cropped to the normalised card size. */
export async function scanCardImage(
  card: HTMLCanvasElement,
  filter: GameFilter,
  onProgress?: ProgressFn,
  opts: { skipFullRead?: boolean } = {},
): Promise<ScanOutput> {
  const preview = card.toDataURL('image/jpeg', 0.8);

  const bottomRegion = cardRegion(card, BOTTOM, 2.5, 'auto');
  let bottom = (await readText(bottomRegion.canvas, onProgress, FIRST_TRY)).text;

  let top = '';
  if (filter !== 'onepiece') {
    // Names sit on light title bars even when the frame around them is dark,
    // so read as-is first and only try inverted if nothing name-like came back.
    top = (await readText(cardRegion(card, TOP, 1.5, 'normal').canvas, onProgress, FIRST_TRY)).text;
    if (!parseNames(top).length) {
      top += '\n' + (await readText(cardRegion(card, TOP, 1.5, 'inverted').canvas, onProgress, RETRY)).text;
    }
  }
  let hints = parseScan(top, bottom);

  if (!hasCode(hints)) {
    // Try the opposite light/dark treatment of the bottom band (foils, dark frames).
    const flipped = cardRegion(card, BOTTOM, 2.5, bottomRegion.inverted ? 'normal' : 'inverted');
    bottom += '\n' + (await readText(flipped.canvas, onProgress, RETRY)).text;
    hints = parseScan(top, bottom);
  }
  const looksYugioh = filter === 'yugioh' || hints.gameGuesses[0] === 'yugioh' || hints.yugiohPasscodes.length > 0;
  if (looksYugioh && !hints.yugiohSetCodes.length) {
    // The passcode names the card; the set code under the art names the printing.
    const underArt = await readText(cardRegion(card, UNDER_ART, 2.5, 'auto').canvas, onProgress, RETRY);
    hints = mergeHints(hints, parseScan('', '', underArt.text, ''));
  }
  if (!hasSomething(hints) && !opts.skipFullRead) {
    // Last resort: read the whole card.
    const full = await readText(cardRegion(card, { top: 0, bottom: 1 }, 1, 'normal').canvas, onProgress, RETRY);
    hints = parseScan(top, bottom, full.text, largestFirst(full));
  }
  return { hints, preview };
}

/** Read a photo from the camera roll / native camera. */
export async function scanPhoto(image: ImageBitmap, filter: GameFilter, onProgress?: ProgressFn): Promise<ScanOutput> {
  if (looksLikeCardCrop(image.width, image.height)) {
    return scanCardImage(cropCard(image, { x: 0, y: 0, w: image.width, h: image.height }), filter, onProgress);
  }
  // We don't know where the card is yet, so read the whole photo at a
  // resolution high enough for the small printed codes.
  const full = fitImage(image, 2400);
  const result = await readText(full, onProgress, FIRST_TRY);
  let hints = parseScan('', '', result.text, largestFirst(result));
  let preview = full.toDataURL('image/jpeg', 0.7);
  if (!hasCode(hints)) {
    // Crop to where the card seems to be and read its code/name bands up close.
    const k = image.width / full.width;
    const guess = estimateCardRect(result.lines, full.width, full.height);
    const rect = guess
      ? { x: guess.x * k, y: guess.y * k, w: guess.w * k, h: guess.h * k }
      : centredCardRect(image.width, image.height);
    const inner = await scanCardImage(cropCard(image, rect), filter, onProgress, { skipFullRead: true });
    // Alternate names from the two reads: the crop is only a guess, and if it
    // is off, its "name band" holds other text, while the whole-photo read's
    // biggest lines usually include the real name.
    hints = { ...mergeHints(inner.hints, hints), names: interleave(hints.names, inner.hints.names) };
    preview = inner.preview;
  }
  return { hints, preview };
}
