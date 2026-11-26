import type { Config } from "../config";
import type { Indoor } from "../indoor";
import type { Forecast } from "../weather";

/** What the renderer remembers between renders so motion happens once, not on every rebuild of #content. */
export interface AnimState {
  /** The time drawn by the previous render; null on the first render and after a theme switch (no digit roll). */
  prevTime: string | null;
  /** Play the one-off entrance (forecast strip) in this render. */
  enter: boolean;
}

export interface ViewState {
  now: Date;
  forecast: Forecast | null;
  /** The last fetch failed; the forecast on screen is older than it should be. */
  stale: boolean;
  config: Config;
  /** Home Assistant indoor readings; absent or null hides the indoor line. */
  indoor?: Indoor | null;
  anim?: AnimState;
}

export interface Theme {
  id: string;
  name: string;
  /** Markup for the #content element. */
  render(state: ViewState): string;
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for use in element content or a double- or single-quoted attribute. */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** Rounded whole degrees, e.g. 15.8 → "16°". */
export const deg = (n: number): string => `${Math.round(n)}°`;

/** Shown in the weather slot until the first forecast arrives. */
export const LOADING = "天氣載入中…";

/** Class list for a weather block; `stale` lets CSS dim data that is out of date. */
export const weatherClass = (state: ViewState, ...extra: string[]): string =>
  ["weather", ...extra, ...(state.stale ? ["stale"] : [])].join(" ");
