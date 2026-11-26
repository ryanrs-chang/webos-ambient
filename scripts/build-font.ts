// `bun run font`: builds app/fonts/ambient-sans.woff2, the one font the app uses on the TV and on a desktop alike
// (webOS ships no Traditional Chinese font we can rely on, and LG's own font is not available for a desktop).
//
// Source: Noto Sans TC, the variable font (wght 100-900) from google/fonts, pinned to a commit and checked by hash,
// downloaded once into .cache/ (gitignored). Subset with fonttools' pyftsubset (run through `uvx`, so nothing to
// install) to `fontCharset` (scripts/fontCharset.ts), keeping the wght axis. Noto Sans TC has no
// `tnum` feature, but its digits 0-9 already share one advance width, so the clock never shifts as digits change.
// Writes the woff2, its licence (app/fonts/OFL.txt, required by the SIL OFL) and assets/fonts/charset.txt, which
// test/font.test.ts checks the source against. Committed, like the icons: the build does not regenerate it.
import { mkdir } from "node:fs/promises";
import { fontCharset } from "./fontCharset";

const ROOT = new URL("..", import.meta.url).pathname;
const COMMIT = "3be1884c48c3e45b52ecc725676a08f87776373e";
const BASE = `https://raw.githubusercontent.com/google/fonts/${COMMIT}/ofl/notosanstc`;
const TTF_SHA256 = "864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f";
const CACHE = `${ROOT}.cache/fonts`;
const SOURCE = `${CACHE}/NotoSansTC-${COMMIT.slice(0, 7)}.ttf`;
export const FONT_OUT = `${ROOT}app/fonts/ambient-sans.woff2`;
export const CHARSET_OUT = `${ROOT}assets/fonts/charset.txt`;

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

async function download(url: string, path: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  await Bun.write(path, await res.arrayBuffer());
}

async function main(): Promise<void> {
  await mkdir(CACHE, { recursive: true });
  await mkdir(`${ROOT}app/fonts`, { recursive: true });
  await mkdir(`${ROOT}assets/fonts`, { recursive: true });

  if (!(await Bun.file(SOURCE).exists())) {
    console.log("Downloading Noto Sans TC (about 12 MB)...");
    await download(`${BASE}/NotoSansTC%5Bwght%5D.ttf`, SOURCE);
  }
  const hash = await sha256(SOURCE);
  if (hash !== TTF_SHA256) throw new Error(`unexpected font hash ${hash}`);
  await download(`${BASE}/OFL.txt`, `${ROOT}app/fonts/OFL.txt`);

  const sources = [...new Bun.Glob("src/**/*.ts").scanSync(ROOT)].sort();
  const texts = await Promise.all([...sources, "app/index.html"].map((p) => Bun.file(`${ROOT}${p}`).text()));
  const chars = fontCharset(texts);
  await Bun.write(CHARSET_OUT, `${chars.join("")}\n`);

  const proc = Bun.spawn(
    [
      "uvx",
      "--from",
      "fonttools[woff]",
      "pyftsubset",
      SOURCE,
      `--text-file=${CHARSET_OUT}`,
      "--flavor=woff2",
      "--no-hinting",
      "--desubroutinize",
      `--output-file=${FONT_OUT}`,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error("pyftsubset failed (needs uv: https://docs.astral.sh/uv/)");

  const size = Bun.file(FONT_OUT).size;
  console.log(`Wrote app/fonts/ambient-sans.woff2 (${(size / 1024).toFixed(0)} KB, ${chars.length} characters)`);
  console.log(`Source sha256 ${hash}`);
}

try {
  await main();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
