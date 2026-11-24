import { describe, expect, test } from "bun:test";
import {
  advanceFlash,
  BLACK_THEME_INTENSITY,
  clampDt,
  createFlash,
  createScene,
  effectIntensity,
  FLASH_DURATION_MS,
  FLASH_MAX_MS,
  FLASH_MIN_MS,
  FLASH_PEAK,
  flashLevel,
  MAX_ALPHA,
  MAX_DT_MS,
  MAX_PARTICLES,
  stepScene,
} from "../src/effects/particles";
import type { WeatherKind } from "../src/weather";

const SIZE = { w: 1920, h: 1080 };
const KINDS: WeatherKind[] = ["clear", "partly", "cloudy", "fog", "rain", "snow", "storm"];
const DAYPARTS = ["day", "night"] as const;

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

function run(scene: ReturnType<typeof createScene>, totalMs: number, stepMs: number, rng: () => number) {
  for (let t = 0; t < totalMs; t += stepMs) stepScene(scene, stepMs, rng);
}

describe("createScene", () => {
  test("'none' is empty", () => {
    const scene = createScene("none", "night", SIZE, mulberry32(1));
    expect(scene.particles).toHaveLength(0);
    expect(scene.flash).toBeNull();
    stepScene(scene, 33, mulberry32(2));
    expect(scene.particles).toHaveLength(0);
  });

  test("counts never exceed the cap for each kind, now or after many steps", () => {
    for (const kind of KINDS) {
      for (const daypart of DAYPARTS) {
        const rng = mulberry32(7);
        const scene = createScene(kind, daypart, SIZE, rng);
        expect(scene.particles.length).toBeGreaterThan(0);
        expect(scene.particles.length).toBeLessThanOrEqual(MAX_PARTICLES[kind]);
        run(scene, 120_000, 33, rng);
        expect(scene.particles.length).toBeLessThanOrEqual(MAX_PARTICLES[kind]);
      }
    }
  });

  test("documented caps and per-variant counts", () => {
    expect(MAX_PARTICLES.rain).toBe(120);
    expect(MAX_PARTICLES.storm).toBe(120);
    expect(MAX_PARTICLES.snow).toBe(90);
    expect(MAX_PARTICLES.clear).toBe(80);
    const rng = mulberry32(3);
    expect(createScene("clear", "night", SIZE, rng).particles).toHaveLength(80);
    const rays = createScene("clear", "day", SIZE, rng).particles.length;
    expect(rays).toBeGreaterThanOrEqual(3);
    expect(rays).toBeLessThanOrEqual(5);
    for (const kind of ["cloudy", "fog"] as const) {
      const blobs = createScene(kind, "day", SIZE, rng).particles.length;
      expect(blobs).toBeGreaterThanOrEqual(4);
      expect(blobs).toBeLessThanOrEqual(7);
    }
  });

  test("is deterministic for a seeded rng", () => {
    const a = createScene("rain", "night", SIZE, mulberry32(42));
    const b = createScene("rain", "night", SIZE, mulberry32(42));
    run(a, 5_000, 33, mulberry32(9));
    run(b, 5_000, 33, mulberry32(9));
    expect(a.particles).toEqual(b.particles);
  });
});

describe("stepScene bounds", () => {
  test("every particle stays inside the screen (plus its own extent) at all times", () => {
    for (const kind of KINDS) {
      for (const daypart of DAYPARTS) {
        const rng = mulberry32(11);
        const scene = createScene(kind, daypart, SIZE, rng);
        for (let i = 0; i < 4000; i++) {
          stepScene(scene, 33, rng);
          if (i % 50 !== 0) continue;
          for (const p of scene.particles) {
            expect(p.x).toBeGreaterThanOrEqual(-p.size - 1);
            expect(p.x).toBeLessThanOrEqual(SIZE.w + p.size + 1);
            expect(p.y).toBeGreaterThanOrEqual(-p.size - 1);
            expect(p.y).toBeLessThanOrEqual(SIZE.h + p.size + 1);
          }
        }
      }
    }
  });
});

