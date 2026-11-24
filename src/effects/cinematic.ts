/**
 * The "cinematic" weather scene (theme 電影感), ported from demos/weather/v1-cinematic.html.
 *
 * Same split as particles.ts: a pure simulation core (`createCineScene` / `stepCine`, injected rng, dt in ms, no DOM)
 * and a thin canvas renderer (`startCinematic`). The core works in a fixed 1920x1080 design space; the renderer
 * scales it to the canvas. Only one effects engine draws at a time: while the cinematic theme is active this scene
 * owns the #effects canvas and the regular particles scene and the meteors are off (`effectPlan`).
 *
 * OLED rule: everything is dim, see `ALPHA_CAP` (v1's levels), every alpha is multiplied by the scene's `intensity`,
 * nothing stays put, and the scene is off under reduced motion (a frozen sun glow would be burn-in).
 *
 * The step allocates nothing per frame: layers, drops, flakes, splashes (a fixed pool) and the shooting star are
 * created once and mutated; only a lightning bolt's path is built (when a bolt starts, every 20-60 s).
 */
import { clampDt, type Daypart, type EffectKind, type Effects, type Rng } from "./particles";

/** The id of the theme in src/themes/cinematic.ts that owns this engine. */
export const CINEMATIC_THEME_ID = "cinematic";

/** The scene is laid out on this canvas; the renderer scales it to the real one. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

const TAU = Math.PI * 2;

/** Brightest alpha per category at intensity 1 (v1's levels). Every value in a scene is at most cap x intensity. */
export const ALPHA_CAP = {
  rain: 0.4,
  clouds: 0.18,
  fog: 0.2,
  snow: 0.55,
  stars: 0.7,
  moon: 0.32,
  motes: 0.22,
  /** Peak of the baked sun halo, scaled by the sun's brightness. */
  sun: 0.34,
  shoot: 0.45,
  /** The full-screen lightning flash. */
  flash: 0.1,
  /** The thin core of the bolt itself. */
  bolt: 0.5,
} as const;

/** Upper bound on things per scene (the heaviest kind decides each). */
export const MAX_COUNTS = {
  rain: 390,
  snow: 274,
  stars: 192,
  clouds: 11,
  fog: 5,
  splashes: 36,
  motes: 34,
} as const;

/** Realistic spacing, not v1's demo timings. Start to start. */
export const LIGHTNING_MIN_MS = 20_000;
export const LIGHTNING_MAX_MS = 60_000;
export const SHOOT_MIN_MS = 15_000;
export const SHOOT_MAX_MS = 45_000;
export const BOLT_DURATION_MS = 600;
/** The bolt's line is visible for this long; the flash lasts BOLT_DURATION_MS. */
const BOLT_LINE_MS = 350;

const SPLASH_S = 0.55;
/** Peak alpha of a ground ripple and of its droplets, both under ALPHA_CAP.rain. */
const RIPPLE_ALPHA = 0.3;
const DROPLET_ALPHA = 0.38;
const MOTE_PEAK = 0.22;

const between = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);

// ---------------------------------------------------------------------------------------------------------
// Which scene, and which engine

export type CineId =
  | "none"
  | "clear-day"
  | "clear-night"
  | "partly-day"
  | "partly-night"
  | "cloudy"
  | "rain"
  | "storm"
  | "snow"
  | "fog";

/** Only clear and partly cloudy differ between day and night. */
export function cineSceneId(kind: EffectKind, daypart: Daypart): CineId {
  if (kind === "none") return "none";
  if (kind === "clear" || kind === "partly") return `${kind}-${daypart}`;
  return kind;
}

export type EngineName = "particles" | "cinematic" | "off";

export interface EffectPlan {
  /** Who draws on #effects. "off" draws nothing. */
  engine: EngineName;
  /** Whether the meteors layer may run (it has its own gates for reduced motion and ?freeze=1). */
  meteors: boolean;
}

/**
 * One effects engine draws at a time. The cinematic theme draws its own scene (which has its own shooting star, so
 * no meteors); it is off when `still` is set (reduced motion, ?freeze=1) rather than frozen on one frame. Every
 * other theme keeps the regular particles, which have their own gates.
 */
export function effectPlan(themeId: string, still: boolean): EffectPlan {
  if (themeId !== CINEMATIC_THEME_ID) return { engine: "particles", meteors: true };
  return { engine: still ? "off" : "cinematic", meteors: false };
}

// ---------------------------------------------------------------------------------------------------------
// Sprite data (the renderer paints these once)

export type Tone = "cool" | "dark" | "warm";
const TONES: Tone[] = ["cool", "dark", "warm"];
export const CLOUD_VARIANT_COUNT = 4;
export const CLOUD_SPRITE_W = 760;
export const CLOUD_SPRITE_H = 260;
export const FOG_SPRITE_W = 2600;
export const FOG_SPRITE_H = 360;

