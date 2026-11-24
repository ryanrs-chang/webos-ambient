// The personal part of the configuration (where the TV is). It comes from config.local.json (gitignored) or, as a
// fallback, config.example.json, and is validated here at build time so a typo fails the build, not the TV.

export interface UserConfig {
  /** Shown beside the weather, e.g. "Greenwich". */
  place: string;
  /** -90..90. City-level is enough for a forecast; one decimal is about 11 km. */
  latitude: number;
  /** -180..180. */
  longitude: number;
  /** IANA zone, e.g. "Europe/London". */
  timeZone: string;
  /** Reserved for a future Home Assistant link; empty means none. */
  haBaseUrl: string;
}

const KEYS = ["place", "latitude", "longitude", "timeZone", "haBaseUrl"] as const;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function describe(v: unknown): string {
  return typeof v === "number" ? String(v) : (JSON.stringify(v) ?? "undefined");
}

function checkRange(raw: unknown, key: string, min: number, max: number, errors: string[]): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min || raw > max) {
    errors.push(`"${key}" must be a number from ${min} to ${max} (got ${describe(raw)})`);
    return 0;
  }
  return raw;
}

/** Validates a parsed config file. Throws one Error that lists every bad key. */
export function parseUserConfig(raw: unknown): UserConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error('Invalid config: "config" must be a JSON object (see config.example.json)');
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(obj)) {
    if (!key.startsWith("$") && !(KEYS as readonly string[]).includes(key)) {
      errors.push(`unknown key "${key}" (allowed: ${KEYS.join(", ")})`);
    }
  }

  let place = "";
  if (typeof obj.place === "string" && obj.place.trim() !== "") place = obj.place.trim();
  else errors.push(`"place" must be a non-empty string (got ${describe(obj.place)})`);

  const latitude = checkRange(obj.latitude, "latitude", -90, 90, errors);
  const longitude = checkRange(obj.longitude, "longitude", -180, 180, errors);

  let timeZone = "";
  if (typeof obj.timeZone === "string" && obj.timeZone !== "" && isValidTimeZone(obj.timeZone)) timeZone = obj.timeZone;
  else errors.push(`"timeZone" must be an IANA time zone such as "Europe/London" (got ${describe(obj.timeZone)})`);

  let haBaseUrl = "";
  if (obj.haBaseUrl !== undefined) {
    if (typeof obj.haBaseUrl === "string" && (obj.haBaseUrl === "" || /^https?:\/\/\S+$/.test(obj.haBaseUrl))) {
      haBaseUrl = obj.haBaseUrl;
    } else errors.push(`"haBaseUrl" must be empty or an http(s) URL (got ${describe(obj.haBaseUrl)})`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid config (fix config.local.json, or run \`bun run setup\`):\n  - ${errors.join("\n  - ")}`);
  }
  return { place, latitude, longitude, timeZone, haBaseUrl };
}
