import type { GameId, ScanHints } from '../types';

/**
 * Turns raw OCR text from a card photo into structured lookup hints.
 *
 * The printed codes near the bottom of a card are far easier to read reliably
 * than stylised card names, so they carry most of the weight:
 *   - One Piece:  "OP01-001", "ST10-002", "EB01-012", "PRB01-001", "P-041"
 *   - Pokémon:    "025/198", "TG05/TG30", "SWSH050"
 *   - Magic:      "0123 R" + "MOM • EN" (2023+), or "123/280 R" (2014–2022)
 */

// Characters OCR commonly returns in place of digits.
const DIGITISH = '0-9OQDILSZB|';
const DIGIT_FIX: Record<string, string> = {
  O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', Z: '2', S: '5', B: '8',
};

function fixDigits(s: string): string {
  return s.replace(/[OQDILSZB|]/g, (c) => DIGIT_FIX[c] ?? c);
}

function countRealDigits(s: string): number {
  return (s.match(/[0-9]/g) ?? []).length;
}

/** Uppercase and unify the many dash/bullet glyphs OCR produces. */
function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[‐‑‒–—―−~_]/g, '-')
    .replace(/[•·●∙*]/g, '•');
}

function unique<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parseOnePieceIds(text: string): string[] {
  const t = normalize(text);
  const ids: string[] = [];

  const setRe = new RegExp(
    `(OP|0P|ST|5T|EB|E8|PRB|PR8)\\s?([${DIGITISH}]{2})\\s?[-.]?\\s?([${DIGITISH}]{3})(?![0-9])`,
    'g',
  );
  for (const m of t.matchAll(setRe)) {
    // Guard against ordinary words being read as codes: most of the five
    // digit positions must genuinely be digits.
    if (countRealDigits(m[2] + m[3]) < 3) continue;
    const prefix = m[1].replace('0P', 'OP').replace('5T', 'ST').replace('E8', 'EB').replace('PR8', 'PRB');
    ids.push(`${prefix}${fixDigits(m[2])}-${fixDigits(m[3])}`);
  }

  // Promos: "P-001". The dash is required here — "P" alone is too common.
  const promoRe = new RegExp(`(?<![A-Z0-9])P\\s?-\\s?([${DIGITISH}]{3})(?![0-9])`, 'g');
  for (const m of t.matchAll(promoRe)) {
    if (countRealDigits(m[1]) < 2) continue;
    ids.push(`P-${fixDigits(m[1])}`);
  }
  return unique(ids, (s) => s);
}

export function parseSlashNumbers(text: string): { number: string; total?: string }[] {
  const t = normalize(text);
  const out: { number: string; total?: string }[] = [];

  // Subset numbering: TG05/TG30, GG12/GG70, SV045/SV094, RC5/RC32.
  for (const m of t.matchAll(/(TG|GG|SV|RC)\s?(\d{1,3})\s?\/\s?(TG|GG|SV|RC)\s?(\d{2,3})(?![0-9])/g)) {
    out.push({ number: `${m[1]}${m[2]}`, total: `${m[3]}${m[4]}` });
  }

  // Plain numbering: 025/198, 4/102, 123/280.
  const re = new RegExp(`(?<![0-9A-Z])([${DIGITISH}]{1,3})\\s?\\/\\s?([${DIGITISH}]{2,3})(?![0-9])`, 'g');
  for (const m of t.matchAll(re)) {
    if (countRealDigits(m[1]) < 1 || countRealDigits(m[2]) < 2) continue;
    const number = fixDigits(m[1]);
    const total = fixDigits(m[2]);
    const n = parseInt(number, 10);
    const tot = parseInt(total, 10);
    // Secret rares go past the set total, but not wildly so.
    if (n < 1 || tot < 10 || n > tot * 2 + 50) continue;
    out.push({ number, total });
  }

  // Pokémon black-star promos: SWSH050, SM210, XY123, BW45.
  for (const m of t.matchAll(/(?<![A-Z])(SWSH|SM|XY|BW)\s?(\d{2,3})(?![0-9])/g)) {
    out.push({ number: `${m[1]}${m[2]}` });
  }
  return unique(out, (p) => `${p.number}/${p.total ?? ''}`);
}

const MTG_LANGS = 'EN|JP|JA|DE|FR|IT|ES|SP|PT|RU|KO|KR|CS|CT|PH';
// Tokens that look like "XXX • EN" but aren't set codes.
const NOT_SET_CODES = new Set(['THE', 'AND', 'FOR', 'TM', 'WOTC', 'LLC', 'INC', 'HP']);

