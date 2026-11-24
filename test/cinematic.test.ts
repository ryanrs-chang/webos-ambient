import { describe, expect, test } from "bun:test";
import {
  ALPHA_CAP,
  BOLT_DURATION_MS,
  boltStrength,
  CINEMATIC_THEME_ID,
  type CineScene,
  cineSceneId,
  cloudDrawAlpha,
  cloudPuffs,
  createCineScene,
  DESIGN_H,
  DESIGN_W,
  effectPlan,
  fogPuffs,
  gustLevel,
  LIGHTNING_MAX_MS,
  LIGHTNING_MIN_MS,
  lightningFlash,
  MAX_COUNTS,
  SHOOT_MAX_MS,
  SHOOT_MIN_MS,
  starAlpha,
  stepCine,
} from "../src/effects/cinematic";
import type { WeatherKind } from "../src/weather";

const KINDS: WeatherKind[] = ["clear", "partly", "cloudy", "fog", "rain", "snow", "storm"];
const DAYPARTS = ["day", "night"] as const;
const STEP = 33;

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

function run(scene: CineScene, totalMs: number, rng: () => number, stepMs = STEP): void {
  for (let t = 0; t < totalMs; t += stepMs) stepCine(scene, stepMs, rng);
}

const count = (s: CineScene) => ({
  rain: s.rain.reduce((n, l) => n + l.drops.length, 0),
  snow: s.snow.reduce((n, l) => n + l.flakes.length, 0),
  stars: s.starLayers.reduce((n, l) => n + l.stars.length, 0),
  clouds: s.clouds.length,
  fog: s.fog.length,
  splashes: s.splashes.length,
  motes: s.motes.length,
});

describe("cineSceneId", () => {
  test("clear and partly differ by daypart, everything else does not", () => {
    expect(cineSceneId("clear", "day")).toBe("clear-day");
    expect(cineSceneId("clear", "night")).toBe("clear-night");
    expect(cineSceneId("partly", "day")).toBe("partly-day");
    expect(cineSceneId("partly", "night")).toBe("partly-night");
    expect(cineSceneId("rain", "day")).toBe("rain");
    expect(cineSceneId("rain", "night")).toBe("rain");
    expect(cineSceneId("none", "night")).toBe("none");
  });
});

