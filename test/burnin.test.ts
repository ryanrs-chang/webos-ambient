import { describe, expect, test } from "bun:test";
import {
  anchoredPosition,
  floatPosition,
  floatRange,
  nextRelocationDelayMs,
  nextZone,
  type Zone,
  type ZoneState,
  zoneBag,
  zoneTarget,
} from "../src/burnin";

describe("floatPosition", () => {
  const RX = 700;
  const RY = 300;
  const SPEED = 3;

  test("always inside the range, including huge t", () => {
    const times = [0, 1, 999, 1_700_000_000_000, 4e15, ...Array.from({ length: 5000 }, (_, i) => i * 7_919)];
    for (const t of times) {
      const { x, y } = floatPosition(t, RX, RY, SPEED);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(RX);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(RY);
    }
  });

  test("whole pixels only", () => {
    for (let i = 0; i < 2000; i++) {
      const { x, y } = floatPosition(i * 3_001 + 17, RX, RY, SPEED);
      expect(Number.isInteger(x)).toBe(true);
      expect(Number.isInteger(y)).toBe(true);
    }
  });

  test("moves every second at the given speed", () => {
    // Far from both edges: x is 30 px at 10 s and 33 px at 11 s.
    expect(floatPosition(10_000, RX, RY, SPEED).x).toBe(30);
    expect(floatPosition(11_000, RX, RY, SPEED).x).toBe(33);
    // y runs at 0.73 of the speed (2.19 px/s), so whole-pixel steps are 2 or 3.
    const dy = floatPosition(11_000, RX, RY, SPEED).y - floatPosition(10_000, RX, RY, SPEED).y;
    expect([2, 3]).toContain(dy);
  });

  test("starts at the origin at t=0", () => {
    expect(floatPosition(0, RX, RY, SPEED)).toEqual({ x: 0, y: 0 });
  });

  test("reflects at the far edge and comes back", () => {
    // Range 100 at 10 px/s: reaches 100 at 10 s, then returns.
    expect(floatPosition(10_000, 100, 100, 10).x).toBe(100);
    expect(floatPosition(11_000, 100, 100, 10).x).toBe(90);
    expect(floatPosition(15_000, 100, 100, 10).x).toBe(50);
    // Back at the near edge after a full there-and-back (20 s), then outward again.
    expect(floatPosition(20_000, 100, 100, 10).x).toBe(0);
    expect(floatPosition(21_000, 100, 100, 10).x).toBe(10);
  });

  test("x and y do not repeat in step: different effective speeds", () => {
    // With equal ranges and speeds, a pure diagonal would keep x === y forever.
    const diverged = Array.from({ length: 200 }, (_, i) => floatPosition(i * 1_000, 400, 400, 5)).some(
      (p) => p.x !== p.y,
    );
    expect(diverged).toBe(true);
    // And it is not a short loop: the position after 10 minutes differs from the start.
    expect(floatPosition(600_000, 400, 400, 5)).not.toEqual(floatPosition(0, 400, 400, 5));
  });

  test("a zero range keeps that axis at 0", () => {
    for (const t of [0, 5_000, 123_456_789]) {
      expect(floatPosition(t, 0, RY, SPEED).x).toBe(0);
      expect(floatPosition(t, RX, 0, SPEED).y).toBe(0);
    }
    expect(floatPosition(5_000, 0, 0, SPEED)).toEqual({ x: 0, y: 0 });
  });

  test("a negative range is treated as zero", () => {
    expect(floatPosition(5_000, -50, -50, SPEED)).toEqual({ x: 0, y: 0 });
  });

  test("deterministic for the same t", () => {
    expect(floatPosition(987_654, RX, RY, SPEED)).toEqual(floatPosition(987_654, RX, RY, SPEED));
  });
});

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

describe("anchoredPosition", () => {
  const RANGE = { x: 440, y: 400 };

  test("drifts within +-drift of the anchor and moves over time", () => {
    const anchor = { x: 200, y: 200 };
    const seen = new Set<number>();
    for (let t = 0; t < 600_000; t += 1_000) {
      const p = anchoredPosition(anchor, RANGE, t, 60, 3);
      expect(Math.abs(p.x - anchor.x)).toBeLessThanOrEqual(60);
      expect(Math.abs(p.y - anchor.y)).toBeLessThanOrEqual(60);
      seen.add(p.x);
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  test("moves every second at the float speed (x, away from the edges)", () => {
    const anchor = { x: 200, y: 200 };
    const a = anchoredPosition(anchor, RANGE, 10_000, 60, 3);
    const b = anchoredPosition(anchor, RANGE, 11_000, 60, 3);
    expect(b.x - a.x).toBe(3);
  });

  test("clamped inside the full range even for an anchor on the edge", () => {
    for (const anchor of [
      { x: 0, y: 0 },
      { x: 440, y: 400 },
    ]) {
      for (let t = 0; t < 300_000; t += 997) {
        const p = anchoredPosition(anchor, RANGE, t, 60, 3);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(RANGE.x);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(RANGE.y);
      }
    }
  });

  test("a zero range keeps that axis at 0", () => {
    expect(anchoredPosition({ x: 0, y: 100 }, { x: 0, y: 400 }, 5_000, 60, 3).x).toBe(0);
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
});