export function parseMagicPrints(text: string): { set?: string; number?: string }[] {
  const t = normalize(text);
  const out: { set?: string; number?: string }[] = [];

  const setRe = new RegExp(`(?<![A-Z0-9])([A-Z0-9]{3,5})(?:\\s*[•.,:+\\-]\\s*|\\s+)(${MTG_LANGS})(?![A-Z])`, 'g');
  const sets: { code: string; index: number }[] = [];
  for (const m of t.matchAll(setRe)) {
    const code = m[1];
    if (NOT_SET_CODES.has(code) || /^\d+$/.test(code)) continue;
    sets.push({ code, index: m.index ?? 0 });
  }

  // Collector number followed by a rarity letter: "0123 R", "123/280 M".
  const numRe = /(?<![0-9A-Z])(\d{1,4})(?:\s?\/\s?\d{1,4})?\s?([CURMLSTP])(?![A-Z])/g;
  const numbers: { number: string; index: number }[] = [];
  for (const m of t.matchAll(numRe)) {
    numbers.push({ number: String(parseInt(m[1], 10)), index: m.index ?? 0 });
  }

  for (const s of sets) {
    // The number sits just before the set code (line above, or same line).
    const before = numbers.filter((n) => n.index < s.index);
    const nearest = before.length ? before[before.length - 1] : numbers[0];
    out.push({ set: s.code.toLowerCase(), number: nearest?.number });
  }
  if (!sets.length) {
    for (const n of numbers) out.push({ number: n.number });
  }
  return unique(out, (p) => `${p.set ?? ''}/${p.number ?? ''}`);
}

// Words on the top line of a Pokémon card that aren't part of its name.
const POKEMON_NOISE =
  /\b(BASIC|STAGE\s*[12I]?|STAGE|RESTORED|TRAINER|ITEM|SUPPORTER|STADIUM|POK[EÉ]MON\s+TOOL|TOOL|ENERGY|SPECIAL|ACE\s+SPEC|TERA|MEGA\s+EVOLUTION)\b/gi;

// Whole lines that are a card type rather than a name ("Legendary Creature — Elf", "CHARACTER").
const TYPE_LINE =
  /^((legendary|basic|snow|world|tribal|kindred)\s+)*((artifact|enchantment)\s+)?(creature|instant|sorcery|enchantment|artifact|land|planeswalker|battle)(\s*[-—].*)?$|^(character|leader|event|stage|don)$/i;

/**
 * Candidate card names, best first. Expects the name area of a card (or all
 * of a card's lines, largest print first).
 */