describe("createCineScene content", () => {
  test("'none' is empty and stays empty", () => {
    const s = createCineScene("none", "night", mulberry32(1));
    expect(Object.values(count(s)).every((n) => n === 0)).toBe(true);
    expect(s.sun).toBeNull();
    expect(s.moon).toBeNull();
    expect(s.shoot).toBeNull();
    expect(s.storm).toBeNull();
    stepCine(s, STEP, mulberry32(2));
    expect(s.flashLevel).toBe(0);
  });

  test("rain has three depth layers, each longer, faster and brighter than the one behind", () => {
    const s = createCineScene("rain", "night", mulberry32(3));
    expect(s.rain).toHaveLength(3);
    for (let i = 1; i < 3; i++) {
      expect(s.rain[i].a).toBeGreaterThan(s.rain[i - 1].a);
      expect(s.rain[i].lenRange[0]).toBeGreaterThan(s.rain[i - 1].lenRange[0]);
      expect(s.rain[i].speedRange[0]).toBeGreaterThan(s.rain[i - 1].speedRange[0]);
    }
    expect(s.starLayers).toHaveLength(0);
    expect(s.storm).toBeNull();
  });

  test("a storm is heavier rain plus a lightning scheduler; plain rain has none", () => {
    const rain = count(createCineScene("rain", "day", mulberry32(4)));
    const storm = createCineScene("storm", "day", mulberry32(4));
    expect(count(storm).rain).toBeGreaterThan(rain.rain);
    expect(storm.storm).not.toBeNull();
  });

  test("snow has three layers", () => {
    expect(createCineScene("snow", "day", mulberry32(5)).snow).toHaveLength(3);
  });

  test("clear night has three star layers, a moon and a shooting star scheduler, no sun", () => {
    const s = createCineScene("clear", "night", mulberry32(6));
    expect(s.starLayers).toHaveLength(3);
    expect(s.moon).not.toBeNull();
    expect(s.shoot).not.toBeNull();
    expect(s.sun).toBeNull();
  });

  test("partly cloudy by night has stars, clouds and a shooting star scheduler", () => {
    const s = createCineScene("partly", "night", mulberry32(6));
    expect(s.starLayers.length).toBeGreaterThan(0);
    expect(s.clouds.length).toBeGreaterThan(0);
    expect(s.shoot).not.toBeNull();
  });

  test("clear and partly by day have a sun with two ray layers' angles and dust motes, no shooting star", () => {
    for (const kind of ["clear", "partly"] as const) {
      const s = createCineScene(kind, "day", mulberry32(7));
      expect(s.sun).not.toBeNull();
      expect(s.motes.length).toBeGreaterThan(0);
      expect(s.shoot).toBeNull();
      expect(s.starLayers).toHaveLength(0);
    }
  });

  test("partly cloudy is dimmer in the sun than clear", () => {
    const clear = createCineScene("clear", "day", mulberry32(7));
    const partly = createCineScene("partly", "day", mulberry32(7));
    stepCine(clear, STEP, mulberry32(1));
    stepCine(partly, STEP, mulberry32(1));
    expect(partly.sun?.br ?? 1).toBeLessThan(clear.sun?.br ?? 0);
  });

  test("fog is wide bands, no rain or snow", () => {
    const s = createCineScene("fog", "day", mulberry32(8));
    expect(s.fog).toHaveLength(5);
    expect(s.rain).toHaveLength(0);
    expect(s.snow).toHaveLength(0);
  });

  test("shooting stars only exist on clear and partly nights", () => {
    for (const kind of KINDS) {
      for (const daypart of DAYPARTS) {
        const s = createCineScene(kind, daypart, mulberry32(9));
        const expected = daypart === "night" && (kind === "clear" || kind === "partly");
        expect(s.shoot !== null).toBe(expected);
      }
    }
  });

  test("lightning only exists in a storm", () => {
    for (const kind of KINDS) {
      expect(createCineScene(kind, "night", mulberry32(9)).storm !== null).toBe(kind === "storm");
    }
  });
});

