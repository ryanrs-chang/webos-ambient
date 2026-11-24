import { describe, expect, test } from "bun:test";
import {
  floatRange,
  nextRelocationDelayMs,
  nextZone,
  stagePosition,
  type Zone,
  type ZoneState,
  zoneBag,
  zoneTarget,
} from "../src/burnin";

describe("floatRange", () => {
  test("viewport minus content minus both margins, per axis", () => {
    expect(floatRange({ w: 1920, h: 1080 }, { w: 1400, h: 600 }, 40)).toEqual({ x: 440, y: 400 });
  });

  test("clamps to 0 when the content does not fit", () => {
    expect(floatRange({ w: 1920, h: 1080 }, { w: 1900, h: 1200 }, 40)).toEqual({ x: 0, y: 0 });
  });

  test("an exact fit leaves no range", () => {
    expect(floatRange({ w: 1000, h: 500 }, { w: 920, h: 420 }, 40)).toEqual({ x: 0, y: 0 });
  });
});

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

const zoneId = (z: Zone) => `${z.col},${z.row}`;
const FRESH: ZoneState = { bag: [], last: null };

function draw(n: number, rng: () => number): Zone[] {
  let state = FRESH;
  const out: Zone[] = [];
  for (let i = 0; i < n; i++) {
    const r = nextZone(state, rng);
    out.push(r.zone);
    state = r.state;
  }
  return out;
}

describe("zoneBag", () => {
  test("is a permutation of the 9 cells of a 3x3 grid", () => {
    const bag = zoneBag(mulberry32(1));
    expect(bag).toHaveLength(9);
    expect(new Set(bag.map(zoneId)).size).toBe(9);
    for (const z of bag) {
      expect([0, 1, 2]).toContain(z.col);
      expect([0, 1, 2]).toContain(z.row);
    }
  });

  test("is shuffled: different seeds give different orders", () => {
    const orders = new Set([1, 2, 3, 4, 5].map((s) => zoneBag(mulberry32(s)).map(zoneId).join("|")));
    expect(orders.size).toBeGreaterThan(1);
  });

  test("deterministic for a seeded rng", () => {
    expect(zoneBag(mulberry32(9))).toEqual(zoneBag(mulberry32(9)));
  });
});

describe("nextZone", () => {
  test("every 9 consecutive draws from a fresh bag cover all 9 zones", () => {
    const zones = draw(9, mulberry32(5));
    expect(new Set(zones.map(zoneId)).size).toBe(9);
  });

  test("each full bag after a refill covers all 9 again", () => {
    const zones = draw(9 * 20, mulberry32(6));
    for (let b = 0; b < 20; b++) {
      expect(new Set(zones.slice(b * 9, b * 9 + 9).map(zoneId)).size).toBe(9);
    }
  });

  test("never the same zone twice in a row, across many refills", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const zones = draw(9 * 200, mulberry32(seed));
      for (let i = 1; i < zones.length; i++) expect(zoneId(zones[i])).not.toBe(zoneId(zones[i - 1]));
    }
  });

  test("deterministic with a seeded rng, and does not mutate the state it was given", () => {
    expect(draw(40, mulberry32(3))).toEqual(draw(40, mulberry32(3)));
    const state: ZoneState = { bag: zoneBag(mulberry32(1)), last: null };
    const before = JSON.stringify(state);
    nextZone(state, mulberry32(2));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("zoneTarget", () => {
  test("always inside the zone's third of the range, and inside the range", () => {
    const rng = mulberry32(21);
    const ranges = [
      { x: 440, y: 400 },
      { x: 900, y: 333 },
      { x: 7, y: 5 },
    ];
    for (const range of ranges) {
      for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) {
          for (let i = 0; i < 200; i++) {
            const { x, y } = zoneTarget({ col, row }, range, rng);
            expect(x).toBeGreaterThanOrEqual(Math.floor((col * range.x) / 3));
            expect(x).toBeLessThanOrEqual(Math.ceil(((col + 1) * range.x) / 3));
            expect(y).toBeGreaterThanOrEqual(Math.floor((row * range.y) / 3));
            expect(y).toBeLessThanOrEqual(Math.ceil(((row + 1) * range.y) / 3));
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(range.x);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(range.y);
            expect(Number.isInteger(x)).toBe(true);
            expect(Number.isInteger(y)).toBe(true);
          }
        }
      }
    }
  });

  test("thirds are ordered: column 0 stays left of column 2, row 0 above row 2", () => {
    const range = { x: 600, y: 300 };
    const rng = mulberry32(2);
    for (let i = 0; i < 100; i++) {
      expect(zoneTarget({ col: 0, row: 0 }, range, rng).x).toBeLessThanOrEqual(200);
      expect(zoneTarget({ col: 2, row: 2 }, range, rng).x).toBeGreaterThanOrEqual(400);
      expect(zoneTarget({ col: 0, row: 0 }, range, rng).y).toBeLessThanOrEqual(100);
      expect(zoneTarget({ col: 2, row: 2 }, range, rng).y).toBeGreaterThanOrEqual(200);
    }
  });

  test("a zero range on an axis gives 0 on it", () => {
    const rng = mulberry32(4);
    expect(zoneTarget({ col: 2, row: 1 }, { x: 0, y: 300 }, rng).x).toBe(0);
    expect(zoneTarget({ col: 2, row: 1 }, { x: 300, y: 0 }, rng).y).toBe(0);
    expect(zoneTarget({ col: 2, row: 2 }, { x: 0, y: 0 }, rng)).toEqual({ x: 0, y: 0 });
  });

  test("varies with the rng", () => {
    const rng = mulberry32(8);
    const xs = new Set(Array.from({ length: 30 }, () => zoneTarget({ col: 1, row: 1 }, { x: 900, y: 900 }, rng).x));
    expect(xs.size).toBeGreaterThan(5);
  });
});

