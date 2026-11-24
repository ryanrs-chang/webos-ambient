import { ambient } from "./ambient";
import { analog } from "./analog";
import { cinematic } from "./cinematic";
import { forecast } from "./forecast";
import { minimal } from "./minimal";
import type { Theme } from "./types";

export const themes: Theme[] = [minimal, forecast, analog, ambient, cinematic];

/** Position of `id` in `themes`; an unknown id uses `fallbackId`, and an unknown fallback uses the first theme. */
export function themeIndex(id: string | undefined, fallbackId: string): number {
  const find = (wanted: string | undefined) => themes.findIndex((t) => t.id === wanted);
  const i = find(id);
  if (i >= 0) return i;
  return Math.max(0, find(fallbackId));
}

/** Steps through the list by `delta`, wrapping past either end. */
export function nextThemeIndex(current: number, delta: number, length: number): number {
  return (((current + delta) % length) + length) % length;
}