/** v1's small seeded generator, so a sprite looks the same every run. */
function seeded(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Puff {
  x: number;
  y: number;
  rad: number;
}

export interface SpriteLayout {
  w: number;
  h: number;
  puffs: Puff[];
}

/** A layered cloud: 18 overlapping soft puffs, tallest in the middle, sitting on a common base line. */
export function cloudPuffs(variant: number, tone: Tone): SpriteLayout {
  const w = CLOUD_SPRITE_W;
  const h = CLOUD_SPRITE_H;
  const r = seeded((variant + 1) * 77 + TONES.indexOf(tone) * 13);
  const puffs: Puff[] = [];
  for (let i = 0; i < 18; i++) {
    const x = w * (0.1 + 0.8 * r());
    const edge = Math.abs(x / w - 0.5) * 2;
    const rad = h * (0.2 + 0.24 * r()) * (1 - 0.5 * edge);
    const y = h * 0.64 - rad * 0.5 * r() - (1 - edge) * h * 0.14 * r();
    puffs.push({ x, y, rad });
  }
  return { w, h, puffs };
}

/** A fog band: 34 wide puffs (the painter squashes them to a third of their height). */
export function fogPuffs(seed: number): SpriteLayout {
  const w = FOG_SPRITE_W;
  const h = FOG_SPRITE_H;
  const r = seeded(seed * 101 + 5);
  const puffs: Puff[] = [];
  for (let i = 0; i < 34; i++) {
    const x = w * r();
    const y = h * (0.5 + (r() - 0.5) * 0.28);
    puffs.push({ x, y, rad: 140 + r() * 120 });
  }
  return { w, h, puffs };
}

// ---------------------------------------------------------------------------------------------------------
// Scene

export interface CineCloud {
  tone: Tone;
  variant: number;
  x: number;
  /** Drawn y: baseY plus the slow bob. */
  y: number;
  baseY: number;
  w: number;
  h: number;
  vx: number;
  alpha: number;
  /** ALPHA_CAP.clouds x intensity: what a flash may lift `alpha` to. */
  cap: number;
  bob: number;
  phase: number;
  /** Bob frequency, cycles per second. */
  bf: number;
  scale: number;
}

export interface Drop {
  x: number;
  y: number;
  len: number;
  s: number;
  /** The y it lands at. */
  gy: number;
}

export interface RainLayer {
  /** Stroke alpha, at most ALPHA_CAP.rain x intensity. */
  a: number;
  width: number;
  /** How much of the wind this layer feels (nearer layers lean more). */
  wf: number;
  /** Chance a landing drop leaves a splash, and the splash scale. */
  splashChance: number;
  splashScale: number;
  lenRange: [number, number];
  speedRange: [number, number];
  groundRange: [number, number];
  drops: Drop[];
}

export interface Flake {
  x: number;
  y: number;
  r: number;
  s: number;
  sw: number;
  ph: number;
  f: number;
}

export interface SnowLayer {
  a: number;
  wf: number;
  flakes: Flake[];
}

export interface Star {
  x: number;
  y: number;
  ph: number;
  f: number;
  b: number;
}

export interface StarLayer {
  /** Brightest twinkle, at most ALPHA_CAP.stars x intensity. */
  a: number;
  /** Side (px) of a plain star, or of the soft sprite. */
  size: number;
  /** How much this layer follows the slow sky rotation. */
  rot: number;
  sprite: boolean;
  stars: Star[];
}

export interface FogBand {
  y: number;
  /** Size multiplier on the fog sprite. */
  w: number;
  /** Peak alpha, at most ALPHA_CAP.fog x intensity. */
  a: number;
  om: number;
  ph: number;
  alt: number;
  bp: number;
  bph: number;
  /** Per step: where it is drawn and how bright. */
  x: number;
  dy: number;
  alpha: number;
}

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ph: number;
}

export interface Splash {
  active: boolean;
  x: number;
  y: number;
  /** Seconds since it landed. */
  t: number;
  sc: number;
  /** Three droplets: initial velocity. */
  d: Array<{ vx: number; vy: number }>;
}

export interface Sun {
  x: number;
  y: number;
  /** Brightness 0..1 x intensity (0.62 of clear in a partly cloudy sky). */
  br: number;
  partly: boolean;
  rayA: number;
  rayB: number;
}

export interface Moon {
  x: number;
  y: number;
  glow: number;
  disc: number;
}

export interface Shoot {
  active: boolean;
  untilNextMs: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since it started, and how long it lasts. */
  t: number;
  dur: number;
  len: number;
  /** Brightest the head gets, at most ALPHA_CAP.shoot x intensity. */
  peak: number;
}

export type BoltPath = Array<[number, number]>;

export interface Storm {
  untilNextMs: number;
  /** ms since the running bolt started; null while idle. */
  activeMs: number | null;
  /** The main trunk is last; the others are its branches. Empty while idle. */
  paths: BoltPath[];
}

export interface CineScene {
  kind: EffectKind;
  daypart: Daypart;
  id: CineId;
  intensity: number;
  /** Scene time, ms. */
  tMs: number;
  /** Horizontal wind, px/s, from the gust level. */
  wind: number;
  clouds: CineCloud[];
  rain: RainLayer[];
  snow: SnowLayer[];
  starLayers: StarLayer[];
  fog: FogBand[];
  motes: Mote[];
  splashes: Splash[];
  sun: Sun | null;
  moon: Moon | null;
  shoot: Shoot | null;
  storm: Storm | null;
  /** The full-screen flash right now, 0..ALPHA_CAP.flash x intensity. */
  flashLevel: number;
}

interface CloudDef {
  n: number;
  y: [number, number];
  sc: [number, number];
  v: [number, number];
  a: number;
  tone: Tone;
}