describe("stagePosition", () => {
  const RANGE = { x: 440, y: 400 };

  test("margin plus the anchor fraction of the range, rounded to whole px", () => {
    expect(stagePosition({ x: 0, y: 0 }, RANGE, 40)).toEqual({ x: 40, y: 40 });
    expect(stagePosition({ x: 1, y: 1 }, RANGE, 40)).toEqual({ x: 480, y: 440 });
    expect(stagePosition({ x: 0.5, y: 0.25 }, RANGE, 40)).toEqual({ x: 260, y: 140 });
  });

  test("always integers, whatever the fraction, range or margin", () => {
    for (let i = 0; i <= 200; i++) {
      const frac = { x: i / 200, y: (i * 7) / 1400 };
      const p = stagePosition(frac, { x: 437.3, y: 391.9 }, 40.4);
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
    }
  });

  test("clamped into the range even for a fraction outside 0..1", () => {
    expect(stagePosition({ x: -2, y: 5 }, RANGE, 40)).toEqual({ x: 40, y: 440 });
    expect(stagePosition({ x: 9, y: -1 }, RANGE, 40)).toEqual({ x: 480, y: 40 });
  });

  test("a zero range pins that axis to the margin", () => {
    expect(stagePosition({ x: 0.7, y: 0.7 }, { x: 0, y: 400 }, 40)).toEqual({ x: 40, y: 320 });
    expect(stagePosition({ x: 0.7, y: 0.7 }, { x: 0, y: 0 }, 40)).toEqual({ x: 40, y: 40 });
  });

  test("a zone target from zoneTarget lands on exactly that pixel", () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const t = zoneTarget({ col: i % 3, row: Math.floor(i / 3) % 3 }, RANGE, rng);
      const frac = { x: t.x / RANGE.x, y: t.y / RANGE.y };
      expect(stagePosition(frac, RANGE, 40)).toEqual({ x: 40 + t.x, y: 40 + t.y });
    }
  });
});

describe("nextRelocationDelayMs", () => {
  const INTERVAL = 3 * 60_000;
  const OFFSET = 30_000;

  test("waits until the next interval boundary plus the offset", () => {
    expect(nextRelocationDelayMs(0, INTERVAL, OFFSET)).toBe(30_000);
    expect(nextRelocationDelayMs(100_000, INTERVAL, OFFSET)).toBe(110_000);
    expect(nextRelocationDelayMs(209_999, INTERVAL, OFFSET)).toBe(1);
  });

  test("standing exactly on a slot waits a whole interval, never 0", () => {
    expect(nextRelocationDelayMs(30_000, INTERVAL, OFFSET)).toBe(INTERVAL);
    expect(nextRelocationDelayMs(210_000, INTERVAL, OFFSET)).toBe(INTERVAL);
  });

  test("just after a slot waits almost a whole interval", () => {
    expect(nextRelocationDelayMs(30_001, INTERVAL, OFFSET)).toBe(INTERVAL - 1);
  });

  test("lands at second 30 of a minute, never on the :00 digit roll", () => {
    // 2026-11-24T10:02:07.250Z
    const now = Date.UTC(2026, 10, 24, 10, 2, 7, 250);
    for (let i = 0; i < 20; i++) {
      const at = now + i * 77_777;
      const t = new Date(at + nextRelocationDelayMs(at, INTERVAL, OFFSET));
      expect(t.getUTCSeconds()).toBe(30);
      expect(t.getUTCMilliseconds()).toBe(0);
      expect(t.getTime() - at).toBeGreaterThan(0);
      expect(t.getTime() - at).toBeLessThanOrEqual(INTERVAL);
    }
  });

  test("default offset is half a minute", () => {
    expect(nextRelocationDelayMs(0, 60_000)).toBe(30_000);
  });

  describe("with the default one-minute interval", () => {
    const ONE = 60_000;

    test("from any time the next relocation is the next :30 and the wait is in (0, 60 s]", () => {
      // Odd step so the sample walks through every second and sub-second position of the minute.
      for (let at = Date.UTC(2026, 10, 24, 10, 0, 0, 0); at < Date.UTC(2026, 10, 24, 10, 5, 0, 0); at += 977) {
        const delay = nextRelocationDelayMs(at, ONE, OFFSET);
        expect(delay).toBeGreaterThan(0);
        expect(delay).toBeLessThanOrEqual(ONE);
        const t = new Date(at + delay);
        expect(t.getUTCSeconds()).toBe(30);
        expect(t.getUTCMilliseconds()).toBe(0);
      }
    });

    test("at :29.999 it is 1 ms away, at :30.000 a whole minute", () => {
      const minute = Date.UTC(2026, 10, 24, 10, 7, 0, 0);
      expect(nextRelocationDelayMs(minute + 29_999, ONE, OFFSET)).toBe(1);
      expect(nextRelocationDelayMs(minute + 30_000, ONE, OFFSET)).toBe(ONE);
    });
  });
});
