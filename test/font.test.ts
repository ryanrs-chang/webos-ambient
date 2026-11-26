import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { big5Common, big5Symbols, fontCharset, nonAscii } from "../scripts/fontCharset";

const ROOT = new URL("../", import.meta.url).pathname;

describe("fontCharset", () => {
  test("Big5 level 1 is the 5401 common hanzi, from 一 to 齾's block end", () => {
    const common = big5Common();
    expect(common.length).toBe(5401);
    expect(common[0]).toBe("一");
  });

  test("has the full-width punctuation", () => {
    for (const ch of "，。、：；「」（）") expect(big5Symbols()).toContain(ch);
  });

  test("keeps ASCII, units and the source's own characters, sorted and unique", () => {
    const chars = fontCharset(["const x = '𠮷';"]);
    for (const ch of ["0", "A", "%", "°", "℃", "₂", "·", "𠮷"]) expect(chars).toContain(ch);
    expect(new Set(chars).size).toBe(chars.length);
    const codes = chars.map((c) => c.codePointAt(0) ?? 0);
    expect(codes).toEqual([...codes].sort((a, b) => a - b));
  });

  test("nonAscii skips ASCII", () => {
    expect(nonAscii(["abc 晴"])).toEqual(["晴"]);
  });
});

// The committed font must cover every character the app's own strings use: add a string with a new character and
// this fails until `bun run font` is run again.
describe("bundled font", () => {
  test("the font, its licence and its charset are committed", () => {
    for (const p of ["app/fonts/ambient-sans.woff2", "app/fonts/OFL.txt", "assets/fonts/charset.txt"]) {
      expect(existsSync(ROOT + p)).toBe(true);
    }
  });

  test("covers every non-ASCII character in src/ and app/index.html", async () => {
    const charset = new Set(await Bun.file(`${ROOT}assets/fonts/charset.txt`).text());
    const paths = [...new Bun.Glob("src/**/*.ts").scanSync(ROOT), "app/index.html"];
    const texts = await Promise.all(paths.map((p) => Bun.file(ROOT + p).text()));
    expect(nonAscii(texts).filter((ch) => !charset.has(ch))).toEqual([]);
  });
});