const CLOUD_DEFS: Record<CineId, CloudDef[]> = {
  none: [],
  "clear-day": [{ n: 2, y: [60, 260], sc: [0.8, 1.1], v: [4, 7], a: 0.07, tone: "warm" }],
  "clear-night": [{ n: 1, y: [120, 300], sc: [1.1, 1.4], v: [3, 5], a: 0.06, tone: "cool" }],
  "partly-day": [
    { n: 3, y: [40, 220], sc: [0.6, 0.9], v: [4, 7], a: 0.1, tone: "warm" },
    { n: 2, y: [120, 380], sc: [1, 1.4], v: [8, 12], a: 0.15, tone: "cool" },
    { n: 1, y: [250, 430], sc: [1.7, 2], v: [14, 18], a: 0.15, tone: "cool" },
  ],
  "partly-night": [
    { n: 2, y: [60, 240], sc: [0.8, 1.1], v: [4, 7], a: 0.08, tone: "cool" },
    { n: 2, y: [150, 380], sc: [1.2, 1.6], v: [8, 12], a: 0.12, tone: "cool" },
  ],
  cloudy: [
    { n: 4, y: [-20, 160], sc: [0.9, 1.3], v: [5, 8], a: 0.12, tone: "cool" },
    { n: 4, y: [80, 320], sc: [1.3, 1.8], v: [9, 14], a: 0.16, tone: "cool" },
    { n: 3, y: [220, 460], sc: [1.9, 2.4], v: [16, 22], a: 0.18, tone: "dark" },
  ],
  rain: [
    { n: 3, y: [-20, 200], sc: [1.1, 1.5], v: [8, 12], a: 0.12, tone: "dark" },
    { n: 3, y: [120, 380], sc: [1.8, 2.3], v: [16, 22], a: 0.15, tone: "dark" },
  ],
  storm: [
    { n: 4, y: [-30, 220], sc: [1.2, 1.7], v: [14, 20], a: 0.13, tone: "dark" },
    { n: 4, y: [100, 420], sc: [2, 2.6], v: [26, 34], a: 0.17, tone: "dark" },
  ],
  snow: [
    { n: 3, y: [-30, 180], sc: [1.1, 1.6], v: [5, 8], a: 0.1, tone: "cool" },
    { n: 2, y: [100, 300], sc: [1.8, 2.2], v: [9, 12], a: 0.12, tone: "cool" },
  ],
  fog: [],
};

function makeClouds(id: CineId, rng: Rng, intensity: number): CineCloud[] {
  const out: CineCloud[] = [];
  for (const d of CLOUD_DEFS[id]) {
    for (let i = 0; i < d.n; i++) {
      const scale = between(rng, d.sc[0], d.sc[1]);
      const w = CLOUD_SPRITE_W * scale;
      const baseY = between(rng, d.y[0], d.y[1]);
      out.push({
        tone: d.tone,
        variant: Math.min(CLOUD_VARIANT_COUNT - 1, Math.floor(rng() * CLOUD_VARIANT_COUNT)),
        x: between(rng, -w, DESIGN_W),
        y: baseY,
        baseY,
        w,
        h: CLOUD_SPRITE_H * scale,
        vx: between(rng, d.v[0], d.v[1]),
        alpha: d.a * between(rng, 0.85, 1) * intensity,
        cap: ALPHA_CAP.clouds * intensity,
        bob: between(rng, 4, 12),
        phase: rng() * TAU,
        bf: between(rng, 0.04, 0.09),
        scale,
      });
    }
  }
  // Small (far) clouds first, so near ones draw over them.
  return out.sort((a, b) => a.scale - b.scale);
}

function respawnDrop(d: Drop, l: RainLayer, rng: Rng, initial: boolean): void {
  d.len = between(rng, l.lenRange[0], l.lenRange[1]);
  d.s = between(rng, l.speedRange[0], l.speedRange[1]);
  d.gy = between(rng, l.groundRange[0], l.groundRange[1]);
  d.x = between(rng, -300, DESIGN_W + 100);
  d.y = initial ? between(rng, -d.len, d.gy) : -d.len - between(rng, 0, 200);
}

function makeRain(heavy: boolean, rng: Rng, intensity: number): RainLayer[] {
  const defs = [
    { n: heavy ? 190 : 130, len: [14, 26], w: 0.9, sp: [560, 680], a: 0.16, g: [760, 880], sc: 0.45, wf: 0.5, ch: 0 },
    {
      n: heavy ? 130 : 85,
      len: [26, 40],
      w: 1.2,
      sp: [820, 960],
      a: 0.28,
      g: [900, 1000],
      sc: 0.75,
      wf: 0.75,
      ch: 0.15,
    },
    { n: heavy ? 70 : 42, len: [40, 60], w: 1.6, sp: [1150, 1350], a: 0.4, g: [1020, 1072], sc: 1.2, wf: 1, ch: 0.5 },
  ] as const;
  return defs.map((d) => {
    const layer: RainLayer = {
      a: d.a * intensity,
      width: d.w,
      wf: d.wf,
      splashChance: d.ch,
      splashScale: d.sc,
      lenRange: [d.len[0], d.len[1]],
      speedRange: [d.sp[0], d.sp[1]],
      groundRange: [d.g[0], d.g[1]],
      drops: [],
    };
    for (let i = 0; i < d.n; i++) {
      const drop: Drop = { x: 0, y: 0, len: 0, s: 0, gy: 0 };
      respawnDrop(drop, layer, rng, true);
      layer.drops.push(drop);
    }
    return layer;
  });
}

function makeSplashes(): Splash[] {
  return Array.from({ length: MAX_COUNTS.splashes }, () => ({
    active: false,
    x: 0,
    y: 0,
    t: 0,
    sc: 1,
    d: [
      { vx: 0, vy: 0 },
      { vx: 0, vy: 0 },
      { vx: 0, vy: 0 },
    ],
  }));
}