export function parseNames(text: string): string[] {
  const candidates: { name: string; score: number }[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, lineIdx) => {
    let line = raw
      .replace(/evolves\s+from.*$/i, '')
      .replace(/\bHP\s*\d{0,3}\b/gi, ' ')
      .replace(/\b\d{1,3}\s*HP\b/gi, ' ')
      .replace(POKEMON_NOISE, ' ');
    // Keep characters that appear in real card names: letters, spaces and
    // ' , . - (e.g. "Jace, the Mind Sculptor", "Farfetch'd", "Ho-Oh", "Mr. Mime").
    line = line.replace(/[’`]/g, "'").replace(/[^A-Za-zÀ-ÿ',.\- ]+/g, ' ');
    const words = line
      .split(/\s+/)
      .map((w) => w.replace(/^[',.\-]+|[',.\-]+$/g, ''))
      // Mana symbols and frame art come back as stray one- or two-letter
      // "words"; real names rarely contain those except for short suffixes.
      .filter((w) => w.length >= 3 || /^(ex|EX|V|GX|of|the|to|a|an|in|on|Mr|Jr|Oh)$/.test(w));
    while (words.length && words[words.length - 1].length < 3 && !/^(ex|EX|V|GX)$/.test(words[words.length - 1])) words.pop();
    while (words.length && words[0].length < 3) words.shift();
    const name = words.join(' ').trim();
    const letters = (name.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    const rawType = raw.trim().replace(/[‐‑‒–—―−~]/g, '-');
    if (letters < 3 || TYPE_LINE.test(name) || TYPE_LINE.test(rawType)) return;
    const rawVisible = raw.replace(/\s+/g, '');
    const rawLetters = (raw.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    // Lines that are mostly symbols are OCR noise rather than a name.
    const quality = rawVisible.length ? rawLetters / rawVisible.length : 0;
    if (quality < 0.5) return;
    // Names are short and Title Cased; rules text is long and mostly lowercase.
    const long = words.filter((w) => w.length >= 3);
    const capitalised = long.length ? long.filter((w) => /^[A-ZÀ-Þ]/.test(w)).length / long.length : 0;
    let score = quality * Math.min(letters, 16) * (0.5 + capitalised) - lineIdx;
    if (words.length > 5) score *= 0.3;
    candidates.push({ name, score });
    // OCR often glues a misread label onto the front ("Pree Pikachu" for
    // "BASIC Pikachu"), so also offer the name without its first word.
    if (words.length >= 2 && words.length <= 4) {
      const rest = words.slice(1).join(' ');
      if ((rest.match(/[A-Za-zÀ-ÿ]/g) ?? []).length >= 4) candidates.push({ name: rest, score: score * 0.5 });
    }
  });
  return unique(
    candidates.sort((a, b) => b.score - a.score),
    (c) => c.name.toLowerCase(),
  ).map((c) => c.name);
}

const GAME_MARKERS: Record<GameId, RegExp[]> = {
  pokemon: [
    /POK[EÉ]MON/, /NINTENDO/, /GAME\s?FREAK/, /CREATURES/, /\bHP\s?\d{2,3}\b/, /\b\d{2,3}\s?HP\b/,
    /WEAKNESS/, /RESISTANCE/, /RETREAT/, /EVOLVES/, /\bBASIC\b/, /STAGE\s?[12]/, /SUPPORTER/, /\bTRAINER\b/,
  ],
  magic: [
    /WIZARDS/, /\bCOAST\b/, /\bCREATURE\b/, /\bINSTANT\b/, /\bSORCERY\b/, /ENCHANTMENT/, /\bARTIFACT\b/,
    /PLANESWALKER/, /LEGENDARY/, /\bFLYING\b/, /\bTRAMPLE\b/, /\bHASTE\b/, /\bTAPPED\b/, /\bMANA\b/,
  ],
  onepiece: [
    /\bODA\b/, /SHUEISHA/, /BANDAI/, /\bTOEI\b/, /\bDON\b/, /\bCOUNTER\b/, /\bLEADER\b/, /\bBLOCKER\b/,
    /\bRUSH\b/, /\[TRIGGER\]/, /ON\s+PLAY/, /WHEN\s+ATTACKING/, /\bLIFE\b/, /ACTIVATE/,
  ],
};

export function guessGames(text: string, hints: Omit<ScanHints, 'gameGuesses' | 'rawText' | 'names'>): GameId[] {
  const t = normalize(text);
  const score: Record<GameId, number> = { pokemon: 0, magic: 0, onepiece: 0 };
  for (const game of Object.keys(GAME_MARKERS) as GameId[]) {
    for (const re of GAME_MARKERS[game]) if (re.test(t)) score[game] += 1;
  }
  if (hints.onePieceIds.length) score.onepiece += 4;
  if (hints.magicPrints.some((p) => p.set)) score.magic += 3;
  if (hints.pokemonNumbers.length) {
    // "123/280" is shared by Pokémon and 2014–2022 Magic cards.
    score.pokemon += 2;
    score.magic += 0.5;
  }
  return (Object.keys(score) as GameId[]).filter((g) => score[g] > 0).sort((a, b) => score[b] - score[a]);
}

/**
 * @param top      OCR text from the top of the card (name area).
 * @param bottom   OCR text from the bottom of the card (codes, copyright line).
 * @param extra    OCR text from a whole-card or whole-photo read, if any.
 * @param nameText Text to look for names in besides `top` (defaults to `extra`).
 */
export function parseScan(top: string, bottom: string, extra = '', nameText = extra): ScanHints {
  const all = [top, bottom, extra].filter(Boolean).join('\n');
  const partial = {
    onePieceIds: parseOnePieceIds(all),
    pokemonNumbers: parseSlashNumbers(bottom + '\n' + extra),
    magicPrints: parseMagicPrints(bottom + '\n' + extra),
  };
  // One Piece names sit near the bottom of the card, everyone else's at the top.
  const names = [...parseNames(top), ...parseNames(nameText)];
  return {
    ...partial,
    names: unique(names, (n) => n.toLowerCase()),
    gameGuesses: guessGames(all, partial),
    rawText: all,
  };
}

/** Combine hints from two reads of the same card (first one wins ties). */
export function mergeHints(a: ScanHints, b: ScanHints): ScanHints {
  const partial = {
    onePieceIds: unique([...a.onePieceIds, ...b.onePieceIds], (s) => s),
    pokemonNumbers: unique([...a.pokemonNumbers, ...b.pokemonNumbers], (p) => `${p.number}/${p.total ?? ''}`),
    magicPrints: unique([...a.magicPrints, ...b.magicPrints], (p) => `${p.set ?? ''}/${p.number ?? ''}`),
  };
  const rawText = [a.rawText, b.rawText].filter(Boolean).join('\n');
  return {
    ...partial,
    names: unique([...a.names, ...b.names], (n) => n.toLowerCase()),
    gameGuesses: guessGames(rawText, partial),
    rawText,
  };
}
