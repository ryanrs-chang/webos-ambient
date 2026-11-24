// Dev-only control panel: a small mouse-driven panel to switch themes, force a weather effect and change the
// brightness while working in a desktop browser. The pure half (isDevMode, buildPanelModel, parseFx) is
// unit tested; mountDevPanel is the DOM half. It is never mounted on the TV (see isDevMode).

import type { Daypart, EffectKind } from "./effects/particles";
import type { Theme } from "./themes/types";
import type { Forecast } from "./weather";

export interface DevLocation {
  protocol: string;
  hostname: string;
  search: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * True on a desktop dev server: http(s) on localhost / 127.0.0.1 / ::1, or anywhere with `?dev=1`.
 * `?dev=0` turns it off even on localhost. Never true for file:, the packaged TV app.
 */
export function isDevMode(loc: DevLocation): boolean {
  if (loc.protocol !== "http:" && loc.protocol !== "https:") return false;
  const flag = new URLSearchParams(loc.search).get("dev");
  if (flag === "0") return false;
  if (flag === "1") return true;
  return LOCAL_HOSTS.has(loc.hostname);
}

export interface ThemeButton {
  id: string;
  name: string;
  active: boolean;
}

/** One entry per theme, with the current one marked. */
export function buildPanelModel(list: readonly Pick<Theme, "id" | "name">[], activeIndex: number): ThemeButton[] {
  return list.map((t, i) => ({ id: t.id, name: t.name, active: i === activeIndex }));
}

export interface FxOption {
  /** What ?fx= takes; "auto" follows the real forecast. */
  value: string;
  label: string;
}

export const FX_OPTIONS: readonly FxOption[] = [
  { value: "auto", label: "自動 (預報)" },
  { value: "rain", label: "雨" },
  { value: "storm", label: "雷雨" },
  { value: "snow", label: "雪" },
  { value: "clear-day", label: "晴 (日)" },
  { value: "clear-night", label: "晴 (夜)" },
  { value: "partly", label: "多雲時晴" },
  { value: "cloudy", label: "陰" },
  { value: "fog", label: "霧" },
];

export interface FxOverride {
  kind: EffectKind;
  daypart: Daypart;
}

const FX_KINDS = new Set<string>(["clear", "partly", "cloudy", "fog", "rain", "snow", "storm"]);

/** A ?fx= value ("rain", "clear-night", "partly-night") as an override; null (auto) for empty, "auto" or unknown. */
export function parseFx(value: string | null | undefined): FxOverride | null {
  if (!value) return null;
  const [kind, daypart] = value.split("-");
  if (!FX_KINDS.has(kind)) return null;
  return { kind: kind as EffectKind, daypart: daypart === "night" ? "night" : "day" };
}

/**
 * What the ?fx= value (or the selector) is called: "auto"/empty follow the real forecast, otherwise one of
 * FX_OPTIONS' values, optionally with a -day / -night suffix.
 */
export type FxKind = string | null | undefined;

// A representative WMO code per kind (see describeWeather).
const PREVIEW_CODE: Record<EffectKind, number | null> = {
  none: null,
  rain: 63,
  storm: 95,
  snow: 73,
  clear: 0,
  partly: 2,
  cloudy: 3,
  fog: 45,
};

/**
 * A copy of the forecast whose current conditions are what the selector asks for, so the themes draw that
 * kind's icon and label (and the ambient backdrop its tint) instead of the real ones. A -day / -night suffix
 * (clear-day, clear-night, partly-night) sets the day flag; otherwise the forecast's own is kept. Temperatures
 * and the hourly strip stay real. "auto", empty and unknown values return the forecast itself; it is never mutated.
 */
export function applyFxPreview(forecast: Forecast, fx: FxKind): Forecast {
  const override = parseFx(fx);
  const code = override ? PREVIEW_CODE[override.kind] : null;
  if (!override || code === null || !fx) return forecast;
  const suffix = fx.split("-")[1];
  const isDay = suffix === "day" ? true : suffix === "night" ? false : forecast.current.isDay;
  return { ...forecast, current: { ...forecast.current, code, isDay } };
}

/** Whether to hold back motion: the OS asks for reduced motion, unless the dev panel forces it on. */
export function isReducedMotion(mediaMatches: boolean, forced: boolean): boolean {
  return mediaMatches && !forced;
}

export const FORCE_MOTION_KEY = "ambient.devpanel.forceMotion";

export interface MotionToggle {
  label: string;
  pressed: boolean;
}

/** The force-motion toggle as the panel shows it. */
export function buildMotionToggle(forced: boolean): MotionToggle {
  return { label: "強制動畫", pressed: forced };
}

type PanelStorage = Pick<Storage, "getItem" | "setItem"> | null;

export function readForceMotion(storage: PanelStorage): boolean {
  try {
    return storage?.getItem(FORCE_MOTION_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeForceMotion(storage: PanelStorage, forced: boolean): void {
  try {
    storage?.setItem(FORCE_MOTION_KEY, forced ? "1" : "0");
  } catch {
    // Storage can be disabled; the toggle then starts off next time.
  }
}

export const FANCY_KEY = "ambient.devpanel.fancy";

/** The four "fancy" effects (src/effects/meteors.ts, shimmer.ts, the orbiting icon dots, the blur-fade entrance). */
export interface FancyFlags {
  meteors: boolean;
  shimmer: boolean;
  orbit: boolean;
  blurFade: boolean;
}

export interface FancyOption {
  key: keyof FancyFlags;
  label: string;
}

export const FANCY_OPTIONS: readonly FancyOption[] = [
  { key: "meteors", label: "流星" },
  { key: "shimmer", label: "掃光" },
  { key: "orbit", label: "環繞點" },
  { key: "blurFade", label: "模糊淡入" },
];

/** What the TV (no dev panel) always runs. */
export const FANCY_ALL_ON: FancyFlags = { meteors: true, shimmer: true, orbit: true, blurFade: true };

/** The stored choice; anything missing, malformed or unreadable counts as on, key by key. */
export function readFancy(storage: PanelStorage): FancyFlags {
  let stored: unknown = null;
  try {
    stored = JSON.parse(storage?.getItem(FANCY_KEY) ?? "null");
  } catch {
    stored = null;
  }
  const obj = typeof stored === "object" && stored !== null ? (stored as Record<string, unknown>) : {};
  const flag = (key: keyof FancyFlags): boolean => (typeof obj[key] === "boolean" ? obj[key] : true) as boolean;
  return { meteors: flag("meteors"), shimmer: flag("shimmer"), orbit: flag("orbit"), blurFade: flag("blurFade") };
}

export function writeFancy(storage: PanelStorage, flags: FancyFlags): void {
  try {
    storage?.setItem(FANCY_KEY, JSON.stringify(flags));
  } catch {
    // Storage can be disabled; the switches then start on next time.
  }
}

export const COLLAPSED_KEY = "ambient.devpanel.collapsed";

export interface DevPanelOptions {
  themes: readonly Pick<Theme, "id" | "name">[];
  themeIndex: number;
  brightness: number;
  /** The ?fx= value the page loaded with; anything unknown shows as auto. */
  fx: string | null;
  /** Whether force-motion is on when the panel opens (read back from storage by the caller). */
  forceMotion: boolean;
  onTheme(index: number): void;
  /** -1 or +1: one brightness step, the same as the remote's Down / Up. */
  onBrightness(direction: -1 | 1): void;
  onFx(value: string): void;
  onForceMotion(forced: boolean): void;
  /** Which fancy effects are on when the panel opens (read back from storage by the caller). */
  fancy: FancyFlags;
  onFancy(flags: FancyFlags): void;
  storage: Pick<Storage, "getItem" | "setItem"> | null;
}

export interface DevPanel {
  /** Reflect the current prefs (called after every change, including ones made with the remote keys). */
  update(state: { themeIndex: number; brightness: number }): void;
}

// Utility classes, written out in full so Tailwind can find them (never assembled from parts). The BEM names stay
// as hooks (the toggle sets font-family only: `font: inherit` would also reset its 16px size); .is-active and .is-collapsed are the states this file toggles.
const PANEL =
  "devpanel fixed top-3 right-3 z-10 flex cursor-auto flex-col items-end gap-1.5 font-ui text-[13px] font-normal text-[#c8c8c8] opacity-85 hover:opacity-100";
const BODY =
  "devpanel__body flex flex-col gap-1.5 rounded-[6px] border border-line bg-[rgba(10,10,10,0.8)] p-2 [.is-collapsed_&]:hidden";
const LABEL = "devpanel__label min-w-[2.5em] text-[#8a8a8a]";
const ROW = "devpanel__row flex items-center gap-1.5";
const CONTROL =
  "cursor-pointer rounded-[4px] border border-[#3a3a3a] bg-[rgba(30,30,30,0.85)] text-inherit hover:border-accent";
const BTN = `devpanel__btn ${CONTROL} [font:inherit] px-2 py-[3px] [&.is-active]:border-accent [&.is-active]:bg-accent [&.is-active]:text-black`;
const SELECT = `devpanel__select ${CONTROL} [font:inherit] px-2 py-[3px]`;
const TOGGLE = `devpanel__toggle ${CONTROL} [font-family:inherit] size-7 p-0 text-[16px] leading-none`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readCollapsed(storage: DevPanelOptions["storage"]): boolean {
  try {
    return storage?.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(storage: DevPanelOptions["storage"], collapsed: boolean): void {
  try {
    storage?.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage can be disabled; the panel then opens expanded next time.
  }
}

/** Builds the panel and appends it to <body>, outside #stage so float / relocation measurement ignores it. */
export function mountDevPanel(opts: DevPanelOptions): DevPanel {
  document.body.classList.add("dev");

  const panel = el("aside", PANEL);
  panel.setAttribute("aria-label", "dev panel");

  const toggle = el("button", TOGGLE, "⚙");
  toggle.type = "button";
  toggle.title = "dev panel";

  const body = el("div", BODY);

  const themeRow = el("div", `${ROW} devpanel__themes`);
  const themeButtons = opts.themes.map((t, i) => {
    const b = el("button", BTN, t.name);
    b.type = "button";
    b.dataset.theme = t.id;
    b.addEventListener("click", () => {
      opts.onTheme(i);
      b.blur();
    });
    themeRow.append(b);
    return b;
  });

  const fxRow = el("label", ROW);
  fxRow.append(el("span", LABEL, "天氣"));
  const select = el("select", SELECT);
  for (const o of FX_OPTIONS) {
    const option = el("option", "", o.label);
    option.value = o.value;
    select.append(option);
  }
  select.value = FX_OPTIONS.some((o) => o.value === opts.fx) ? (opts.fx as string) : "auto";
  select.addEventListener("change", () => {
    opts.onFx(select.value);
    select.blur();
  });
  fxRow.append(select);

  const briRow = el("div", ROW);
  briRow.append(el("span", LABEL, "亮度"));
  const minus = el("button", BTN, "−");
  const plus = el("button", BTN, "+");
  const briValue = el("span", "devpanel__value min-w-[3em] text-center");
  for (const [b, dir] of [
    [minus, -1],
    [plus, 1],
  ] as const) {
    b.type = "button";
    b.addEventListener("click", () => {
      opts.onBrightness(dir);
      b.blur();
    });
  }
  briRow.append(minus, briValue, plus);

  const motionRow = el("label", ROW);
  const motionLabel = el("span", LABEL, buildMotionToggle(opts.forceMotion).label);
  const motionBox = el("input", "devpanel__check m-0 cursor-pointer");
  motionBox.type = "checkbox";
  motionBox.checked = buildMotionToggle(opts.forceMotion).pressed;
  motionBox.addEventListener("change", () => {
    opts.onForceMotion(motionBox.checked);
    motionBox.blur();
  });
  motionRow.append(motionLabel, motionBox);

  const fancyRow = el("div", `${ROW} devpanel__fancy flex-wrap`);
  fancyRow.append(el("span", LABEL, "特效"));
  const fancy = { ...opts.fancy };
  for (const o of FANCY_OPTIONS) {
    const label = el("label", "devpanel__fancy-item flex items-center gap-1");
    const box = el("input", "devpanel__check m-0 cursor-pointer");
    box.type = "checkbox";
    box.checked = fancy[o.key];
    box.dataset.fancy = o.key;
    box.addEventListener("change", () => {
      fancy[o.key] = box.checked;
      opts.onFancy({ ...fancy });
      box.blur();
    });
    label.append(box, el("span", "", o.label));
    fancyRow.append(label);
  }

  body.append(themeRow, fxRow, motionRow, fancyRow, briRow);
  panel.append(toggle, body);
  document.body.append(panel);

  const setCollapsed = (collapsed: boolean) => {
    panel.classList.toggle("is-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  setCollapsed(readCollapsed(opts.storage));
  toggle.addEventListener("click", () => {
    const collapsed = !panel.classList.contains("is-collapsed");
    setCollapsed(collapsed);
    writeCollapsed(opts.storage, collapsed);
    toggle.blur();
  });

  const update = (state: { themeIndex: number; brightness: number }) => {
    buildPanelModel(opts.themes, state.themeIndex).forEach((m, i) => {
      themeButtons[i].classList.toggle("is-active", m.active);
      themeButtons[i].setAttribute("aria-pressed", String(m.active));
    });
    briValue.textContent = `${Math.round(state.brightness * 100)}%`;
  };
  update(opts);

  return { update };
}