function makeSnow(rng: Rng, intensity: number): SnowLayer[] {
  const defs = [
    { n: 150, r: [1, 1.7], sp: [28, 46], a: 0.25, sw: [8, 20], wf: 0.35 },
    { n: 90, r: [2, 3.2], sp: [60, 90], a: 0.4, sw: [14, 30], wf: 0.65 },
    { n: 34, r: [4, 6.5], sp: [110, 150], a: 0.55, sw: [20, 40], wf: 1 },
  ] as const;
  return defs.map((d) => ({
    a: d.a * intensity,
    wf: d.wf,
    flakes: Array.from({ length: d.n }, () => ({
      x: between(rng, -100, DESIGN_W + 100),
      y: between(rng, -20, DESIGN_H),
      r: between(rng, d.r[0], d.r[1]),
      s: between(rng, d.sp[0], d.sp[1]),
      sw: between(rng, d.sw[0], d.sw[1]),
      ph: rng() * TAU,
      f: between(rng, 0.4, 1.1),
    })),
  }));
}

function makeStars(rng: Rng, intensity: number): StarLayer[] {
  const defs = [
    { n: 110, s: 1.6, a: 0.35, rot: 0.5, sprite: false },
    { n: 60, s: 2.2, a: 0.5, rot: 0.8, sprite: false },
    { n: 22, s: 12, a: 0.7, rot: 1.1, sprite: true },
  ] as const;
  return defs.map((d) => ({
    a: d.a * intensity,
    size: d.s,
    rot: d.rot,
    sprite: d.sprite,
    stars: Array.from({ length: d.n }, () => ({
      x: between(rng, -250, DESIGN_W + 250),
      y: between(rng, -150, DESIGN_H * 0.85),
      ph: rng() * TAU,
      f: between(rng, 0.5, 2.2),
      b: between(rng, 0.55, 1),
    })),
  }));
}

function makeFog(rng: Rng, intensity: number): FogBand[] {
  return [0, 1, 2, 3, 4].map((i) => ({
    y: 150 + i * 175,
    w: between(rng, 0.9, 1.25),
    a: (0.14 + 0.04 * (i % 2)) * intensity,
    om: between(rng, 0.012, 0.03),
    ph: rng() * TAU,
    alt: i % 2,
    bp: between(rng, 0.05, 0.1),
    bph: rng() * TAU,
    x: -500,
    dy: 0,
    alpha: 0,
  }));
}

function makeMotes(rng: Rng): Mote[] {
  return Array.from({ length: MAX_COUNTS.motes }, () => ({
    x: between(rng, 0, DESIGN_W),
    y: between(rng, 0, DESIGN_H),
    vx: between(rng, 4, 12),
    vy: between(rng, -10, -3),
    ph: rng() * TAU,
  }));
}

/** `intensity` scales every alpha: nothing in the scene (nor the flash) exceeds ALPHA_CAP x intensity. */
export function createCineScene(kind: EffectKind, daypart: Daypart, rng: Rng, intensity = 1): CineScene {
  const id = cineSceneId(kind, daypart);
  const day = id === "clear-day" || id === "partly-day";
  const night = id === "clear-night" || id === "partly-night";
  const rainy = id === "rain" || id === "storm";
  const scene: CineScene = {
    kind,
    daypart,
    id,
    intensity,
    tMs: 0,
    wind: 20,
    clouds: makeClouds(id, rng, intensity),
    rain: rainy ? makeRain(id === "storm", rng, intensity) : [],
    snow: id === "snow" ? makeSnow(rng, intensity) : [],
    starLayers: night ? makeStars(rng, intensity) : [],
    fog: id === "fog" ? makeFog(rng, intensity) : [],
    motes: day ? makeMotes(rng) : [],
    splashes: rainy ? makeSplashes() : [],
    sun: day ? { x: 0, y: 0, br: 0, partly: id === "partly-day", rayA: 0, rayB: 0 } : null,
    moon: night ? { x: 0, y: 0, glow: ALPHA_CAP.moon * intensity, disc: 0.3 * intensity } : null,
    shoot: night
      ? {
          active: false,
          untilNextMs: between(rng, SHOOT_MIN_MS, SHOOT_MAX_MS),
          x: 0,
          y: 0,
          vx: 0,
          vy: 0,
          t: 0,
          dur: 1,
          len: 200,
          peak: ALPHA_CAP.shoot * intensity,
        }
      : null,
    storm:
      id === "storm"
        ? { untilNextMs: between(rng, LIGHTNING_MIN_MS, LIGHTNING_MAX_MS), activeMs: null, paths: [] }
        : null,
    flashLevel: 0,
  };
  updateCelestial(scene, 0);
  return scene;
}

// ---------------------------------------------------------------------------------------------------------
// Pure helpers the renderer shares with the tests

/** 0..1, slow and uneven: a product of two sines, squared so calm stretches are common. Input in seconds. */
export function gustLevel(tSec: number): number {
  const g = 0.5 + 0.5 * Math.sin(tSec * 0.31) * Math.sin(tSec * 0.17 + 1.2);
  return g * g;
}

/** The full-screen flash at `ms` into a bolt: a double pulse peaking at ALPHA_CAP.flash, 0 after 600 ms. */
export function lightningFlash(ms: number): number {
  const t = ms / 1000;
  const peak = ALPHA_CAP.flash;
  if (t < 0 || t >= BOLT_DURATION_MS / 1000) return 0;
  if (t < 0.06) return (peak * t) / 0.06;
  if (t < 0.14) return peak - (0.06 * (t - 0.06)) / 0.08;
  if (t < 0.22) return 0.04 + (0.06 * (t - 0.14)) / 0.08;
  return peak * Math.max(0, 1 - (t - 0.22) / 0.38);
}

/** How strongly the bolt line itself shows, 1 at the start fading to 0 at 350 ms. */
export function boltStrength(ms: number): number {
  if (ms >= BOLT_LINE_MS) return 0;
  return Math.max(0, Math.min(1, 1 - (ms / 1000 - 0.1) / 0.25));
}

