// Bundled at build time: a packaged webOS app runs from file://, where fetching
// a sibling JSON file is not reliable, so configuration lives in the bundle.
//
// Personal values (place, coordinates, time zone) never live in this file: `scripts/build-js.ts` injects
// config.local.json (gitignored) as __USER_CONFIG__, or config.example.json when that is missing. Anything that
// runs without the build (bun test, tsc) gets the example values.
import exampleConfig from "../config.example.json";
import { parseUserConfig } from "./userConfig";

/** Replaced by the validated contents of config.local.json at build time; undefined outside the build. */
declare const __USER_CONFIG__: unknown;

const user = parseUserConfig(typeof __USER_CONFIG__ === "undefined" ? exampleConfig : __USER_CONFIG__);

export interface Config {
  /** Shown beside the weather, e.g. "Greenwich". */
  place: string;
  /** City-level is enough for a forecast; one decimal is ~11 km. */
  latitude: number;
  longitude: number;
  timeZone: string;
  refreshMinutes: number;
  defaultTheme: string;
  /** Where the forecast comes from; overridable for local development. */
  weatherUrl: string;
  /** Keep-out border: the content never sits closer than this to a screen edge. */
  floatMarginPx: number;
  /** Burn-in protection: every this many minutes the content fades out and reappears in another screen region. */
  relocateMinutes: number;
  /** Seconds past the minute the relocation happens at, so it never lands on the :00 digit roll. */
  relocateOffsetSec: number;
  /** Length of each half (out, then in) of the relocation fade. */
  relocateFadeMs: number;
}

export const defaultConfig: Config = {
  place: user.place,
  latitude: user.latitude,
  longitude: user.longitude,
  timeZone: user.timeZone,
  refreshMinutes: 15,
  defaultTheme: "minimal",
  weatherUrl: "https://api.open-meteo.com/v1/forecast",
  floatMarginPx: 40,
  relocateMinutes: 3,
  relocateOffsetSec: 30,
  relocateFadeMs: 1200,
};

/** Overrides read from the launch parameters or the page's query string. */
export interface LaunchParams {
  theme?: string;
  weatherUrl?: string;
}

export function parseLaunchParams(palmLaunchParams: string | undefined, search: string): LaunchParams {
  const out: LaunchParams = {};
  // webOS hands launch parameters to the page as a JSON string; HA's
  // webostv.command → system.launcher/launch sets them via `params`.
  if (palmLaunchParams) {
    try {
      const parsed = JSON.parse(palmLaunchParams) as Record<string, unknown>;
      if (typeof parsed.theme === "string") out.theme = parsed.theme;
    } catch {
      // Malformed parameters are ignored rather than stopping the clock.
    }
  }
  const query = new URLSearchParams(search);
  const theme = query.get("theme");
  if (theme) out.theme = theme;
  const weather = query.get("weather");
  if (weather) out.weatherUrl = weather;
  return out;
}
