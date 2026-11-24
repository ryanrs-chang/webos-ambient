// Remote-control handling, kept free of the DOM so it can be unit tested.

import { nextThemeIndex, themes } from "./themes";

/** webOS remote keyCodes for the directional pad and OK. */
export const KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13 } as const;

export interface Prefs {
  themeIndex: number;
  brightness: number;
}

export interface KeyResult {
  prefs: Prefs;
  /** Text to flash on screen. */
  hint: string | null;
}

export const PREFS_KEY = "ambient.prefs";
export const DEFAULT_BRIGHTNESS = 0.7;
export const MIN_BRIGHTNESS = 0.3;
export const MAX_BRIGHTNESS = 1.0;
const BRIGHTNESS_STEP = 0.1;

/** Clamps to the allowed range and rounds to one decimal, so 0.7 + 0.1 is 0.8 and not 0.7999…. */
function normalizeBrightness(value: number): number {
  const clamped = Math.min(MAX_BRIGHTNESS, Math.max(MIN_BRIGHTNESS, value));
  return Math.round(clamped * 10) / 10;
}

const themeName = (index: number): string => themes[index]?.name ?? "";

/** Returns the new prefs and a hint, or null when the key is not one this app handles. */
export function applyKey(prefs: Prefs, keyCode: number, themeCount: number): KeyResult | null {
  switch (keyCode) {
    case KEY.LEFT:
    case KEY.RIGHT: {
      const themeIndex = nextThemeIndex(prefs.themeIndex, keyCode === KEY.RIGHT ? 1 : -1, themeCount);
      return { prefs: { ...prefs, themeIndex }, hint: themeName(themeIndex) };
    }
    case KEY.UP:
    case KEY.DOWN: {
      const delta = keyCode === KEY.UP ? BRIGHTNESS_STEP : -BRIGHTNESS_STEP;
      const brightness = normalizeBrightness(prefs.brightness + delta);
      return { prefs: { ...prefs, brightness }, hint: `亮度 ${Math.round(brightness * 100)}%` };
    }
    case KEY.ENTER:
      return { prefs: { ...prefs }, hint: themeName(prefs.themeIndex) };
    default:
      return null;
  }
}

/** Saved prefs, with anything missing, malformed or out of range replaced by a default. */
export function loadPrefs(
  storage: Pick<Storage, "getItem">,
  fallbackThemeIndex: number,
  themeCount: number = themes.length,
): Prefs {
  const out: Prefs = { themeIndex: fallbackThemeIndex, brightness: DEFAULT_BRIGHTNESS };
  let parsed: unknown;
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return out;
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return out;
  const { themeIndex, brightness } = parsed as Record<string, unknown>;
  if (typeof themeIndex === "number" && Number.isInteger(themeIndex) && themeIndex >= 0 && themeIndex < themeCount) {
    out.themeIndex = themeIndex;
  }
  if (typeof brightness === "number" && Number.isFinite(brightness)) {
    out.brightness = normalizeBrightness(brightness);
  }
  return out;
}

export function savePrefs(storage: Pick<Storage, "setItem">, prefs: Prefs): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be full or disabled; the preference then lasts only until the app closes.
  }
}