/** A cloud's alpha now: the flash lifts it (v1's x7), but never past the cloud cap. */
export function cloudDrawAlpha(c: CineCloud, flash: number): number {
  return Math.min(c.cap, c.alpha * (1 + flash * 7));
}

/** A star's twinkling alpha at `tSec`; never above its layer's `a`. */
export function starAlpha(layer: StarLayer, star: Star, tSec: number): number {
  return layer.a * star.b * (0.55 + 0.45 * Math.sin(tSec * star.f + star.ph));
}

export function moteAlpha(m: Mote, tSec: number, intensity: number): number {
  return (0.1 + 0.12 * Math.sin(tSec * 0.9 + m.ph)) * intensity;
}

/** A splash's ripple and droplet alphas, `p` = progress 0..1. */
export const rippleAlpha = (p: number, intensity: number): number => (1 - p) * RIPPLE_ALPHA * intensity;
export const dropletAlpha = (p: number, intensity: number): number => (1 - p) * DROPLET_ALPHA * intensity;
export const SPLASH_SECONDS = SPLASH_S;
export const MOTE_MAX_ALPHA = MOTE_PEAK;

/** A forked bolt from the top: one trunk (last in the list) with occasional short branches. */
export function makeBolt(rng: Rng): BoltPath[] {
  const x0 = between(rng, 300, DESIGN_W - 300);
  const depth = between(rng, 520, 700);
  const paths: BoltPath[] = [];
  const main: BoltPath = [[x0, -10]];
  let x = x0;
  let y = -10;
  while (y < depth) {
    x += between(rng, -55, 55);
    y += between(rng, 35, 70);
    main.push([x, y]);
    if (rng() < 0.22) {
      const branch: BoltPath = [[x, y]];
      let bx = x;
      let by = y;
      for (let i = 0; i < 4; i++) {
        bx += between(rng, 10, 60) * (rng() < 0.5 ? -1 : 1);
        by += between(rng, 25, 50);
        branch.push([bx, by]);
      }
      paths.push(branch);
    }
  }
  paths.push(main);
  return paths;
}

function windFor(id: CineId, gust: number): number {
  if (id === "storm") return 300 + gust * 220;
  if (id === "rain") return 130 + gust * 90;
  if (id === "snow") return 25 + gust * 190;
  return 20;
}

function addSplash(pool: Splash[], x: number, y: number, sc: number, rng: Rng): void {
  for (const p of pool) {
    if (p.active) continue;
    p.active = true;
    p.x = x;
    p.y = y;
    p.t = 0;
    p.sc = sc;
    for (const q of p.d) {
      q.vx = between(rng, -60, 60) * sc;
      q.vy = between(rng, -180, -90) * sc;
    }
    return;
  }
}

/** Sun, rays and moon positions and the sun's slow breathing, all from scene time. */
function updateCelestial(s: CineScene, dtMs: number): void {
  const t = s.tMs / 1000;
  if (s.sun) {
    s.sun.x = 1460 + 34 * Math.sin(t / 27);
    s.sun.y = 250 + 14 * Math.cos(t / 33);
    s.sun.br = (s.sun.partly ? 0.62 : 1) * (0.88 + 0.12 * Math.sin(t * 0.45)) * s.intensity;
    // Two ray layers turning against each other (v1: +0.012 rad/s and, net of the second rotate, -0.009 rad/s).
    s.sun.rayA = t * 0.012;
    s.sun.rayB = -t * 0.009;
  }
  if (s.moon) {
    s.moon.x = 1480 + 16 * Math.sin(t / 41);
    s.moon.y = 230 + 8 * Math.cos(t / 37);
  }
  for (const m of s.motes) {
    m.x += (m.vx * dtMs) / 1000;
    m.y += (m.vy * dtMs) / 1000;
    if (m.x > DESIGN_W) m.x = 0;
    if (m.y < 0) m.y = DESIGN_H;
  }
}

/**
 * Advances the scene by `dtMs` (callers clamp it with `clampDt`). Mutates and returns the scene; allocates nothing
 * except a bolt's path when lightning starts.
 */
export function stepCine(s: CineScene, dtMs: number, rng: Rng): CineScene {
  s.tMs += dtMs;
  const dt = dtMs / 1000;
  const t = s.tMs / 1000;
  const gust = gustLevel(t);
  s.wind = windFor(s.id, gust);

  for (const c of s.clouds) {
    c.x += c.vx * dt * (1 + gust * 0.4);
    if (c.x > DESIGN_W + 20) c.x = -c.w;
    c.y = c.baseY + Math.sin(t * c.bf * TAU + c.phase) * c.bob;
  }

  updateCelestial(s, dtMs);

  for (const band of s.fog) {
    band.x = -500 + 380 * Math.sin(t * band.om + band.ph) * (band.alt ? -1 : 1);
    band.dy = Math.sin(t * 0.07 + band.ph) * 18;
    band.alpha = band.a * (0.85 + 0.15 * Math.sin(t * band.bp + band.bph));
  }

  for (const l of s.rain) {
    const lean = s.wind * l.wf;
    for (const d of l.drops) {
      d.y += d.s * dt;
      d.x += lean * dt;
      if (d.y >= d.gy) {
        // It hit the ground: sometimes a splash, then it respawns at the top.
        if (rng() < l.splashChance && d.x > 0 && d.x < DESIGN_W) addSplash(s.splashes, d.x, d.gy, l.splashScale, rng);
        respawnDrop(d, l, rng, false);
      }
    }
  }
  for (const p of s.splashes) {
    if (!p.active) continue;
    p.t += dt;
    if (p.t >= SPLASH_S) p.active = false;
  }

  for (const l of s.snow) {
    for (const f of l.flakes) {
      f.y += f.s * dt;
      f.x += (s.wind * l.wf + Math.sin(t * f.f + f.ph) * f.sw) * dt;
      if (f.y > DESIGN_H + 10) {
        f.y = -10;
        f.x = between(rng, -100, DESIGN_W + 100);
      }
      if (f.x > DESIGN_W + 60) f.x = -60;
      else if (f.x < -60) f.x = DESIGN_W + 60;
    }
  }

  if (s.shoot) stepShoot(s.shoot, dtMs, rng, s.intensity);
  s.flashLevel = s.storm ? stepStorm(s.storm, dtMs, rng) * s.intensity : 0;
  return s;
}

