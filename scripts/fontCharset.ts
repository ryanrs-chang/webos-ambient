// The characters the bundled font (app/fonts/ambient-sans.woff2) keeps. Pure, so it can be tested.
//
// The app shows fixed UI strings, but also free text it cannot know in advance (the Home Assistant AI briefing,
// entity names), so the subset is not "the characters in src/": it is every Big5 level-1 hanzi (5401 characters,
// the common-use set Big5 was built from) plus Big5's symbol block, ASCII and a few extras, plus anything the source
// uses beyond that. A character outside it falls back to the next font in --font-sans.

/** Decodes a Big5 two-byte range (lead bytes `leadFrom..leadTo`, trail bytes 0x40-0x7E and 0xA1-0xFE). */
function big5Range(leadFrom: number, leadTo: number, first: number, last: number): string[] {
  const decoder = new TextDecoder("big5");
  const out: string[] = [];
  for (let lead = leadFrom; lead <= leadTo; lead++) {
    for (const [lo, hi] of [
      [0x40, 0x7e],
      [0xa1, 0xfe],
    ]) {
      for (let trail = lo; trail <= hi; trail++) {
        const code = (lead << 8) | trail;
        if (code < first || code > last) continue;
        const ch = decoder.decode(new Uint8Array([lead, trail]));
        if (ch !== "�") out.push(ch);
      }
    }
  }
  return out;
}

/** Big5 level 1: the 5401 common hanzi, 0xA440-0xC67E. */
export function big5Common(): string[] {
  return big5Range(0xa4, 0xc6, 0xa440, 0xc67e);
}

/** Big5 symbols and full-width punctuation, 0xA140-0xA3BF. */
export function big5Symbols(): string[] {
  return big5Range(0xa1, 0xa3, 0xa140, 0xa3bf);
}

/** Typography the app uses that Big5 lacks or that matters for numbers and units. */
const EXTRAS = "°℃–—…·•‧₀₁₂₃µ×÷±≤≥→←↑↓✦";

/** Every non-ASCII character in the given texts (the app's source files). */
export function nonAscii(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const ch of t) if (ch.codePointAt(0)! > 0x7e) out.add(ch);
  return [...out];
}

/** The full character set, sorted by code point, without duplicates. */
export function fontCharset(sourceTexts: string[]): string[] {
  const ascii = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));
  const all = new Set([...ascii, ...EXTRAS, ...big5Symbols(), ...big5Common(), ...nonAscii(sourceTexts)]);
  return [...all].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
}
