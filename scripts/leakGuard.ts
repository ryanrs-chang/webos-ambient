// Leak guard: personal values (place, coordinates, Home Assistant URL and token) live only in config.local.json, which is gitignored. This finds
// them in any file that is, or would be, committed. A finding names the file, line and key, never the value.

export interface Secret {
  key: "latitude" | "longitude" | "place" | "haBaseUrl" | "haToken";
  value: string | number;
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface Finding {
  path: string;
  line: number;
  key: Secret["key"];
}

interface ConfigLike {
  place: string;
  latitude: number;
  longitude: number;
  haBaseUrl?: string;
  haToken?: string;
}

/** Text secrets match as substrings; these keys are compared that way. */
const TEXT_KEYS = ["place", "haBaseUrl", "haToken"] as const;

/**
 * What must not leak: the local values that differ from the example's (the example is committed on purpose).
 * Whole-number coordinates are skipped: "25" matches far too much to mean anything.
 */
export function secretsFromConfig(local: ConfigLike, example: ConfigLike): Secret[] {
  const out: Secret[] = [];
  for (const key of ["latitude", "longitude"] as const) {
    if (local[key] !== example[key] && !Number.isInteger(local[key])) out.push({ key, value: local[key] });
  }
  for (const key of TEXT_KEYS) {
    const value = local[key] ?? "";
    if (value !== (example[key] ?? "") && value !== "") out.push({ key, value });
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcher(secret: Secret): RegExp {
  if (typeof secret.value === "string") return new RegExp(escapeRegExp(String(secret.value)));
  // A number only counts as itself: not inside a longer number, though trailing zeros are the same number.
  return new RegExp(`(?<!\\d)${escapeRegExp(String(Math.abs(secret.value as number)))}0*(?!\\d)`);
}

export function findLeaks(files: SourceFile[], secrets: Secret[]): Finding[] {
  const matchers = secrets.map((s) => ({ key: s.key, re: matcher(s) }));
  const findings: Finding[] = [];
  for (const file of files) {
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of matchers) {
        if (m.re.test(lines[i])) findings.push({ path: file.path, line: i + 1, key: m.key });
      }
    }
  }
  return findings;
}

const ROOT = new URL("..", import.meta.url).pathname;
const SKIP = (p: string) => p === "config.local.json";

async function git(...args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return out;
}

/** Scans every tracked or not-yet-tracked, non-ignored file. Returns [] when there is no config.local.json. */
export async function scanRepo(): Promise<Finding[]> {
  const localFile = Bun.file(`${ROOT}config.local.json`);
  if (!(await localFile.exists())) return [];
  const local = (await localFile.json()) as ConfigLike;
  const example = (await Bun.file(`${ROOT}config.example.json`).json()) as ConfigLike;
  const secrets = secretsFromConfig(local, example);
  if (secrets.length === 0) return [];

  const listed = await git("ls-files", "--cached", "--others", "--exclude-standard", "-z");
  const files: SourceFile[] = [];
  for (const path of listed.split("\0").filter((p) => p !== "" && !SKIP(p))) {
    const file = Bun.file(`${ROOT}${path}`);
    // A staged deletion is still listed; the file is gone, so there is nothing to leak.
    if (!(await file.exists()) || file.size > 5_000_000) continue;
    files.push({ path, content: await file.text() });
  }
  return findLeaks(files, secrets);
}
