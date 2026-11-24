import { describe, expect, test } from "bun:test";
import {
  nextShimmerDelayMs,
  SHIMMER_MAX_MS,
  SHIMMER_MIN_MS,
  SHIMMER_MS,
  SHIMMER_PEAK_ALPHA,
} from "../src/effects/shimmer";

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

describe("shimmer scheduling", () => {
  test("the gap is 20 to 60 s", () => {
    expect(SHIMMER_MIN_MS).toBe(20_000);
    expect(SHIMMER_MAX_MS).toBe(60_000);
    expect(nextShimmerDelayMs(() => 0)).toBe(20_000);
    expect(nextShimmerDelayMs(() => 0.999999)).toBeLessThanOrEqual(60_000);
    expect(nextShimmerDelayMs(() => 0.999999)).toBeGreaterThan(59_900);
  });

  test("stays within the bounds over many draws and varies", () => {
    const rng = mulberry32(5);
    const delays = Array.from({ length: 500 }, () => nextShimmerDelayMs(rng));
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(20_000);
      expect(d).toBeLessThanOrEqual(60_000);
    }
    expect(new Set(delays).size).toBeGreaterThan(100);
  });

  test("a sweep is about 1.6 s and never brighter than 0.25", () => {
    expect(SHIMMER_MS).toBe(1600);
    expect(SHIMMER_PEAK_ALPHA).toBeLessThanOrEqual(0.25);
  });
});
