import { describe, expect, test } from "bun:test";
import { weatherIcon } from "../src/icons";
import type { WeatherKind } from "../src/weather";

const icon = (kind: WeatherKind, isDay = true) => weatherIcon(kind, isDay, 64);

describe("weatherIcon animation hooks", () => {
  test("keeps its signature and svg wrapper", () => {
    expect(weatherIcon("clear", true, 40, "wx extra")).toMatch(
      /^<svg class="wx extra" width="40" height="40" viewBox="0 0 24 24"/,
    );
  });

  test("sun rays are their own group so CSS can rotate them", () => {
    expect(icon("clear")).toContain('class="wx-rays"');
    expect(icon("partly")).toContain('class="wx-rays"');
  });

  test("the moon gets a tilt hook, day icons do not", () => {
    expect(icon("clear", false)).toContain('class="wx-moon"');
    expect(icon("partly", false)).toContain('class="wx-moon"');
    expect(icon("clear", true)).not.toContain("wx-moon");
  });

  test("a cloud is wrapped in a group, so CSS motion does not replace its transform attribute", () => {
    for (const kind of ["cloudy", "rain", "snow", "storm", "partly"] as const) {
      expect(icon(kind)).toMatch(/<g class="wx-cloud"><path [^>]*d="M7 19/);
    }
  });

  test("rain has three staggered drops, snow three flakes, storm one bolt", () => {
    expect(icon("rain").match(/class="wx-drop wx-drop--\d"/g)).toHaveLength(3);
    expect(icon("snow").match(/class="wx-flake wx-flake--\d"/g)).toHaveLength(3);
    expect(icon("storm").match(/class="wx-bolt"/g)).toHaveLength(1);
  });

  test("fog stays still", () => {
    expect(icon("fog")).not.toMatch(/class="wx-/);
  });
});

describe("orbiting dots", () => {
  const orbit = (size = 64, kind: WeatherKind = "clear") => weatherIcon(kind, true, size, "wx", true);

  test("are off by default, so the hourly strip and the old markup are unchanged", () => {
    expect(icon("clear")).not.toContain("wx-orbit");
    expect(icon("clear")).not.toContain("wx-dot");
    expect(icon("clear")).not.toContain("overflow");
  });

  test("three dots, each in its own rotating group, inside the svg", () => {
    const svg = orbit();
    expect(svg.match(/<g class="wx-orbit wx-orbit--\d">/g)).toHaveLength(3);
    expect(svg.match(/<circle class="wx-dot"/g)).toHaveLength(3);
    expect(svg).toMatch(/^<svg class="wx" width="64" height="64" viewBox="0 0 24 24"[^>]*overflow="visible"/);
    expect(svg.endsWith("</g></svg>")).toBe(true);
  });

  test("every kind and size can carry them", () => {
    for (const kind of ["clear", "partly", "cloudy", "fog", "rain", "snow", "storm"] as const) {
      expect(orbit(96, kind).match(/class="wx-orbit /g)).toHaveLength(3);
    }
  });

  test("a dot is 3 to 4 px across whatever the icon size", () => {
    for (const size of [64, 96]) {
      const radii = [...orbit(size).matchAll(/<circle class="wx-dot" [^>]*\br="([\d.]+)"/g)].map((m) => Number(m[1]));
      expect(radii).toHaveLength(3);
      for (const r of radii) {
        const px = (r * 2 * size) / 24;
        expect(px).toBeGreaterThanOrEqual(3);
        expect(px).toBeLessThanOrEqual(4);
      }
    }
  });

  test("the dots sit on different radii, all outside the 12-unit glyph box centre", () => {
    const offsets = [...orbit().matchAll(/<circle class="wx-dot" cx="12" cy="(-?[\d.]+)"/g)].map(
      (m) => 12 - Number(m[1]),
    );
    expect(offsets).toHaveLength(3);
    expect(new Set(offsets).size).toBe(3);
    for (const o of offsets) expect(o).toBeGreaterThan(10);
  });
});
