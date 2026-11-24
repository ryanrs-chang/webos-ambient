/**
 * Weather effects, behind the clock in every theme.
 *
 * Two halves: a pure simulation core (`createScene` / `stepScene` / the storm flash scheduler), which has no
 * DOM and takes an injected rng so tests are deterministic, and a thin canvas renderer (`startEffects`).
 *
 * OLED rule: everything here is dim (see `MAX_ALPHA`), nothing stays put, and nothing covers a large area
 * brightly. The canvas is additionally multiplied by `--dim` in CSS. On the pure-black themes every alpha is
 * further scaled by an `intensity` (`effectIntensity`), so a scene's brightest pixel is MAX_ALPHA * intensity.
 */
import type { WeatherKind } from "../weather";

export type EffectKind = WeatherKind | "none";
export type Daypart = "day" | "night";
export type Rng = () => number;
export interface Size {
  w: number;
  h: number;
}
export type Shape = "streak" | "flake" | "star" | "ray" | "blob";

export interface Particle {
  /** What this particle is drawn as; a scene can mix shapes (partly cloudy: rays or stars, plus clouds). */
  shape: Shape;
  x: number;
  y: number;
  /** px per second */
  vx: number;
  vy: number;
  /** Extent in px: streak length, flake/star radius, blob radius, ray length. The bounds check uses it. */
  size: number;
  /** Current alpha, already within the kind's maximum. */
  alpha: number;
  /** The alpha this particle can reach at its brightest. */
  peak: number;
  phase: number;
  /** ms since this particle (re)spawned */
  age: number;
  /** ms until it respawns elsewhere; Infinity if it never does */
  life: number;
  /** Horizontal sway amplitude (px/s) and angular frequency (rad/ms), snow and twinkle. */
  sway: number;
  freq: number;
  /** Rays: tilt from vertical (rad), its drift (rad/s) and the width at the base (px). */
  angle: number;
  spin: number;
  width: number;
}

export interface FlashState {
  /** ms until the next flash starts */
  untilNextMs: number;
  /** ms since the running flash started, or null while idle */
  activeMs: number | null;
}

export interface Scene {
  kind: EffectKind;
  daypart: Daypart;
  size: Size;
  /** Distinct shapes present, in draw order; empty for "none". */
  shapes: Shape[];
  /** Multiplier on every alpha (and the flash); 1 on the ambient theme. */
  intensity: number;
  particles: Particle[];
  flash: FlashState | null;
  /** Extra brightness (0..FLASH_PEAK) to add over the whole screen right now. */
  flashLevel: number;
}

/** Upper bound on particles per kind (clear: the night stars; partly: 40 stars or 2 rays, plus a few clouds). */
export const MAX_PARTICLES: Record<WeatherKind, number> = {
  rain: 120,
  storm: 120,
  snow: 90,
  clear: 80,
  partly: 48,
  cloudy: 7,
  fog: 7,
};

/** One kind of particle in a scene and the brightest it may be. */
interface Part {
  shape: Shape;
  max: number;
}

const STAR: Part = { shape: "star", max: 0.5 };
const RAY: Part = { shape: "ray", max: 0.06 };
const CLOUD: Part = { shape: "blob", max: 0.07 };

function partsOf(kind: EffectKind, daypart: Daypart): Part[] {
  switch (kind) {
    case "rain":
    case "storm":
      return [{ shape: "streak", max: 0.25 }];
    case "snow":
      return [{ shape: "flake", max: 0.35 }];
    case "clear":
      return [daypart === "night" ? STAR : RAY];
    case "partly":
      // Differs from cloudy: a few clouds with light rays by day, or with stars by night.
      return [daypart === "night" ? STAR : RAY, CLOUD];
    case "cloudy":
      return [CLOUD];
    case "fog":
      return [{ shape: "blob", max: 0.1 }];
    default:
      return [];
  }
}

/** The brightest any particle of this kind may be (at intensity 1). */
export function MAX_ALPHA(kind: EffectKind, daypart: Daypart): number {
  return Math.max(0, ...partsOf(kind, daypart).map((part) => part.max));
}

/** Pure-black themes (minimal, forecast, analog) show the effect at this fraction of the ambient alphas. */
export const BLACK_THEME_INTENSITY = 0.6;

export function effectIntensity(themeId: string): number {
  return themeId === "ambient" ? 1 : BLACK_THEME_INTENSITY;
}

export const MAX_DT_MS = 100;
/** A backgrounded tab resumes with a huge gap; clamp so particles do not teleport. */
export function clampDt(ms: number): number {
  return Math.min(MAX_DT_MS, Math.max(0, ms));
}

