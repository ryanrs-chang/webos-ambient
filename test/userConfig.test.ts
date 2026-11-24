import { describe, expect, test } from "bun:test";
import { parseUserConfig } from "../src/userConfig";

const valid = { place: "Testville", latitude: 12.5, longitude: -45.25, timeZone: "Europe/Paris" };

describe("parseUserConfig: valid input", () => {
  test("returns the four required keys", () => {
    expect(parseUserConfig(valid)).toEqual({ ...valid, haBaseUrl: "" });
  });

  test("trims the place", () => {
    expect(parseUserConfig({ ...valid, place: "  Testville " }).place).toBe("Testville");
  });

  test("ignores $-prefixed comment keys", () => {
    expect(parseUserConfig({ $comment: "hello", ...valid }).place).toBe("Testville");
  });

  test("keeps an http(s) haBaseUrl", () => {
    expect(parseUserConfig({ ...valid, haBaseUrl: "http://ha.local:8123" }).haBaseUrl).toBe("http://ha.local:8123");
  });

  test("accepts the range boundaries", () => {
    const c = parseUserConfig({ ...valid, latitude: -90, longitude: 180 });
    expect([c.latitude, c.longitude]).toEqual([-90, 180]);
    const d = parseUserConfig({ ...valid, latitude: 90, longitude: -180 });
    expect([d.latitude, d.longitude]).toEqual([90, -180]);
  });

  test("accepts UTC", () => {
    expect(parseUserConfig({ ...valid, timeZone: "UTC" }).timeZone).toBe("UTC");
  });
});

describe("parseUserConfig: invalid input names the bad key", () => {
  const cases: { name: string; raw: unknown; key: string }[] = [
    { name: "not an object", raw: "x", key: "config" },
    { name: "null", raw: null, key: "config" },
    { name: "array", raw: [], key: "config" },
    { name: "missing place", raw: { ...valid, place: undefined }, key: "place" },
    { name: "empty place", raw: { ...valid, place: "" }, key: "place" },
    { name: "blank place", raw: { ...valid, place: "   " }, key: "place" },
    { name: "numeric place", raw: { ...valid, place: 5 }, key: "place" },
    { name: "missing latitude", raw: { ...valid, latitude: undefined }, key: "latitude" },
    { name: "latitude as string", raw: { ...valid, latitude: "12.5" }, key: "latitude" },
    { name: "latitude above 90", raw: { ...valid, latitude: 90.01 }, key: "latitude" },
    { name: "latitude below -90", raw: { ...valid, latitude: -91 }, key: "latitude" },
    { name: "latitude NaN", raw: { ...valid, latitude: Number.NaN }, key: "latitude" },
    { name: "longitude above 180", raw: { ...valid, longitude: 181 }, key: "longitude" },
    { name: "longitude below -180", raw: { ...valid, longitude: -180.5 }, key: "longitude" },
    { name: "longitude Infinity", raw: { ...valid, longitude: Number.POSITIVE_INFINITY }, key: "longitude" },
    { name: "missing timeZone", raw: { ...valid, timeZone: undefined }, key: "timeZone" },
    { name: "unknown timeZone", raw: { ...valid, timeZone: "Mars/Olympus" }, key: "timeZone" },
    { name: "empty timeZone", raw: { ...valid, timeZone: "" }, key: "timeZone" },
    { name: "haBaseUrl not a url", raw: { ...valid, haBaseUrl: "ha.local" }, key: "haBaseUrl" },
    { name: "haBaseUrl not a string", raw: { ...valid, haBaseUrl: 3 }, key: "haBaseUrl" },
    { name: "unknown key (typo)", raw: { ...valid, lat: 1 }, key: "lat" },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(() => parseUserConfig(c.raw)).toThrow(`"${c.key}"`);
    });
  }

  test("lists every bad key in one message", () => {
    let msg = "";
    try {
      parseUserConfig({ place: "", latitude: 200, longitude: "x", timeZone: "Nope/Nope" });
    } catch (e) {
      msg = (e as Error).message;
    }
    for (const k of ["place", "latitude", "longitude", "timeZone"]) expect(msg).toContain(`"${k}"`);
    expect(msg).toContain("config.local.json");
  });
});
