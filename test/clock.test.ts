import { describe, expect, test } from "bun:test";
import { clockParts, formatDate, formatHour, formatTime, msToNextMinute } from "../src/clock";

const TAIPEI = "Asia/Taipei"; // UTC+8, no DST
const utc = (iso: string) => new Date(iso);

describe("formatTime", () => {
  const cases: [string, string, string, string][] = [
    ["Taipei evening", "2026-11-24T10:30:00Z", TAIPEI, "18:30"],
    ["Taipei midnight is zero-padded 24h", "2026-11-23T16:05:00Z", TAIPEI, "00:05"],
    ["Taipei 23:59", "2026-11-24T15:59:00Z", TAIPEI, "23:59"],
    ["Taipei single-digit hour is padded", "2026-11-24T01:07:00Z", TAIPEI, "09:07"],
    ["seconds are ignored", "2026-11-24T10:30:59.999Z", TAIPEI, "18:30"],
    ["honours another zone (New York, EST)", "2026-11-24T10:30:00Z", "America/New_York", "05:30"],
    ["honours a zone with a half-hour offset", "2026-11-24T10:30:00Z", "Asia/Kolkata", "16:00"],
    ["UTC", "2026-11-24T00:00:00Z", "UTC", "00:00"],
  ];
  for (const [name, iso, tz, want] of cases) {
    test(name, () => {
      expect(formatTime(utc(iso), tz)).toBe(want);
    });
  }
});

describe("formatHour", () => {
  const cases: [string, string, string, string][] = [
    ["Taipei afternoon", "2026-11-24T06:00:00Z", TAIPEI, "14"],
    ["Taipei midnight", "2026-11-23T16:00:00Z", TAIPEI, "00"],
    ["Taipei early morning is padded", "2026-11-23T21:00:00Z", TAIPEI, "05"],
    ["another zone", "2026-11-24T06:00:00Z", "America/New_York", "01"],
  ];
  for (const [name, iso, tz, want] of cases) {
    test(name, () => {
      expect(formatHour(utc(iso), tz)).toBe(want);
    });
  }
});

describe("formatDate", () => {
  const cases: [string, string, string, string][] = [
    ["Taipei Tuesday", "2026-11-24T10:30:00Z", TAIPEI, "11月24日星期二"],
    ["rolls over to the next Taipei day", "2026-11-24T16:00:00Z", TAIPEI, "11月25日星期三"],
    ["still the same Taipei day one minute before", "2026-11-24T15:59:00Z", TAIPEI, "11月24日星期二"],
    ["another zone sees the previous day", "2026-11-24T02:00:00Z", "America/New_York", "11月23日星期一"],
  ];
  for (const [name, iso, tz, want] of cases) {
    test(name, () => {
      expect(formatDate(utc(iso), tz)).toBe(want);
    });
  }
});

describe("clockParts", () => {
  test("returns numeric hour and minute in the zone", () => {
    expect(clockParts(utc("2026-11-23T16:05:00Z"), TAIPEI)).toEqual({ hour: 0, minute: 5 });
    expect(clockParts(utc("2026-11-24T15:59:00Z"), TAIPEI)).toEqual({ hour: 23, minute: 59 });
  });
});

describe("msToNextMinute", () => {
  const base = Date.parse("2026-11-24T10:30:00Z");
  const cases: [string, number, number][] = [
    ["exactly on a boundary", 0, 60_000],
    ["one millisecond after", 1, 59_999],
    ["mid-minute", 30_000, 30_000],
    ["at :59.999", 59_999, 1],
  ];
  for (const [name, offset, want] of cases) {
    test(name, () => {
      expect(msToNextMinute(new Date(base + offset))).toBe(want);
    });
  }

  test("never leaves [1, 60000] across a minute of samples", () => {
    for (let ms = 0; ms < 120_000; ms += 7) {
      const v = msToNextMinute(new Date(base + ms));
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(60_000);
    }
  });
});