// Storm flash: very soft and rare.
export const FLASH_MIN_MS = 20_000;
export const FLASH_MAX_MS = 60_000;
export const FLASH_PEAK = 0.08;
export const FLASH_DURATION_MS = 300;
const FLASH_RISE_MS = 45;

const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

function nextFlashDelay(rng: Rng): number {
  return between(rng, FLASH_MIN_MS, FLASH_MAX_MS);
}

export function createFlash(rng: Rng): FlashState {
  return { untilNextMs: nextFlashDelay(rng), activeMs: null };
}

/** Moves the scheduler on by `dtMs`. `started` is true on the step a flash begins. Pure: returns a new state. */
export function advanceFlash(state: FlashState, dtMs: number, rng: Rng): { state: FlashState; started: boolean } {
  let activeMs = state.activeMs === null ? null : state.activeMs + dtMs;
  if (activeMs !== null && activeMs >= FLASH_DURATION_MS) activeMs = null;
  let untilNextMs = state.untilNextMs - dtMs;
  let started = false;
  if (untilNextMs <= 0) {
    started = true;
    activeMs = 0;
    // Keep the overshoot so the long-run spacing is exactly the drawn delay.
    untilNextMs += nextFlashDelay(rng);
  }
  return { state: { untilNextMs, activeMs }, started };
}

/** Quick soft rise, then a linear fade out; 0 when idle. */
export function flashLevel(state: FlashState): number {
  const t = state.activeMs;
  if (t === null || t >= FLASH_DURATION_MS) return 0;
  const k = t < FLASH_RISE_MS ? t / FLASH_RISE_MS : 1 - (t - FLASH_RISE_MS) / (FLASH_DURATION_MS - FLASH_RISE_MS);
  return FLASH_PEAK * k;
}

export function sceneShapes(kind: EffectKind, daypart: Daypart): Shape[] {
  return partsOf(kind, daypart).map((part) => part.shape);
}

const STAR_FADE_MS = 4000;
const RAY_MAX_ANGLE = 0.4;

function blank(): Particle {
  return {
    shape: "blob",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    size: 1,
    alpha: 0,
    peak: 0,
    phase: 0,
    age: 0,
    life: Number.POSITIVE_INFINITY,
    sway: 0,
    freq: 0,
    angle: 0,
    spin: 0,
    width: 0,
  };
}

function spawnStreak(p: Particle, size: Size, rng: Rng, anywhere: boolean, k: number): void {
  p.size = between(rng, 14, 38);
  p.vy = between(rng, 800, 1400);
  p.vx = p.vy * 0.2;
  p.peak = between(rng, 0.08, 0.25) * k;
  p.alpha = p.peak;
  p.x = between(rng, -p.size, size.w);
  p.y = anywhere ? between(rng, -p.size, size.h) : -p.size;
}

function spawnFlake(p: Particle, size: Size, rng: Rng, anywhere: boolean, k: number): void {
  p.size = between(rng, 1, 3.2);
  p.vy = between(rng, 18, 55);
  p.sway = between(rng, 8, 26);
  p.freq = between(rng, 0.0004, 0.0012);
  p.phase = rng() * Math.PI * 2;
  p.peak = between(rng, 0.12, 0.35) * k;
  p.alpha = p.peak;
  p.x = between(rng, -p.size, size.w + p.size);
  p.y = anywhere ? between(rng, -p.size, size.h) : -p.size;
}

function spawnStar(p: Particle, size: Size, rng: Rng, fresh: boolean, k: number): void {
  p.size = between(rng, 0.8, 1.6);
  p.x = rng() * size.w;
  p.y = rng() * size.h;
  p.life = between(rng, 60_000, 180_000);
  // Initial stars start mid-life; a respawned one starts at 0 and fades in.
  p.age = fresh ? rng() * p.life : 0;
  p.phase = rng() * Math.PI * 2;
  p.freq = (Math.PI * 2) / between(rng, 3000, 8000);
  p.peak = between(rng, 0.2, 0.5) * k;
  starAlpha(p);
}

function starAlpha(p: Particle): void {
  const twinkle = 0.55 + 0.45 * Math.sin(p.phase + p.age * p.freq);
  const envelope = Math.min(1, p.age / STAR_FADE_MS, (p.life - p.age) / STAR_FADE_MS);
  p.alpha = Math.max(0, p.peak * twinkle * envelope);
}

function spawnRay(p: Particle, size: Size, rng: Rng, k: number): void {
  p.size = size.h * 1.3;
  p.x = rng() * size.w;
  p.y = 0;
  p.vx = between(rng, 3, 8) * (rng() < 0.5 ? -1 : 1);
  p.angle = between(rng, -0.3, 0.3);
  p.spin = between(rng, 0.004, 0.012) * (rng() < 0.5 ? -1 : 1);
  p.width = between(rng, 140, 300);
  p.peak = between(rng, 0.02, 0.06) * k;
  p.alpha = p.peak;
}

