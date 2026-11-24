import { describe, expect, test } from "bun:test";
import example from "../config.example.json";
import { defaultConfig, parseLaunchParams } from "../src/config";

describe("parseLaunchParams", () => {
  const cases: { name: string; palm: string | undefined; search: string; want: object }[] = [
    { name: "nothing given", palm: undefined, search: "", want: {} },
    { name: "empty palm string", palm: "", search: "", want: {} },
    { name: "theme from webOS JSON", palm: '{"theme":"aurora"}', search: "", want: { theme: "aurora" } },
    { name: "query theme alone", palm: undefined, search: "?theme=minimal", want: { theme: "minimal" } },
    {
      name: "query theme overrides JSON theme",
      palm: '{"theme":"aurora"}',
      search: "?theme=minimal",
      want: { theme: "minimal" },
    },
    {
      name: "empty query theme keeps JSON theme",
      palm: '{"theme":"aurora"}',
      search: "?theme=",
      want: { theme: "aurora" },
    },
    {
      name: "weather sets weatherUrl",
      palm: undefined,
      search: "?weather=http%3A%2F%2Flocalhost%3A8080%2Fforecast",
      want: { weatherUrl: "http://localhost:8080/forecast" },
    },
    {
      name: "theme and weather together",
      palm: undefined,
      search: "?theme=x&weather=http://h/f",
      want: { theme: "x", weatherUrl: "http://h/f" },
    },
    { name: "malformed JSON is ignored", palm: "{not json", search: "", want: {} },
    {
      name: "malformed JSON does not block the query",
      palm: "{not json",
      search: "?theme=minimal",
      want: { theme: "minimal" },
    },
    { name: "numeric theme ignored", palm: '{"theme":42}', search: "", want: {} },
    { name: "null theme ignored", palm: '{"theme":null}', search: "", want: {} },
    { name: "object theme ignored", palm: '{"theme":{"a":1}}', search: "", want: {} },
    { name: "JSON null ignored", palm: "null", search: "", want: {} },
    { name: "JSON array ignored", palm: "[1,2]", search: "", want: {} },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(parseLaunchParams(c.palm, c.search)).toEqual(c.want);
    });
  }
});

describe("defaultConfig float settings", () => {
  test("floats at 3 px/s with a 40 px margin", () => {
    expect(defaultConfig.floatSpeedPxPerS).toBe(3);
    expect(defaultConfig.floatMarginPx).toBe(40);
  });
});

describe("defaultConfig relocation settings", () => {
  test("relocates every 3 minutes at :30 past the minute, fading over 1.2 s", () => {
    expect(defaultConfig.relocateMinutes).toBe(3);
    expect(defaultConfig.relocateOffsetSec).toBe(30);
    expect(defaultConfig.relocateFadeMs).toBe(1200);
  });
});

describe("defaultConfig personal values", () => {
  test("outside the build they come from config.example.json, never from source", () => {
    expect(defaultConfig.place).toBe(example.place);
    expect(defaultConfig.latitude).toBe(example.latitude);
    expect(defaultConfig.longitude).toBe(example.longitude);
    expect(defaultConfig.timeZone).toBe(example.timeZone);
  });
});
