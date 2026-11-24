import { describe, expect, test } from "bun:test";
import { FREEZE_NOW, parseFreeze } from "../src/freeze";

describe("parseFreeze", () => {
  test("is off without parameters", () => {
    expect(parseFreeze("http:", "")).toEqual({ frozen: false, now: null });
  });

  test("?freeze=1 freezes and pins the clock to the fixture's instant", () => {
    expect(parseFreeze("http:", "?freeze=1")).toEqual({ frozen: true, now: FREEZE_NOW });
    expect(FREEZE_NOW.toISOString()).toBe("2026-11-24T10:00:00.000Z");
  });

  test("any other freeze value is off", () => {
    expect(parseFreeze("http:", "?freeze=0").frozen).toBe(false);
    expect(parseFreeze("http:", "?freeze=true").frozen).toBe(false);
  });

  test("?now= pins the clock on its own, without freezing", () => {
    expect(parseFreeze("http:", "?now=2026-01-02T03:04:00Z")).toEqual({
      frozen: false,
      now: new Date("2026-01-02T03:04:00Z"),
    });
  });

  test("?now= beats the freeze default", () => {
    const r = parseFreeze("https:", "?freeze=1&now=2026-01-02T03:04:00Z");
    expect(r.frozen).toBe(true);
    expect(r.now).toEqual(new Date("2026-01-02T03:04:00Z"));
  });

  test("an unparsable ?now= is ignored", () => {
    expect(parseFreeze("http:", "?now=yesterday")).toEqual({ frozen: false, now: null });
    expect(parseFreeze("http:", "?freeze=1&now=yesterday").now).toEqual(FREEZE_NOW);
  });

  test("never on file:, the packaged TV app", () => {
    expect(parseFreeze("file:", "?freeze=1&now=2026-01-02T03:04:00Z")).toEqual({ frozen: false, now: null });
  });
});