/** `maxAlpha` is the cap already scaled by intensity. */
function spawnBlob(p: Particle, size: Size, rng: Rng, maxAlpha: number): void {
  p.size = between(rng, 220, 460);
  p.x = between(rng, -p.size, size.w + p.size);
  p.y = rng() * size.h;
  p.vx = between(rng, 4, 14) * (rng() < 0.5 ? -1 : 1);
  p.peak = between(rng, maxAlpha * 0.4, maxAlpha);
  p.alpha = p.peak;
}

function partCount(part: Part, kind: EffectKind, rng: Rng): number {
  switch (part.shape) {
    case "streak":
    case "flake":
      return MAX_PARTICLES[kind as WeatherKind];
    case "star":
      return kind === "partly" ? 40 : MAX_PARTICLES.clear;
    case "ray":
      return kind === "partly" ? 2 : 3 + Math.floor(rng() * 3);
    case "blob":
      return kind === "partly" ? 2 + Math.floor(rng() * 2) : 4 + Math.floor(rng() * 4);
  }
}

/** `intensity` scales every alpha: no particle (nor the flash) exceeds MAX_ALPHA * intensity. */
export function createScene(kind: EffectKind, daypart: Daypart, size: Size, rng: Rng, intensity = 1): Scene {
  const parts = partsOf(kind, daypart);
  const particles: Particle[] = [];
  for (const part of parts) {
    const count = partCount(part, kind, rng);
    for (let i = 0; i < count; i++) {
      const p = blank();
      p.shape = part.shape;
      switch (part.shape) {
        case "streak":
          spawnStreak(p, size, rng, true, intensity);
          break;
        case "flake":
          spawnFlake(p, size, rng, true, intensity);
          break;
        case "star":
          spawnStar(p, size, rng, true, intensity);
          break;
        case "ray":
          spawnRay(p, size, rng, intensity);
          break;
        case "blob":
          spawnBlob(p, size, rng, part.max * intensity);
          break;
      }
      particles.push(p);
    }
  }
  return {
    kind,
    daypart,
    size,
    shapes: parts.map((part) => part.shape),
    intensity,
    particles,
    flash: kind === "storm" ? createFlash(rng) : null,
    flashLevel: 0,
  };
}

/** Wraps x into [-size, w + size] without touching y. */
function wrapX(p: Particle, w: number): void {
  const span = w + 2 * p.size;
  if (p.x > w + p.size) p.x -= span;
  else if (p.x < -p.size) p.x += span;
}

/**
 * Advances the scene by `dtMs` (callers clamp it with `clampDt`). Mutates and returns the scene: the renderer
 * calls this 30 times a second on a weak TV CPU, so it allocates nothing.
 */
export function stepScene(scene: Scene, dtMs: number, rng: Rng): Scene {
  const { size } = scene;
  const dt = dtMs / 1000;
  for (const p of scene.particles) {
    switch (p.shape) {
      case "streak":
        p.y += p.vy * dt;
        p.x += p.vx * dt;
        if (p.y > size.h + p.size) {
          p.y = -p.size;
          p.x = between(rng, -p.size, size.w);
        }
        wrapX(p, size.w);
        break;
      case "flake":
        p.age += dtMs;
        p.y += p.vy * dt;
        p.x += p.sway * Math.sin(p.phase + p.age * p.freq) * dt;
        if (p.y > size.h + p.size) {
          p.y = -p.size;
          p.x = between(rng, -p.size, size.w + p.size);
        }
        wrapX(p, size.w);
        break;
      case "star":
        p.age += dtMs;
        if (p.age >= p.life) spawnStar(p, size, rng, false, scene.intensity);
        else starAlpha(p);
        break;
      case "ray":
        p.x += p.vx * dt;
        if (p.x > size.w) p.x = 0;
        else if (p.x < 0) p.x = size.w;
        p.angle += p.spin * dt;
        if (Math.abs(p.angle) > RAY_MAX_ANGLE) {
          p.angle = Math.sign(p.angle) * RAY_MAX_ANGLE;
          p.spin = -p.spin;
        }
        break;
      case "blob":
        p.x += p.vx * dt;
        wrapX(p, size.w);
        break;
    }
  }
  if (scene.flash) {
    const next = advanceFlash(scene.flash, dtMs, rng);
    scene.flash = next.state;
    scene.flashLevel = flashLevel(next.state) * scene.intensity;
  }
  return scene;
}

// ---------------------------------------------------------------------------------------------------------
// Canvas renderer

export interface Effects {
  /** Crossfades to the effect for this weather at `intensity` x the base alphas; "none" stops the loop and clears the canvas. */
  setWeather(kind: EffectKind, daypart: Daypart, intensity?: number): void;
  stop(): void;
}