describe("motion", () => {
  test("rain and snow move downward; only a respawn at the top moves a particle up", () => {
    for (const kind of ["rain", "storm", "snow"] as const) {
      const rng = mulberry32(5);
      const scene = createScene(kind, "night", SIZE, rng);
      for (let round = 0; round < 40; round++) {
        const before = scene.particles.map((p) => p.y);
        stepScene(scene, 50, rng);
        scene.particles.forEach((p, i) => {
          if (p.y < before[i]) expect(p.y).toBeLessThanOrEqual(0);
          else expect(p.y).toBeGreaterThan(before[i]);
        });
      }
    }
  });

  test("rain is faster than snow", () => {
    const rng = mulberry32(5);
    const rain = createScene("rain", "night", SIZE, rng);
    const snow = createScene("snow", "night", SIZE, rng);
    const mean = (ps: { vy: number }[]) => ps.reduce((s, p) => s + p.vy, 0) / ps.length;
    expect(mean(rain.particles)).toBeGreaterThan(mean(snow.particles) * 5);
  });

  test("clouds drift sideways and wrap", () => {
    const rng = mulberry32(8);
    const scene = createScene("cloudy", "day", SIZE, rng);
    const before = scene.particles.map((p) => p.x);
    stepScene(scene, 100, rng);
    expect(scene.particles.some((p, i) => p.x !== before[i])).toBe(true);
  });

  test("snow sways: x changes even though it has no net push", () => {
    const rng = mulberry32(13);
    const scene = createScene("snow", "day", SIZE, rng);
    const xs = scene.particles.map((p) => p.x);
    run(scene, 2_000, 33, rng);
    const moved = scene.particles.filter((p, i) => Math.abs(p.x - xs[i]) > 0.5).length;
    expect(moved).toBeGreaterThan(scene.particles.length / 2);
  });
});

