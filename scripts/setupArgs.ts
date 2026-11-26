// Argument handling for `bun run setup`, kept pure so it can be tested.
import type { UserConfig } from "../src/userConfig";

export type SetupFlags = Partial<Record<keyof UserConfig, string>>;

/** "a.b, c.d" -> ["a.b", "c.d"]; an empty string is an empty list. */
export function splitList(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
}

const FLAGS: Record<string, keyof UserConfig> = {
  "--place": "place",
  "--lat": "latitude",
  "--lon": "longitude",
  "--tz": "timeZone",
  "--ha-base-url": "haBaseUrl",
  "--ha-token": "haToken",
  "--ha-entities": "haEntities",
};

export function parseSetupArgs(argv: string[]): SetupFlags {
  const out: SetupFlags = {};
  for (let i = 0; i < argv.length; i++) {
    const [name, inline] = argv[i].split(/=(.*)/s, 2);
    const key = FLAGS[name];
    if (!key) throw new Error(`unknown option ${name} (use ${Object.keys(FLAGS).join(", ")})`);
    const value = inline ?? argv[++i];
    if (value === undefined) throw new Error(`${name} needs a value`);
    out[key] = value;
  }
  return out;
}

function toNumber(s: string): number | string {
  return s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : s;
}

/** Overlays flags on a base config; the result is unvalidated (a bad number stays a string for the validator). */
export function applyFlags(base: UserConfig, flags: SetupFlags): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  if (flags.place !== undefined) out.place = flags.place;
  if (flags.latitude !== undefined) out.latitude = toNumber(flags.latitude);
  if (flags.longitude !== undefined) out.longitude = toNumber(flags.longitude);
  if (flags.timeZone !== undefined) out.timeZone = flags.timeZone;
  if (flags.haBaseUrl !== undefined) out.haBaseUrl = flags.haBaseUrl;
  if (flags.haToken !== undefined) out.haToken = flags.haToken.trim();
  if (flags.haEntities !== undefined) out.haEntities = splitList(flags.haEntities);
  return out;
}