const FADE_MS = 1500;
/** ~30 fps: the TV's CPU does not need more for something this slow. A little under 1000/30 for rAF jitter. */
const FRAME_MS = 1000 / 30 - 4;

interface Layer {
  scene: Scene;
  fade: number;
  target: 0 | 1;
}

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

/** Soft round blob: a white radial gradient fading to nothing, tinted by `rgb`. */
function blobSprite(rgb: string): HTMLCanvasElement {
  return sprite(`blob:${rgb}`, 256, 256, (g) => {
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.5, `rgba(${rgb},0.4)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  });
}

/** Light shaft: soft on both sides, fading out towards the bottom. Drawn hanging from (0, 0). */
function raySprite(): HTMLCanvasElement {
  return sprite("ray", 128, 512, (g) => {
    const across = g.createLinearGradient(0, 0, 128, 0);
    across.addColorStop(0, "rgba(205,218,240,0)");
    across.addColorStop(0.5, "rgba(205,218,240,1)");
    across.addColorStop(1, "rgba(205,218,240,0)");
    g.fillStyle = across;
    g.fillRect(0, 0, 128, 512);
    const down = g.createLinearGradient(0, 0, 0, 512);
    down.addColorStop(0, "rgba(0,0,0,1)");
    down.addColorStop(1, "rgba(0,0,0,0)");
    g.globalCompositeOperation = "destination-in";
    g.fillStyle = down;
    g.fillRect(0, 0, 128, 512);
  });
}

function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, fade: number): void {
  for (const shape of scene.shapes) {
    const particles = scene.particles.filter((p) => p.shape === shape);
    drawShape(ctx, scene, shape, particles, fade);
  }
  if (scene.flashLevel > 0) {
    ctx.globalAlpha = scene.flashLevel * fade;
    ctx.fillStyle = "rgb(190,200,230)";
    ctx.fillRect(0, 0, scene.size.w, scene.size.h);
  }
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  shape: Shape,
  particles: Particle[],
  fade: number,
): void {
  switch (shape) {
    case "streak": {
      ctx.strokeStyle = "rgb(150,172,205)";
      ctx.lineWidth = 1.5;
      for (const p of particles) {
        ctx.globalAlpha = p.alpha * fade;
        // The tail trails the direction of travel.
        const k = p.size / p.vy;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * k, p.y - p.size);
        ctx.stroke();
      }
      break;
    }
    case "flake":
    case "star": {
      ctx.fillStyle = shape === "flake" ? "rgb(215,225,240)" : "rgb(225,230,245)";
      for (const p of particles) {
        ctx.globalAlpha = p.alpha * fade;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "ray": {
      const img = raySprite();
      for (const p of particles) {
        ctx.globalAlpha = p.alpha * fade;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.drawImage(img, -p.width / 2, 0, p.width, p.size);
        ctx.restore();
      }
      break;
    }
    case "blob": {
      const img = blobSprite(scene.kind === "fog" ? "185,190,195" : "170,185,210");
      for (const p of particles) {
        ctx.globalAlpha = p.alpha * fade;
        ctx.drawImage(img, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      }
      break;
    }
  }
}

function sceneKey(kind: EffectKind, daypart: Daypart, intensity: number): string {
  if (kind === "none") return "none";
  // Only clear and partly differ between day and night; rain at dusk should not restart its crossfade.
  const part = kind === "clear" || kind === "partly" ? `${kind}:${daypart}` : kind;
  return `${part}@${intensity}`;
}

export function startEffects(canvas: HTMLCanvasElement): Effects {
  const ctx = canvas.getContext("2d");
  let layers: Layer[] = [];
  let key = "none";
  let raf = 0;
  let last: number | null = null;

  const size = (): Size => ({ w: canvas.width, h: canvas.height });

  function clear(): void {
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function frame(ts: number): void {
    raf = requestAnimationFrame(frame);
    if (!ctx || (last !== null && ts - last < FRAME_MS)) return;
    const dt = last === null ? 0 : clampDt(ts - last);
    last = ts;
    for (const layer of layers) {
      stepScene(layer.scene, dt, Math.random);
      const dir = layer.target === 1 ? 1 : -1;
      layer.fade = Math.min(1, Math.max(0, layer.fade + (dir * dt) / FADE_MS));
    }
    layers = layers.filter((l) => l.target === 1 || l.fade > 0);
    clear();
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
      const next = sceneKey(kind, daypart, intensity);
      if (next === key) return;
      key = next;
      if (kind === "none") {
        halt();
        layers = [];
        clear();
        return;
      }
      for (const layer of layers) layer.target = 0;
      layers.push({ scene: createScene(kind, daypart, size(), Math.random, intensity), fade: 0, target: 1 });
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
