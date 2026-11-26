// `bun run setup`: writes config.local.json (gitignored), the personal values the build inlines.
//   bun run setup                                            ask for each value; Enter keeps the one in brackets
//   bun run setup --place Home --lat 51.5 --lon -0.1 --tz Europe/London    no questions; unset keys keep their value
// Prints only what you typed and the file it wrote, never the contents of an existing file beyond the prompt defaults.
import { createInterface } from "node:readline/promises";
import { parseUserConfig, type UserConfig } from "../src/userConfig";
import { applyFlags, parseSetupArgs } from "./setupArgs";
import { EXAMPLE_PATH, LOCAL_PATH, loadUserConfig } from "./userConfigFile";

async function currentConfig(): Promise<UserConfig> {
  try {
    return (await loadUserConfig()).config;
  } catch {
    // A broken config.local.json is exactly what setup is for: start from the example.
    return parseUserConfig(await Bun.file(EXAMPLE_PATH).json());
  }
}

const PROMPTS: { key: keyof UserConfig; label: string }[] = [
  { key: "place", label: "Place shown beside the weather" },
  { key: "latitude", label: "Latitude (-90..90)" },
  { key: "longitude", label: "Longitude (-180..180)" },
  { key: "timeZone", label: "IANA time zone (e.g. Europe/London)" },
  { key: "haBaseUrl", label: "Home Assistant base URL (optional; empty for none)" },
  { key: "haToken", label: "Home Assistant long-lived access token (optional)" },
  { key: "haEntities", label: "Home Assistant entity ids, comma-separated (optional)" },
];

/** What the prompt shows as the current value: never the token itself. */
function shown(config: UserConfig, key: keyof UserConfig): string {
  if (key === "haToken") return config.haToken === "" ? "" : "set; Enter keeps it";
  const v = config[key];
  return Array.isArray(v) ? v.join(",") : String(v);
}

async function interactive(base: UserConfig): Promise<UserConfig> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let config = base;
  try {
    for (const { key, label } of PROMPTS) {
      for (;;) {
        const answer = (await rl.question(`${label} [${shown(config, key)}]: `)).trim();
        if (answer === "") break;
        try {
          config = parseUserConfig(applyFlags(config, { [key]: answer }));
          break;
        } catch (e) {
          console.error((e as Error).message);
        }
      }
    }
  } finally {
    rl.close();
  }
  return config;
}

try {
  const flags = parseSetupArgs(Bun.argv.slice(2));
  const base = await currentConfig();
  let config: UserConfig;
  if (Object.keys(flags).length > 0) {
    config = parseUserConfig(applyFlags(base, flags));
  } else if (process.stdin.isTTY) {
    config = await interactive(base);
  } else {
    throw new Error(
      "not a terminal: pass --place, --lat, --lon, --tz (and optionally --ha-base-url, --ha-token, --ha-entities)",
    );
  }
  await Bun.write(LOCAL_PATH, `${JSON.stringify(config, null, 2)}\n`);
  console.log("Wrote config.local.json");
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