function stepShoot(sh: Shoot, dtMs: number, rng: Rng, intensity: number): void {
  if (sh.active) {
    sh.t += dtMs / 1000;
    sh.x += (sh.vx * dtMs) / 1000;
    sh.y += (sh.vy * dtMs) / 1000;
    if (sh.t >= sh.dur) sh.active = false;
  }
  sh.untilNextMs -= dtMs;
  if (sh.untilNextMs <= 0 && !sh.active) {
    // Start to start spacing: keep the overshoot, like the storm flash scheduler.
    sh.untilNextMs += between(rng, SHOOT_MIN_MS, SHOOT_MAX_MS);
    const angle = between(rng, 0.4, 0.65);
    const speed = between(rng, 900, 1300);
    sh.active = true;
    sh.x = between(rng, DESIGN_W * 0.5, DESIGN_W);
    sh.y = between(rng, 20, DESIGN_H * 0.3);
    sh.vx = -Math.cos(angle) * speed;
    sh.vy = Math.sin(angle) * speed;
    sh.t = 0;
    sh.dur = between(rng, 0.7, 1.1);
    sh.len = between(rng, 190, 300);
    sh.peak = ALPHA_CAP.shoot * intensity;
  }
}

/** Returns the flash level (before intensity) for this step. */
function stepStorm(st: Storm, dtMs: number, rng: Rng): number {
  if (st.activeMs !== null) {
    st.activeMs += dtMs;
    if (st.activeMs >= BOLT_DURATION_MS) {
      st.activeMs = null;
      st.paths = [];
    }
  }
  st.untilNextMs -= dtMs;
  if (st.untilNextMs <= 0) {
    st.untilNextMs += between(rng, LIGHTNING_MIN_MS, LIGHTNING_MAX_MS);
    st.activeMs = 0;
    st.paths = makeBolt(rng);
  }
  return st.activeMs === null ? 0 : lightningFlash(st.activeMs);
}

// ---------------------------------------------------------------------------------------------------------
// Canvas renderer

const FADE_MS = 1500;
/** ~30 fps: a little under 1000/30 for rAF jitter. */
const FRAME_MS = 1000 / 30 - 4;

const sprites = new Map<string, HTMLCanvasElement>();

function sprite(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  let c = sprites.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (g) paint(g);
    sprites.set(key, c);
  }
  return c;
}

const CLOUD_TONES: Record<Tone, [string, string]> = {
  cool: ["rgba(215,228,255,0)", "rgba(45,60,92,.6)"],
  dark: ["rgba(150,165,195,0)", "rgba(15,22,40,.8)"],
  warm: ["rgba(255,235,205,0)", "rgba(90,70,70,.5)"],
};

