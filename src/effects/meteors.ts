// Meteors: on a clear or partly cloudy night an occasional shooting star crosses the sky, one at a time, every
// 8 to 25 s. The pure half (when one is due, where it starts, how it travels, how bright) is tested; startMeteors
// is the DOM half: one element per meteor on #meteors, removed when its CSS animation ends. The motion is CSS
// (`.meteor`, keyframes `meteor-fly` in src/styles/motion.css), transform and opacity only.

import type { Daypart, EffectKind, Rng, Size } from "./particles";

export const METEOR_MIN_MS = 8000;
export const METEOR_MAX_MS = 25_000;
/** The head of a meteor is never brighter than this (at intensity 1); a black theme scales it by its intensity. */
export const METEOR_MAX_ALPHA = 0.35;

const TRAVEL_MIN_PX = 600;
const TRAVEL_MAX_PX = 900;
/** Heading, degrees below the horizontal, going down and to the left. */
const ANGLE_MIN_DEG = 25;
const ANGLE_MAX_DEG = 50;
const DURATION_MIN_MS = 1200;
const DURATION_MAX_MS = 1800;
const TAIL_MIN_PX = 100;
const TAIL_MAX_PX = 200;
/** Start bands, as fractions of the viewport: the right part of the top edge, or the upper part of the right edge. */
const TOP_BAND = { x0: 0.45, y1: 0.12 };
const RIGHT_BAND = { x0: 0.88, y1: 0.35 };

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const round = (n: number, digits = 2): number => Number(n.toFixed(digits));

export interface Meteor {
  /** Where the head starts and ends, in px from the top left of the viewport. */
  x: number;
  y: number;
  endX: number;
  endY: number;
  /** Heading below the horizontal, degrees (the line itself is rotated by the negative of it). */
  angleDeg: number;
  /** Length of the gradient tail, px. */
  tail: number;
  /** Thickness, px. */
  width: number;
  durationMs: number;
  /** Alpha of the head; the tail fades to nothing. At most METEOR_MAX_ALPHA * intensity. */
  alpha: number;
}

/** Only on clear or partly cloudy nights. */
export function meteorsActive(kind: EffectKind, daypart: Daypart): boolean {
  return daypart === "night" && (kind === "clear" || kind === "partly");
}

/** Gap until the next meteor. */
export function nextMeteorDelayMs(rng: Rng): number {
  return lerp(METEOR_MIN_MS, METEOR_MAX_MS, rng());
}

/** A new meteor starting along the top or right edge of `size` and ending on screen. `intensity` scales the alpha. */
export function createMeteor(size: Size, rng: Rng, intensity = 1): Meteor {
  const band = rng() < 0.5 ? TOP_BAND : RIGHT_BAND;
  const x = round(lerp(size.w * band.x0, size.w, rng()));
  const y = round(lerp(0, size.h * band.y1, rng()));
  const angleDeg = round(lerp(ANGLE_MIN_DEG, ANGLE_MAX_DEG, rng()), 4);
  const travel = lerp(TRAVEL_MIN_PX, TRAVEL_MAX_PX, rng());
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x,
    y,
    endX: round(x - travel * Math.cos(rad)),
    endY: round(y + travel * Math.sin(rad)),
    angleDeg,
    tail: Math.round(lerp(TAIL_MIN_PX, TAIL_MAX_PX, rng())),
    width: round(lerp(1, 2, rng()), 1),
    durationMs: Math.round(lerp(DURATION_MIN_MS, DURATION_MAX_MS, rng())),
    alpha: round(METEOR_MAX_ALPHA * intensity * lerp(0.7, 1, rng()), 3),
  };
}

/** The inline style (custom properties) the `.meteor` CSS reads. */
export function meteorStyle(m: Meteor): string {
  return (
    `--x0:${m.x}px;--y0:${m.y}px;--x1:${m.endX}px;--y1:${m.endY}px;--rot:-${m.angleDeg}deg;` +
    `--len:${m.tail}px;--w:${m.width}px;--dur:${m.durationMs}ms;--a:${m.alpha}`
  );
}

export interface Meteors {
  /** The sky the meteors fall under; they run only while meteorsActive(kind, daypart). Cheap to call every render. */
  setWeather(kind: EffectKind, daypart: Daypart, intensity?: number): void;
}

/**
 * `enabled` is asked each time a meteor is due (reduced motion, ?freeze=1 and the dev panel's switch are its
 * business), so turning it off needs no teardown.
 */
export function startMeteors(layer: HTMLElement, enabled: () => boolean, rng: Rng = Math.random): Meteors {
  let active = false;
  let intensity = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const launch = (): void => {
    const m = createMeteor({ w: window.innerWidth, h: window.innerHeight }, rng, intensity);
    const el = document.createElement("div");
    el.className = "meteor";
    el.setAttribute("style", meteorStyle(m));
    const remove = (): void => el.remove();
    el.addEventListener("animationend", remove, { once: true });
    // Without an animation (it was switched off meanwhile) animationend never comes.
    setTimeout(remove, m.durationMs + 500);
    layer.append(el);
  };

  const schedule = (): void => {
    timer = setTimeout(() => {
      if (!active) return;
      if (enabled() && !document.hidden) launch();
      schedule();
    }, nextMeteorDelayMs(rng));
  };

  return {
    setWeather(kind, daypart, level = 1) {
      intensity = level;
      const want = meteorsActive(kind, daypart);
      if (want === active) return;
      active = want;
      clearTimeout(timer);
      if (active) schedule();
    },
  };
}