describe("stars", () => {
  test("no star is still where it started once the longest lifetime has passed", () => {
    const rng = mulberry32(21);
    const scene = createScene("clear", "night", SIZE, rng);
    const start = scene.particles.map((p) => [p.x, p.y]);
    // Lifetime is at most 3 min; step to 3 min + a bit so every star has respawned at least once.
    run(scene, 181_000, 100, rng);
    scene.particles.forEach((p, i) => {
      expect(p.x === start[i][0] && p.y === start[i][1]).toBe(false);
    });
  });

  test("lifetimes are 1-3 minutes", () => {
    const scene = createScene("clear", "night", SIZE, mulberry32(4));
    for (const p of scene.particles) {
      expect(p.life).toBeGreaterThanOrEqual(60_000);
      expect(p.life).toBeLessThanOrEqual(180_000);
    }
  });

  test("a star fades in from nothing after it respawns", () => {
    const rng = mulberry32(30);
    const scene = createScene("clear", "night", SIZE, rng);
    const p = scene.particles[0];
    p.age = p.life - 10;
    stepScene(scene, 50, rng);
    expect(p.age).toBeLessThan(100);
    expect(p.alpha).toBeLessThan(0.05);
  });

  test("stars twinkle: alpha is not constant over time", () => {
    const rng = mulberry32(31);
    const scene = createScene("clear", "night", SIZE, rng);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      stepScene(scene, 100, rng);
      seen.add(Math.round(scene.particles[5].alpha * 1000));
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe("alpha limits", () => {
  test("alpha stays within each kind's maximum (and at least 0)", () => {
    const limits: [WeatherKind, "day" | "night", number][] = [
      ["rain", "night", 0.25],
      ["storm", "night", 0.25],
      ["snow", "day", 0.35],
      ["clear", "night", 0.5],
      ["clear", "day", 0.06],
      ["partly", "day", 0.07],
      ["cloudy", "day", 0.07],
      ["fog", "day", 0.1],
    ];
    for (const [kind, daypart, max] of limits) {
      expect(MAX_ALPHA(kind, daypart)).toBeLessThanOrEqual(max);
      const rng = mulberry32(17);
      const scene = createScene(kind, daypart, SIZE, rng);
      for (let i = 0; i < 3000; i++) {
        stepScene(scene, 33, rng);
        for (const p of scene.particles) {
          expect(p.alpha).toBeGreaterThanOrEqual(0);
          expect(p.alpha).toBeLessThanOrEqual(max);
        }
      }
    }
  });
});

describe("storm flash", () => {
  test("only storms have a flash", () => {
    for (const kind of KINDS) {
      const scene = createScene(kind, "night", SIZE, mulberry32(1));
      if (kind === "storm") expect(scene.flash).not.toBeNull();
      else expect(scene.flash).toBeNull();
    }
  });

  test("flashes start 20-60 s apart, peak at most 8% and last about 300 ms", () => {
    const rng = mulberry32(99);
    let flash = createFlash(rng);
    const STEP = 10;
    const starts: number[] = [];
    let peak = 0;
    let litMs = 0;
    let litRuns = 0;
    let wasLit = false;
    for (let t = 0; t < 30 * 60_000; t += STEP) {
      const next = advanceFlash(flash, STEP, rng);
      flash = next.state;
      if (next.started) starts.push(t);
      const level = flashLevel(flash);
      peak = Math.max(peak, level);
      if (level > 0) {
        litMs += STEP;
        if (!wasLit) litRuns++;
      }
      wasLit = level > 0;
    }
    expect(starts.length).toBeGreaterThan(25);
    expect(FLASH_MIN_MS).toBe(20_000);
    expect(FLASH_MAX_MS).toBe(60_000);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      expect(gap).toBeGreaterThanOrEqual(FLASH_MIN_MS - STEP);
      expect(gap).toBeLessThanOrEqual(FLASH_MAX_MS + STEP);
    }
    expect(starts[0]).toBeGreaterThanOrEqual(FLASH_MIN_MS - STEP);
    expect(peak).toBeLessThanOrEqual(0.08);
    expect(peak).toBeGreaterThan(0.06);
    expect(FLASH_PEAK).toBeLessThanOrEqual(0.08);
    expect(FLASH_DURATION_MS).toBe(300);
    const perFlash = litMs / litRuns;
    expect(perFlash).toBeGreaterThanOrEqual(FLASH_DURATION_MS - 2 * STEP);
    expect(perFlash).toBeLessThanOrEqual(FLASH_DURATION_MS + STEP);
  });

  test("the scene exposes the current flash level, always within the peak", () => {
    const rng = mulberry32(2);
    const scene = createScene("storm", "night", SIZE, rng);
    let seenLit = false;
    for (let i = 0; i < 60_000 / 33; i++) {
      stepScene(scene, 33, rng);
      expect(scene.flashLevel).toBeGreaterThanOrEqual(0);
      expect(scene.flashLevel).toBeLessThanOrEqual(0.08);
      if (scene.flashLevel > 0) seenLit = true;
    }
    expect(seenLit).toBe(true);
  });
});

describe("clampDt", () => {
  test("caps long gaps (a backgrounded tab) and never goes negative", () => {
    expect(MAX_DT_MS).toBe(100);
    expect(clampDt(33)).toBe(33);
    expect(clampDt(60_000)).toBe(100);
    expect(clampDt(-5)).toBe(0);
  });
});

const count = (scene: ReturnType<typeof createScene>, shape: string) =>
  scene.particles.filter((p) => p.shape === shape).length;

describe("partly cloudy differs from cloudy", () => {
  test("day: light rays plus fewer cloud blobs than cloudy", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const partly = createScene("partly", "day", SIZE, mulberry32(seed));
      expect(count(partly, "ray")).toBeGreaterThanOrEqual(1);
      expect(count(partly, "blob")).toBeGreaterThanOrEqual(1);
      expect(count(partly, "star")).toBe(0);
      const cloudy = createScene("cloudy", "day", SIZE, mulberry32(seed));
      expect(count(cloudy, "ray")).toBe(0);
      expect(count(partly, "blob")).toBeLessThan(count(cloudy, "blob"));
      expect(partly.particles.length).toBeLessThanOrEqual(MAX_PARTICLES.partly);
    }
  });

  test("night: about 40 stars plus cloud blobs", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const partly = createScene("partly", "night", SIZE, mulberry32(seed));
      expect(count(partly, "star")).toBe(40);
      expect(count(partly, "blob")).toBeGreaterThanOrEqual(1);
      expect(count(partly, "ray")).toBe(0);
      expect(count(partly, "star")).toBeLessThan(count(createScene("clear", "night", SIZE, mulberry32(seed)), "star"));
      expect(partly.particles.length).toBeLessThanOrEqual(MAX_PARTICLES.partly);
    }
  });

  test("caps respected over time and every shape keeps its own alpha limit", () => {
    const limit = { ray: 0.06, blob: 0.07, star: 0.5 } as const;
    for (const daypart of DAYPARTS) {
      const rng = mulberry32(31);
      const scene = createScene("partly", daypart, SIZE, rng);
      for (let i = 0; i < 3000; i++) {
        stepScene(scene, 33, rng);
        expect(scene.particles.length).toBeLessThanOrEqual(MAX_PARTICLES.partly);
        for (const p of scene.particles) {
          expect(p.alpha).toBeGreaterThanOrEqual(0);
          expect(p.alpha).toBeLessThanOrEqual(limit[p.shape as keyof typeof limit]);
        }
      }
    }
  });

  test("partly day and night move in bounds like every other scene", () => {
    for (const daypart of DAYPARTS) {
      const rng = mulberry32(5);
      const scene = createScene("partly", daypart, SIZE, rng);
      for (let i = 0; i < 2000; i++) {
        stepScene(scene, 33, rng);
        for (const p of scene.particles) {
          expect(p.x).toBeGreaterThanOrEqual(-p.size - 1);
          expect(p.x).toBeLessThanOrEqual(SIZE.w + p.size + 1);
        }
      }
    }
  });
});