function cloudSprite(variant: number, tone: Tone): HTMLCanvasElement {
  const { w, h, puffs } = cloudPuffs(variant, tone);
  return sprite(`cloud:${tone}:${variant}`, w, h, (g) => {
    for (const p of puffs) {
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rad);
      grad.addColorStop(0, "rgba(255,255,255,.6)");
      grad.addColorStop(0.55, "rgba(255,255,255,.24)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, p.rad, 0, TAU);
      g.fill();
    }
    // Flat base...
    g.globalCompositeOperation = "destination-out";
    let grad = g.createLinearGradient(0, h * 0.64, 0, h * 0.82);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,1)");
    g.fillStyle = grad;
    g.fillRect(0, h * 0.64, w, h);
    // ...and a darker underside.
    g.globalCompositeOperation = "source-atop";
    grad = g.createLinearGradient(0, h * 0.12, 0, h * 0.72);
    grad.addColorStop(0, CLOUD_TONES[tone][0]);
    grad.addColorStop(1, CLOUD_TONES[tone][1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  });
}

function softDot(key: string, size: number, rgb: string): HTMLCanvasElement {
  return sprite(key, size, size, (g) => {
    const h = size / 2;
    const grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.45, `rgba(${rgb},.5)`);
    grad.addColorStop(0.94, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  });
}

/** The glow is a gradient, so it is painted at half size (650 px) and drawn at 1300. */
function sunSprite(): HTMLCanvasElement {
  return sprite("sun", 650, 650, (g) => {
    g.scale(0.5, 0.5);
    const s = 1300;
    const h = s / 2;
    let grad = g.createRadialGradient(h, h, 0, h, h, h);
    grad.addColorStop(0, "rgba(255,214,150,.30)");
    grad.addColorStop(0.1, "rgba(255,196,120,.20)");
    grad.addColorStop(0.3, "rgba(255,170,90,.08)");
    grad.addColorStop(1, "rgba(255,150,70,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    grad = g.createRadialGradient(h, h, 0, h, h, 60);
    grad.addColorStop(0, "rgba(255,232,190,.34)");
    grad.addColorStop(0.7, "rgba(255,220,160,.30)");
    grad.addColorStop(1, "rgba(255,210,150,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(h, h, 60, 0, TAU);
    g.fill();
  });
}

/** Fourteen soft wedges around a centre, painted at half size (600 px) and drawn at 1200. */
function raySprite(): HTMLCanvasElement {
  return sprite("rays", 600, 600, (g) => {
    g.scale(0.5, 0.5);
    const h = 600;
    const r = seeded(9);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + r() * 0.2;
      const wd = 0.025 + r() * 0.04;
      const grad = g.createRadialGradient(h, h, 40, h, h, h);
      grad.addColorStop(0, "rgba(255,215,150,.12)");
      grad.addColorStop(1, "rgba(255,200,130,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(h, h);
      g.arc(h, h, h, a - wd, a + wd);
      g.closePath();
      g.fill();
    }
  });
}

/** A wide band of flat puffs, painted at half size and drawn at FOG_SPRITE_W x FOG_SPRITE_H. */
function fogSprite(seed: number): HTMLCanvasElement {
  const { w, h, puffs } = fogPuffs(seed);
  return sprite(`fog:${seed}`, w / 2, h / 2, (g) => {
    g.scale(0.5, 0.5);
    for (const p of puffs) {
      g.save();
      g.translate(p.x, p.y);
      g.scale(1, 0.34);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, p.rad);
      grad.addColorStop(0, "rgba(200,214,235,.5)");
      grad.addColorStop(1, "rgba(200,214,235,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, p.rad, 0, TAU);
      g.fill();
      g.restore();
    }
  });
}

const FOG_SEEDS = [3, 8];

/** Paints every sprite a scene will need now, so the first frame does not stall on gradients. */
function warm(scene: CineScene): void {
  for (const c of scene.clouds) cloudSprite(c.variant, c.tone);
  if (scene.sun) {
    sunSprite();
    raySprite();
  }
  if (scene.moon || scene.starLayers.length > 0) softDot("star", 24, "225,235,255");
  if (scene.snow.length > 0) softDot("flake", 32, "235,242,255");
  if (scene.fog.length > 0) for (const seed of FOG_SEEDS) fogSprite(seed);
}

function drawScene(ctx: CanvasRenderingContext2D, s: CineScene, fade: number): void {
  const tSec = s.tMs / 1000;
  const I = s.intensity;

  if (s.sun) {
    const { x, y, br, partly, rayA, rayB } = s.sun;
    ctx.globalAlpha = br * fade;
    ctx.drawImage(sunSprite(), x - 650, y - 650, 1300, 1300);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rayA);
    ctx.globalAlpha = br * fade * (partly ? 0.6 : 0.9);
    ctx.drawImage(raySprite(), -600, -600, 1200, 1200);
    ctx.rotate(rayB - rayA);
    ctx.globalAlpha *= 0.55;
    ctx.drawImage(raySprite(), -600, -600, 1200, 1200);
    ctx.restore();
    ctx.fillStyle = "rgb(255,235,200)";
    for (const m of s.motes) {
      ctx.globalAlpha = moteAlpha(m, tSec, I) * fade;
      ctx.fillRect(m.x | 0, m.y | 0, 2, 2);
    }
  }

  if (s.moon) {
    const star = softDot("star", 24, "225,235,255");
    ctx.globalAlpha = s.moon.glow * fade;
    ctx.drawImage(star, s.moon.x - 260, s.moon.y - 260, 520, 520);
    ctx.globalAlpha = s.moon.disc * fade;
    ctx.fillStyle = "rgb(215,224,240)";
    ctx.beginPath();
    ctx.arc(s.moon.x, s.moon.y, 38, 0, TAU);
    ctx.fill();
  }

  if (s.starLayers.length > 0) {
    const star = softDot("star", 24, "225,235,255");
    const sky = 0.05 * Math.sin(tSec / 600);
    ctx.fillStyle = "rgb(220,230,255)";
    for (const l of s.starLayers) {
      ctx.save();
      ctx.translate(DESIGN_W * 0.75, DESIGN_H * 1.3);
      ctx.rotate(sky * l.rot);
      ctx.translate(-DESIGN_W * 0.75, -DESIGN_H * 1.3);
      const half = l.size / 2;
      for (const st of l.stars) {
        ctx.globalAlpha = starAlpha(l, st, tSec) * fade;
        if (l.sprite) ctx.drawImage(star, st.x - half, st.y - half, l.size, l.size);
        else ctx.fillRect(st.x, st.y, l.size, l.size);
      }
      ctx.restore();
    }
    if (s.shoot?.active) drawShoot(ctx, s.shoot, fade);
  }

  const flash = s.flashLevel;
  for (const c of s.clouds) {
    ctx.globalAlpha = cloudDrawAlpha(c, flash) * fade;
    ctx.drawImage(cloudSprite(c.variant, c.tone), c.x, c.y, c.w, c.h);
  }

  for (let i = 0; i < s.fog.length; i++) {
    const b = s.fog[i];
    ctx.globalAlpha = b.alpha * fade;
    ctx.drawImage(fogSprite(FOG_SEEDS[i & 1]), b.x, b.y + b.dy, FOG_SPRITE_W * b.w, FOG_SPRITE_H * b.w * 0.95);
  }

  if (s.rain.length > 0) drawRain(ctx, s, fade);

  if (s.snow.length > 0) {
    const flake = softDot("flake", 32, "235,242,255");
    for (const l of s.snow) {
      ctx.globalAlpha = l.a * fade;
      for (const f of l.flakes) {
        const d = f.r * 2.4;
        ctx.drawImage(flake, f.x - d / 2, f.y - d / 2, d, d);
      }
    }
  }

  if (s.storm && s.flashLevel > 0) drawLightning(ctx, s, fade);
}

function drawShoot(ctx: CanvasRenderingContext2D, sh: Shoot, fade: number): void {
  const p = sh.t / sh.dur;
  if (p >= 1) return;
  const a = Math.sin(Math.PI * p) * sh.peak * fade;
  const n = Math.hypot(sh.vx, sh.vy);
  const tx = sh.x - (sh.vx / n) * sh.len;
  const ty = sh.y - (sh.vy / n) * sh.len;
  const grad = ctx.createLinearGradient(tx, ty, sh.x, sh.y);
  grad.addColorStop(0, "rgba(220,232,255,0)");
  grad.addColorStop(1, `rgba(235,242,255,${a})`);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(sh.x, sh.y);
  ctx.stroke();
}

function drawRain(ctx: CanvasRenderingContext2D, s: CineScene, fade: number): void {
  ctx.strokeStyle = "rgb(175,205,255)";
  ctx.lineCap = "round";
  for (const l of s.rain) {
    const lean = s.wind * l.wf;
    ctx.lineWidth = l.width;
    ctx.globalAlpha = l.a * fade;
    ctx.beginPath();
    for (const d of l.drops) {
      const n = Math.hypot(lean, d.s);
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - (lean / n) * d.len, d.y - (d.s / n) * d.len);
    }
    ctx.stroke();
  }
  // Splashes: a flat ripple plus three tiny droplets.
  ctx.lineWidth = 1.2;
  for (const p of s.splashes) {
    if (!p.active) continue;
    const prog = p.t / SPLASH_S;
    ctx.strokeStyle = "rgb(175,205,255)";
    ctx.globalAlpha = rippleAlpha(prog, s.intensity) * fade;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, (3 + 15 * prog) * p.sc, (1 + 4 * prog) * p.sc, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgb(190,215,255)";
    ctx.globalAlpha = dropletAlpha(prog, s.intensity) * fade;
    for (const q of p.d) ctx.fillRect(p.x + q.vx * p.t, p.y + q.vy * p.t + 700 * p.t * p.t, 1.8, 1.8);
  }
}

function drawLightning(ctx: CanvasRenderingContext2D, s: CineScene, fade: number): void {
  ctx.globalAlpha = s.flashLevel * fade;
  ctx.fillStyle = "rgb(205,218,255)";
  ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
  const st = s.storm;
  if (!st || st.activeMs === null) return;
  const k = boltStrength(st.activeMs);
  if (k <= 0) return;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgb(225,232,255)";
  // A wide faint glow under a thin bright core.
  const strokes: Array<[number, number]> = [
    [9, 0.12],
    [2.4, ALPHA_CAP.bolt],
  ];
  for (const [width, a] of strokes) {
    ctx.globalAlpha = a * k * s.intensity * fade;
    ctx.lineWidth = width;
    for (const path of st.paths) {
      ctx.beginPath();
      path.forEach((pt, i) => {
        if (i) ctx.lineTo(pt[0], pt[1]);
        else ctx.moveTo(pt[0], pt[1]);
      });
      ctx.stroke();
    }
  }
}

interface Layer {
  scene: CineScene;
  fade: number;
  target: 0 | 1;
}

/**
 * The cinematic engine on `canvas` (the #effects canvas). Same contract as the regular `startEffects`: crossfades to
 * the scene for this weather, "none" stops and clears. Only the scene's own id and intensity matter (rain at dusk
 * does not restart), ~30 fps, dt clamped, paused while the page is hidden.
 */
export function startCinematic(canvas: HTMLCanvasElement): Effects {
  const ctx = canvas.getContext("2d");
  let layers: Layer[] = [];
  let key = "none";
  let raf = 0;
  let last: number | null = null;

  function clear(): void {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function frame(ts: number): void {
    raf = requestAnimationFrame(frame);
    if (!ctx || (last !== null && ts - last < FRAME_MS)) return;
    const dt = last === null ? 0 : clampDt(ts - last);
    last = ts;
    for (const layer of layers) {
      stepCine(layer.scene, dt, Math.random);
      const dir = layer.target === 1 ? 1 : -1;
      layer.fade = Math.min(1, Math.max(0, layer.fade + (dir * dt) / FADE_MS));
    }
    layers = layers.filter((l) => l.target === 1 || l.fade > 0);
    clear();
    ctx.setTransform(canvas.width / DESIGN_W, 0, 0, canvas.height / DESIGN_H, 0, 0);
    for (const layer of layers) drawScene(ctx, layer.scene, layer.fade);
    ctx.globalAlpha = 1;
  }

  function run(): void {
    if (raf || document.hidden || layers.length === 0) return;
    last = null;
    raf = requestAnimationFrame(frame);
  }

  function halt(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = null;
  }

  function onVisibility(): void {
    if (document.hidden) halt();
    else run();
  }
  document.addEventListener("visibilitychange", onVisibility);

  return {
    setWeather(kind, daypart, intensity = 1) {
      const id = cineSceneId(kind, daypart);
      const next = id === "none" ? "none" : `${id}@${intensity}`;
      if (next === key) return;
      key = next;
      if (id === "none") {
        halt();
        layers = [];
        clear();
        return;
      }
      for (const layer of layers) layer.target = 0;
      const scene = createCineScene(kind, daypart, Math.random, intensity);
      warm(scene);
      layers.push({ scene, fade: 0, target: 1 });
      run();
    },
    stop() {
      document.removeEventListener("visibilitychange", onVisibility);
      halt();
      layers = [];
      key = "none";
      clear();
    },
  };
}
