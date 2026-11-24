import { describe, expect, test } from "bun:test";
import {
  createMeteor,
  METEOR_MAX_ALPHA,
  METEOR_MAX_MS,
  METEOR_MIN_MS,
  meteorStyle,
  meteorsActive,
  nextMeteorDelayMs,
} from "../src/effects/meteors";
import { BLACK_THEME_INTENSITY } from "../src/effects/particles";

const SIZE = { w: 1920, h: 1080 };

/** Tiny seeded PRNG so every run is the same. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("meteorsActive", () => {
  test("only clear or partly cloudy nights", () => {
    expect(meteorsActive("clear", "night")).toBe(true);
    expect(meteorsActive("partly", "night")).toBe(true);
  });

  test("never by day", () => {
    expect(meteorsActive("clear", "day")).toBe(false);
    expect(meteorsActive("partly", "day")).toBe(false);
  });

  test("never under cloud, fog, rain, snow, storm or without a forecast", () => {
    for (const kind of ["cloudy", "fog", "rain", "snow", "storm", "none"] as const) {
      expect(meteorsActive(kind, "night")).toBe(false);
    }
  });
});

describe("nextMeteorDelayMs", () => {
  test("is 8 to 25 s at both ends of the rng", () => {
    expect(METEOR_MIN_MS).toBe(8000);
    expect(METEOR_MAX_MS).toBe(25_000);
    expect(nextMeteorDelayMs(() => 0)).toBe(8000);
    expect(nextMeteorDelayMs(() => 0.999999)).toBeLessThanOrEqual(25_000);
    expect(nextMeteorDelayMs(() => 0.999999)).toBeGreaterThan(24_990);
  });

  test("stays within the bounds over many draws and is not constant", () => {
    const rng = mulberry32(1);
    const delays = Array.from({ length: 500 }, () => nextMeteorDelayMs(rng));
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(8000);
      expect(d).toBeLessThanOrEqual(25_000);
    }
    expect(new Set(delays).size).toBeGreaterThan(100);
  });
});

describe("createMeteor", () => {
  const draw = (n: number, intensity = 1, seed = 7) => {
    const rng = mulberry32(seed);
    return Array.from({ length: n }, () => createMeteor(SIZE, rng, intensity));
  };

  test("starts inside the viewport, along the top edge band or the right edge band", () => {
    for (const m of draw(500)) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(SIZE.w);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(SIZE.h);
      const topBand = m.y <= SIZE.h * 0.12;
      const rightBand = m.x >= SIZE.w * 0.88;
      expect(topBand || rightBand).toBe(true);
    }
  });

  test("uses both edges", () => {
    const meteors = draw(500);
    expect(meteors.some((m) => m.y <= SIZE.h * 0.12 && m.x < SIZE.w * 0.88)).toBe(true);
    expect(meteors.some((m) => m.x >= SIZE.w * 0.88 && m.y > SIZE.h * 0.12)).toBe(true);
  });

  test("travels 600 to 900 px diagonally down and to the left", () => {
    for (const m of draw(500)) {
      const dx = m.endX - m.x;
      const dy = m.endY - m.y;
      expect(dx).toBeLessThan(0);
      expect(dy).toBeGreaterThan(0);
      expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(600 - 0.02);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(900 + 0.02);
      // The heading matches the stated angle below the horizontal.
      expect((Math.atan2(dy, -dx) * 180) / Math.PI).toBeCloseTo(m.angleDeg, 1);
      expect(m.angleDeg).toBeGreaterThanOrEqual(25);
      expect(m.angleDeg).toBeLessThanOrEqual(50);
    }
  });

  test("ends on screen", () => {
    for (const m of draw(1000)) {
      expect(m.endX).toBeGreaterThanOrEqual(0);
      expect(m.endX).toBeLessThanOrEqual(SIZE.w);
      expect(m.endY).toBeGreaterThanOrEqual(0);
      expect(m.endY).toBeLessThanOrEqual(SIZE.h);
    }
  });

  test("lasts 1.2 to 1.8 s, with a thin line 1 to 2 px and a tail", () => {
    for (const m of draw(300)) {
      expect(m.durationMs).toBeGreaterThanOrEqual(1200);
      expect(m.durationMs).toBeLessThanOrEqual(1800);
      expect(m.width).toBeGreaterThanOrEqual(1);
      expect(m.width).toBeLessThanOrEqual(2);
      expect(m.tail).toBeGreaterThanOrEqual(100);
      expect(m.tail).toBeLessThanOrEqual(220);
    }
  });

  test("head alpha is capped at 0.35 at intensity 1", () => {
    expect(METEOR_MAX_ALPHA).toBe(0.35);
    const alphas = draw(500).map((m) => m.alpha);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.35);
    expect(Math.min(...alphas)).toBeGreaterThan(0.1);
  });

  test("the black themes show it at cap * their intensity", () => {
    const alphas = draw(500, BLACK_THEME_INTENSITY).map((m) => m.alpha);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.35 * BLACK_THEME_INTENSITY + 1e-9);
    expect(Math.max(...alphas)).toBeGreaterThan(0.15);
  });

  test("a lower intensity scales the cap down", () => {
    const alphas = draw(500, 0.6).map((m) => m.alpha);
    expect(Math.max(...alphas)).toBeLessThanOrEqual(0.35 * 0.6 + 1e-9);
  });

  test("is deterministic for a given seed", () => {
    expect(draw(5, 1, 99)).toEqual(draw(5, 1, 99));
    expect(draw(5, 1, 99)).not.toEqual(draw(5, 1, 100));
  });
});

describe("meteorStyle", () => {
  test("carries everything the CSS keyframes need as custom properties", () => {
    const m = createMeteor(SIZE, mulberry32(3), 1);
    const style = meteorStyle(m);
    expect(style).toContain(`--x0:${m.x}px`);
    expect(style).toContain(`--y0:${m.y}px`);
    expect(style).toContain(`--x1:${m.endX}px`);
    expect(style).toContain(`--y1:${m.endY}px`);
    expect(style).toContain(`--rot:-${m.angleDeg}deg`);
    expect(style).toContain(`--len:${m.tail}px`);
    expect(style).toContain(`--w:${m.width}px`);
    expect(style).toContain(`--dur:${m.durationMs}ms`);
    expect(style).toContain(`--a:${m.alpha}`);
  });
});