describe("caps", () => {
  test("particle counts never exceed the caps, now or after two minutes of stepping", () => {
    for (const kind of KINDS) {
      for (const daypart of DAYPARTS) {
        const rng = mulberry32(11);
        const s = createCineScene(kind, daypart, rng);
        const check = () => {
          const c = count(s);
          expect(c.rain).toBeLessThanOrEqual(MAX_COUNTS.rain);
          expect(c.snow).toBeLessThanOrEqual(MAX_COUNTS.snow);
          expect(c.stars).toBeLessThanOrEqual(MAX_COUNTS.stars);
          expect(c.clouds).toBeLessThanOrEqual(MAX_COUNTS.clouds);
          expect(c.fog).toBeLessThanOrEqual(MAX_COUNTS.fog);
          expect(c.splashes).toBeLessThanOrEqual(MAX_COUNTS.splashes);
          expect(c.motes).toBeLessThanOrEqual(MAX_COUNTS.motes);
        };
        check();
        run(s, 120_000, rng);
        check();
      }
    }
  });

  test("the published caps are v1's levels", () => {
    expect(ALPHA_CAP.rain).toBe(0.4);
    expect(ALPHA_CAP.clouds).toBe(0.18);
    expect(ALPHA_CAP.fog).toBe(0.2);
    expect(ALPHA_CAP.snow).toBe(0.55);
    expect(ALPHA_CAP.flash).toBe(0.1);
  });

  const INTENSITIES = [1, 0.5];

  test.each(INTENSITIES)("every layer alpha stays under its cap at intensity %p", (intensity) => {
    for (const kind of KINDS) {
      for (const daypart of DAYPARTS) {
        const rng = mulberry32(13);
        const s = createCineScene(kind, daypart, rng, intensity);
        run(s, 30_000, rng);
        const cap = (n: number) => n * intensity + 1e-9;
        for (const l of s.rain) expect(l.a).toBeLessThanOrEqual(cap(ALPHA_CAP.rain));
        for (const l of s.snow) expect(l.a).toBeLessThanOrEqual(cap(ALPHA_CAP.snow));
        for (const l of s.starLayers) {
          expect(l.a).toBeLessThanOrEqual(cap(ALPHA_CAP.stars));
          for (const star of l.stars) expect(starAlpha(l, star, s.tMs / 1000)).toBeLessThanOrEqual(l.a + 1e-9);
        }
        for (const c of s.clouds) {
          expect(c.alpha).toBeLessThanOrEqual(cap(ALPHA_CAP.clouds));
          // Even lit by a bolt a cloud never passes the cap.
          expect(cloudDrawAlpha(c, ALPHA_CAP.flash * intensity)).toBeLessThanOrEqual(cap(ALPHA_CAP.clouds));
        }
        for (const b of s.fog) expect(b.a).toBeLessThanOrEqual(cap(ALPHA_CAP.fog));
        if (s.moon) expect(s.moon.glow).toBeLessThanOrEqual(cap(ALPHA_CAP.moon));
        if (s.sun) expect(s.sun.br * ALPHA_CAP.sun).toBeLessThanOrEqual(cap(ALPHA_CAP.sun));
        expect(s.flashLevel).toBeLessThanOrEqual(cap(ALPHA_CAP.flash));
      }
    }
  });

  test.each([1, 0.5])("a shooting star never exceeds its cap at intensity %p", (intensity) => {
    const rng = mulberry32(14);
    const s = createCineScene("clear", "night", rng, intensity);
    let seen = 0;
    for (let t = 0; t < 600_000; t += STEP) {
      stepCine(s, STEP, rng);
      if (s.shoot?.active) {
        seen++;
        expect(s.shoot.peak).toBeLessThanOrEqual(ALPHA_CAP.shoot * intensity + 1e-9);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  test("the flash never exceeds 0.10 at any instant of its 600 ms", () => {
    let peak = 0;
    for (let ms = 0; ms <= BOLT_DURATION_MS; ms += 1) {
      const v = lightningFlash(ms);
      expect(v).toBeGreaterThanOrEqual(0);
      peak = Math.max(peak, v);
    }
    expect(peak).toBeLessThanOrEqual(ALPHA_CAP.flash);
    expect(peak).toBeGreaterThan(0.09);
    expect(lightningFlash(BOLT_DURATION_MS + 1)).toBe(0);
  });

  test("the flash is a double pulse: it dips between two peaks", () => {
    const a = lightningFlash(60);
    const dip = lightningFlash(140);
    const b = lightningFlash(220);
    expect(dip).toBeLessThan(a);
    expect(dip).toBeLessThan(b);
  });

  test("the bolt line is strongest at the start and gone after 350 ms", () => {
    expect(boltStrength(0)).toBe(1);
    expect(boltStrength(200)).toBeLessThan(1);
    expect(boltStrength(400)).toBe(0);
    expect(ALPHA_CAP.bolt).toBe(0.5);
  });

  test("a cloud is brightened by a flash but only up to the cloud cap", () => {
    const s = createCineScene("storm", "night", mulberry32(15));
    const c = s.clouds[0];
    expect(cloudDrawAlpha(c, 0)).toBe(c.alpha);
    expect(cloudDrawAlpha(c, 0.1)).toBeGreaterThan(c.alpha);
    expect(cloudDrawAlpha(c, 1)).toBeLessThanOrEqual(ALPHA_CAP.clouds);
  });
});

describe("stepCine", () => {
  test("everything stays on screen or is recycled: rain, snow and clouds do not leak away", () => {
    const rng = mulberry32(21);
    for (const kind of ["rain", "snow", "partly"] as const) {
      const s = createCineScene(kind, "day", rng);
      run(s, 90_000, rng);
      for (const l of s.rain) for (const d of l.drops) expect(d.y).toBeLessThan(DESIGN_H + 100);
      for (const l of s.snow) for (const f of l.flakes) expect(f.y).toBeLessThan(DESIGN_H + 20);
      for (const c of s.clouds) expect(c.x).toBeLessThan(DESIGN_W + 40);
    }
  });

  test("clouds drift to the right and re-enter on the left", () => {
    const rng = mulberry32(22);
    const s = createCineScene("cloudy", "day", rng);
    const before = s.clouds.map((c) => c.x);
    stepCine(s, 1000, rng);
    s.clouds.forEach((c, i) => {
      // Moved right, or wrapped round to the far left.
      expect(c.x > before[i] || c.x === -c.w).toBe(true);
    });
    run(s, 600_000, rng);
    for (const c of s.clouds) expect(c.x).toBeGreaterThanOrEqual(-c.w - 1);
  });

  test("steps nothing when dt is 0", () => {
    const rng = mulberry32(23);
    const s = createCineScene("rain", "day", rng);
    const y = s.rain[0].drops[0].y;
    stepCine(s, 0, rng);
    expect(s.rain[0].drops[0].y).toBe(y);
  });

  test("gust level is within 0..1 and varies", () => {
    const vals: number[] = [];
    for (let t = 0; t < 600; t += 0.5) vals.push(gustLevel(t));
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...vals)).toBeLessThanOrEqual(1);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(0.2);
  });

  test("wind slants the rain: storm blows harder than rain, snow gusts drift", () => {
    const rng = mulberry32(24);
    const rain = createCineScene("rain", "day", rng);
    const storm = createCineScene("storm", "day", rng);
    stepCine(rain, STEP, rng);
    stepCine(storm, STEP, rng);
    expect(storm.wind).toBeGreaterThan(rain.wind);
    expect(rain.wind).toBeGreaterThanOrEqual(130);
  });

  test("rain that hits the ground makes splashes, never more than the pool", () => {
    const rng = mulberry32(25);
    const s = createCineScene("storm", "day", rng);
    let maxActive = 0;
    let seen = 0;
    for (let t = 0; t < 20_000; t += STEP) {
      stepCine(s, STEP, rng);
      const active = s.splashes.filter((p) => p.active).length;
      maxActive = Math.max(maxActive, active);
      seen += active;
    }
    expect(seen).toBeGreaterThan(0);
    expect(maxActive).toBeLessThanOrEqual(MAX_COUNTS.splashes);
  });

  test("the splash pool is fixed: no splash objects are created while stepping", () => {
    const rng = mulberry32(26);
    const s = createCineScene("storm", "day", rng);
    const before = [...s.splashes];
    run(s, 20_000, rng);
    expect(s.splashes).toHaveLength(before.length);
    s.splashes.forEach((p, i) => {
      expect(p).toBe(before[i]);
    });
  });
});

describe("schedulers", () => {
  /** Times (ms) at which a thing started, found by stepping one frame at a time. */
  function startTimes(
    scene: CineScene,
    isActive: (s: CineScene) => boolean,
    rng: () => number,
    totalMs: number,
  ): number[] {
    const starts: number[] = [];
    let was = false;
    for (let t = 0; t < totalMs; t += STEP) {
      stepCine(scene, STEP, rng);
      const now = isActive(scene);
      if (now && !was) starts.push(scene.tMs);
      was = now;
    }
    return starts;
  }

  test("lightning starts every 20 to 60 s (and the first one is within that range too)", () => {
    const rng = mulberry32(31);
    const s = createCineScene("storm", "night", rng);
    const starts = startTimes(s, (x) => x.storm?.activeMs != null, rng, 60 * 60_000);
    expect(starts.length).toBeGreaterThan(40);
    expect(starts[0]).toBeGreaterThanOrEqual(LIGHTNING_MIN_MS - STEP);
    expect(starts[0]).toBeLessThanOrEqual(LIGHTNING_MAX_MS + STEP);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      expect(gap).toBeGreaterThanOrEqual(LIGHTNING_MIN_MS - STEP);
      expect(gap).toBeLessThanOrEqual(LIGHTNING_MAX_MS + STEP);
    }
  });

  test("lightning gaps follow the injected rng at both ends of the range", () => {
    const lo = createCineScene("storm", "night", () => 0);
    expect(lo.storm?.untilNextMs).toBe(LIGHTNING_MIN_MS);
    const hi = createCineScene("storm", "night", () => 0.999999);
    expect(hi.storm?.untilNextMs ?? 0).toBeGreaterThan(LIGHTNING_MAX_MS - 1);
  });

  test("a bolt lasts 600 ms, lights the flash, and carries a path from the top of the screen", () => {
    const rng = mulberry32(32);
    const s = createCineScene("storm", "night", rng);
    let frames = 0;
    let flashed = false;
    let sawPath = false;
    for (let t = 0; t < 70_000; t += STEP) {
      stepCine(s, STEP, rng);
      if (s.storm?.activeMs != null) {
        frames++;
        flashed ||= s.flashLevel > 0;
        const main = s.storm.paths[s.storm.paths.length - 1];
        if (main) {
          sawPath = true;
          expect(main[0][1]).toBeLessThan(0);
          expect(main[main.length - 1][1]).toBeGreaterThan(500);
        }
      } else if (frames > 0) {
        break;
      }
    }
    expect(frames * STEP).toBeGreaterThan(BOLT_DURATION_MS - 2 * STEP);
    expect(frames * STEP).toBeLessThan(BOLT_DURATION_MS + 2 * STEP);
    expect(flashed).toBe(true);
    expect(sawPath).toBe(true);
    expect(s.flashLevel).toBe(0);
    expect(s.storm?.paths).toEqual([]);
  });

  test("shooting stars start every 15 to 45 s", () => {
    const rng = mulberry32(33);
    const s = createCineScene("clear", "night", rng);
    const starts = startTimes(s, (x) => x.shoot?.active === true, rng, 60 * 60_000);
    expect(starts.length).toBeGreaterThan(60);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      expect(gap).toBeGreaterThanOrEqual(SHOOT_MIN_MS - STEP);
      expect(gap).toBeLessThanOrEqual(SHOOT_MAX_MS + STEP);
    }
  });

  test("a shooting star starts at the top right half and crosses the sky down to the left in about a second", () => {
    const rng = mulberry32(34);
    const s = createCineScene("clear", "night", rng);
    let first: { x: number; y: number } | null = null;
    let frames = 0;
    for (let t = 0; t < 120_000; t += STEP) {
      stepCine(s, STEP, rng);
      if (s.shoot?.active) {
        first ??= { x: s.shoot.x, y: s.shoot.y };
        frames++;
        expect(s.shoot.vx).toBeLessThan(0);
        expect(s.shoot.vy).toBeGreaterThan(0);
      } else if (first) break;
    }
    expect(first?.x ?? 0).toBeGreaterThan(DESIGN_W * 0.4);
    expect(first?.y ?? 9999).toBeLessThan(DESIGN_H * 0.4);
    expect(frames * STEP).toBeGreaterThan(500);
    expect(frames * STEP).toBeLessThan(1400);
  });
});

