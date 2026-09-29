/** Lowercase, strip accents and anything that isn't a letter or digit. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 similarity between two card names, tolerant of OCR noise. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const whole = 1 - levenshtein(x, y) / Math.max(x.length, y.length);
  // OCR often picks up extra junk around the name ("Pikachu HP 60"), so also
  // score how well the shorter string matches the start of the longer one.
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const prefix = short.length >= 4 ? 1 - levenshtein(short, long.slice(0, short.length)) / short.length : 0;
  // …but a short name matching the start of a much longer line ("Queen" in
  // "Queen Sorcerer") is weaker evidence than a match of similar length.
  const coverage = short.length / long.length;
  return Math.max(whole, prefix * (0.6 + 0.3 * coverage));
}