describe("intensity", () => {
  const caps: [WeatherKind, "day" | "night"][] = [
    ["rain", "night"],
    ["storm", "day"],
    ["snow", "day"],
    ["clear", "night"],
    ["clear", "day"],
    ["partly", "day"],
    ["partly", "night"],
    ["cloudy", "day"],
    ["fog", "night"],
  ];

  test("every alpha stays within cap * intensity", () => {
    for (const intensity of [1, 0.6, 0.3]) {
      for (const [kind, daypart] of caps) {
        const rng = mulberry32(13);
        const scene = createScene(kind, daypart, SIZE, rng, intensity);
        const limit = MAX_ALPHA(kind, daypart) * intensity + 1e-12;
        for (let i = 0; i < 1500; i++) {
          stepScene(scene, 33, rng);
          for (const p of scene.particles) {
            expect(p.alpha).toBeGreaterThanOrEqual(0);
            expect(p.alpha).toBeLessThanOrEqual(limit);
          }
        }
      }
    }
  });

  test("a lower intensity is dimmer: the brightest alpha scales down", () => {
    const peak = (intensity: number) => {
      const scene = createScene("rain", "night", SIZE, mulberry32(4), intensity);
      return Math.max(...scene.particles.map((p) => p.alpha));
    };
    expect(peak(0.6)).toBeCloseTo(peak(1) * 0.6, 10);
  });

  test("defaults to 1 and does not change the particle count", () => {
    for (const [kind, daypart] of caps) {
      const a = createScene(kind, daypart, SIZE, mulberry32(8));
      const b = createScene(kind, daypart, SIZE, mulberry32(8), 0.6);
      expect(b.particles).toHaveLength(a.particles.length);
      expect(a.particles.every((p, i) => p.alpha >= b.particles[i].alpha)).toBe(true);
    }
  });

  test("the storm flash is scaled too", () => {
    const rng = mulberry32(3);
    const scene = createScene("storm", "night", SIZE, rng, 0.6);
    let max = 0;
    for (let i = 0; i < 20_000; i++) {
      stepScene(scene, 33, rng);
      max = Math.max(max, scene.flashLevel);
    }
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(FLASH_PEAK * 0.6 + 1e-12);
  });

  test("black themes run at 60%, ambient at 100%", () => {
    expect(BLACK_THEME_INTENSITY).toBe(0.6);
    expect(effectIntensity("ambient")).toBe(1);
    for (const id of ["minimal", "forecast", "analog"]) expect(effectIntensity(id)).toBe(0.6);
  });
});
