import { describe, expect, test } from "bun:test";
import { applyFlags, parseSetupArgs } from "../scripts/setupArgs";

describe("parseSetupArgs", () => {
  test("no flags", () => {
    expect(parseSetupArgs([])).toEqual({});
  });

  test("space and equals forms", () => {
    expect(parseSetupArgs(["--place", "Testville", "--lat=12.5", "--lon", "-45", "--tz", "UTC"])).toEqual({
      place: "Testville",
      latitude: "12.5",
      longitude: "-45",
      timeZone: "UTC",
    });
  });

  test("ha base url", () => {
    expect(parseSetupArgs(["--ha-base-url", "http://h"])).toEqual({ haBaseUrl: "http://h" });
  });

  test("unknown flag throws", () => {
    expect(() => parseSetupArgs(["--nope", "1"])).toThrow("--nope");
  });

  test("flag without a value throws", () => {
    expect(() => parseSetupArgs(["--place"])).toThrow("--place");
  });
});

describe("applyFlags", () => {
  const base = { place: "A", latitude: 1.5, longitude: 2.5, timeZone: "UTC", haBaseUrl: "" };

  test("overrides only the given keys, numbers converted", () => {
    expect(applyFlags(base, { latitude: "10.25", place: "B" })).toEqual({ ...base, latitude: 10.25, place: "B" });
  });

  test("a non-numeric latitude stays a string so validation names it", () => {
    expect(applyFlags(base, { latitude: "abc" }).latitude).toBe("abc");
  });
});