describe("sprite data", () => {
  test("a cloud sprite is 18 overlapping puffs inside its canvas, wider at the middle than the ends", () => {
    for (let variant = 0; variant < 4; variant++) {
      const { w, h, puffs } = cloudPuffs(variant, "cool");
      expect(puffs).toHaveLength(18);
      for (const p of puffs) {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(w);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(h);
        expect(p.rad).toBeGreaterThan(0);
      }
    }
  });

  test("sprites are deterministic: the same variant paints the same cloud", () => {
    expect(cloudPuffs(2, "dark")).toEqual(cloudPuffs(2, "dark"));
    expect(cloudPuffs(1, "dark")).not.toEqual(cloudPuffs(2, "dark"));
  });

  test("fog bands are 34 wide, flat puffs", () => {
    const { w, puffs } = fogPuffs(3);
    expect(puffs).toHaveLength(34);
    for (const p of puffs) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(w);
      expect(p.rad).toBeGreaterThanOrEqual(140);
      expect(p.rad).toBeLessThanOrEqual(260);
    }
    expect(fogPuffs(3)).toEqual(fogPuffs(3));
  });
});

describe("effectPlan: one engine draws at a time", () => {
  test("the cinematic theme draws its own scene and turns the regular particles and meteors off", () => {
    expect(effectPlan(CINEMATIC_THEME_ID, false)).toEqual({ engine: "cinematic", meteors: false });
  });

  test("every other theme keeps the regular particles and meteors", () => {
    for (const id of ["minimal", "forecast", "analog", "ambient"]) {
      expect(effectPlan(id, false)).toEqual({ engine: "particles", meteors: true });
    }
  });

  test("under reduced motion the cinematic scene is off, not frozen (a static glow would be burn-in)", () => {
    expect(effectPlan(CINEMATIC_THEME_ID, true)).toEqual({ engine: "off", meteors: false });
  });

  test("reduced motion changes nothing for the regular themes (their own gates apply)", () => {
    expect(effectPlan("minimal", true)).toEqual({ engine: "particles", meteors: true });
  });
});
