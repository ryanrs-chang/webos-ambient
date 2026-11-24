import { describe, expect, test } from "bun:test";
import {
  applyFxPreview,
  buildMotionToggle,
  buildPanelModel,
  FANCY_KEY,
  FANCY_OPTIONS,
  FORCE_MOTION_KEY,
  FX_OPTIONS,
  isDevMode,
  isReducedMotion,
  parseFx,
  readFancy,
  readForceMotion,
  writeFancy,
  writeForceMotion,
} from "../src/devpanel";
import { themes } from "../src/themes";
import { describeWeather, type Forecast, type WeatherKind } from "../src/weather";

const loc = (protocol: string, hostname: string, search = "") => ({ protocol, hostname, search });

describe("isDevMode", () => {
  test("true for http and https on localhost, 127.0.0.1 and ::1", () => {
    expect(isDevMode(loc("http:", "localhost"))).toBe(true);
    expect(isDevMode(loc("https:", "localhost"))).toBe(true);
    expect(isDevMode(loc("http:", "127.0.0.1"))).toBe(true);
    expect(isDevMode(loc("http:", "::1"))).toBe(true);
    expect(isDevMode(loc("http:", "[::1]"))).toBe(true);
  });

  test("false for any other host without dev=1", () => {
    expect(isDevMode(loc("http:", "192.168.1.20"))).toBe(false);
    expect(isDevMode(loc("https:", "example.com", "?theme=forecast"))).toBe(false);
  });

  test("dev=1 turns it on anywhere", () => {
    expect(isDevMode(loc("https:", "example.com", "?dev=1"))).toBe(true);
    expect(isDevMode(loc("http:", "192.168.1.20", "?weather=/x.json&dev=1"))).toBe(true);
  });

  test("dev=0 turns it off, even on localhost", () => {
    expect(isDevMode(loc("http:", "localhost", "?dev=0"))).toBe(false);
    expect(isDevMode(loc("http:", "127.0.0.1", "?theme=analog&dev=0"))).toBe(false);
  });

  test("false for file: (the packaged TV app), even with dev=1 or an empty hostname", () => {
    expect(isDevMode(loc("file:", ""))).toBe(false);
    expect(isDevMode(loc("file:", "localhost"))).toBe(false);
    expect(isDevMode(loc("file:", "", "?dev=1"))).toBe(false);
  });
});

describe("buildPanelModel", () => {
  test("one entry per theme with its id and name, only the current one active", () => {
    const model = buildPanelModel(themes, 2);
    expect(model).toHaveLength(themes.length);
    expect(model.map((m) => m.id)).toEqual(["minimal", "forecast", "analog", "ambient", "cinematic"]);
    expect(model.map((m) => m.name)).toEqual(["極簡", "今日預報", "指針", "氛圍", "電影感"]);
    expect(model.map((m) => m.active)).toEqual([false, false, true, false, false]);
  });

  test("the cinematic theme gets its own button, last, and can be the active one", () => {
    expect(buildPanelModel(themes, 4).map((m) => m.active)).toEqual([false, false, false, false, true]);
  });

  test("an out-of-range index activates nothing", () => {
    expect(buildPanelModel(themes, 9).some((m) => m.active)).toBe(false);
  });
});

describe("parseFx / FX_OPTIONS", () => {
  test("auto and empty mean no override", () => {
    expect(parseFx(null)).toBeNull();
    expect(parseFx("")).toBeNull();
    expect(parseFx("auto")).toBeNull();
  });

  test("a kind picks the day part, and -night / -day override it", () => {
    expect(parseFx("rain")).toEqual({ kind: "rain", daypart: "day" });
    expect(parseFx("clear-night")).toEqual({ kind: "clear", daypart: "night" });
    expect(parseFx("partly-night")).toEqual({ kind: "partly", daypart: "night" });
  });

  test("an unknown kind is ignored", () => {
    expect(parseFx("tornado")).toBeNull();
  });

  test("the selector lists auto first, then every effect, each parseable", () => {
    expect(FX_OPTIONS.map((o) => o.value)).toEqual([
      "auto",
      "rain",
      "storm",
      "snow",
      "clear-day",
      "clear-night",
      "partly",
      "cloudy",
      "fog",
    ]);
    for (const o of FX_OPTIONS.slice(1)) expect(parseFx(o.value)).not.toBeNull();
  });
});

describe("isReducedMotion", () => {
  test("follows the media query unless forced", () => {
    expect(isReducedMotion(true, false)).toBe(true);
    expect(isReducedMotion(false, false)).toBe(false);
  });

  test("forcing motion always wins", () => {
    expect(isReducedMotion(true, true)).toBe(false);
    expect(isReducedMotion(false, true)).toBe(false);
  });
});

describe("force-motion toggle", () => {
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  test("the model exposes the state as a label and a pressed flag", () => {
    expect(buildMotionToggle(true)).toEqual({ label: "強制動畫", pressed: true });
    expect(buildMotionToggle(false)).toEqual({ label: "強制動畫", pressed: false });
  });

  test("off by default, and without storage", () => {
    expect(readForceMotion(fakeStorage())).toBe(false);
    expect(readForceMotion(null)).toBe(false);
  });

  test("a written choice reads back, on and off", () => {
    const s = fakeStorage();
    writeForceMotion(s, true);
    expect(s.data.get(FORCE_MOTION_KEY)).toBe("1");
    expect(readForceMotion(s)).toBe(true);
    writeForceMotion(s, false);
    expect(readForceMotion(s)).toBe(false);
  });

  test("a throwing storage is read as off and written without error", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readForceMotion(broken)).toBe(false);
    expect(() => writeForceMotion(broken, true)).not.toThrow();
  });
});

describe("applyFxPreview", () => {
  const forecast: Forecast = {
    current: { time: new Date("2026-01-01T10:00:00Z"), temp: 21, apparent: 20, humidity: 55, code: 3, isDay: true },
    today: { max: 25, min: 15, pop: 30, sunrise: null, sunset: null },
    hourly: [{ time: new Date("2026-01-01T10:00:00Z"), temp: 21, pop: 10, code: 3, isDay: true }],
  };

  const cases: [string, WeatherKind, string][] = [
    ["rain", "rain", "中雨"],
    ["storm", "storm", "雷雨"],
    ["snow", "snow", "中雪"],
    ["clear-day", "clear", "晴"],
    ["clear-night", "clear", "晴"],
    ["partly", "partly", "多雲"],
    ["cloudy", "cloudy", "陰"],
    ["fog", "fog", "霧"],
  ];

  test.each(cases)("%s previews as a %s sky labelled %s", (fx, kind, label) => {
    const shown = applyFxPreview(forecast, fx);
    expect(describeWeather(shown.current.code)).toEqual({ kind, label });
  });

  test("clear-day and clear-night set the day flag, other kinds keep the forecast's", () => {
    expect(applyFxPreview(forecast, "clear-night").current.isDay).toBe(false);
    expect(
      applyFxPreview({ ...forecast, current: { ...forecast.current, isDay: false } }, "clear-day").current.isDay,
    ).toBe(true);
    expect(applyFxPreview(forecast, "rain").current.isDay).toBe(true);
    const night = { ...forecast, current: { ...forecast.current, isDay: false } };
    expect(applyFxPreview(night, "rain").current.isDay).toBe(false);
    expect(applyFxPreview(forecast, "partly-night").current.isDay).toBe(false);
  });

  test("temperatures and the hourly strip stay real", () => {
    const shown = applyFxPreview(forecast, "snow");
    expect(shown.current.temp).toBe(21);
    expect(shown.current.apparent).toBe(20);
    expect(shown.today).toEqual(forecast.today);
    expect(shown.hourly).toEqual(forecast.hourly);
  });

  test("never mutates the real forecast", () => {
    const before = structuredClone(forecast);
    const shown = applyFxPreview(forecast, "storm");
    expect(shown).not.toBe(forecast);
    expect(shown.current).not.toBe(forecast.current);
    expect(forecast).toEqual(before);
  });

  test("auto, empty and unknown values return the same forecast", () => {
    expect(applyFxPreview(forecast, "auto")).toBe(forecast);
    expect(applyFxPreview(forecast, undefined)).toBe(forecast);
    expect(applyFxPreview(forecast, null)).toBe(forecast);
    expect(applyFxPreview(forecast, "tornado")).toBe(forecast);
  });

  test("every selector option previews", () => {
    for (const o of FX_OPTIONS.slice(1)) expect(applyFxPreview(forecast, o.value)).not.toBe(forecast);
  });
});

describe("fancy effect switches", () => {
  const fakeStorage = () => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };
  const ALL_ON = { meteors: true, shimmer: true, orbit: true, blurFade: true };

  test("four options, one per effect, each with a label", () => {
    expect(FANCY_OPTIONS.map((o) => o.key)).toEqual(["meteors", "shimmer", "orbit", "blurFade"]);
    for (const o of FANCY_OPTIONS) expect(o.label.length).toBeGreaterThan(0);
  });

  test("all on by default, without storage and with nothing stored", () => {
    expect(readFancy(null)).toEqual(ALL_ON);
    expect(readFancy(fakeStorage())).toEqual(ALL_ON);
  });

  test("a written choice reads back", () => {
    const s = fakeStorage();
    writeFancy(s, { ...ALL_ON, meteors: false, orbit: false });
    expect(s.data.has(FANCY_KEY)).toBe(true);
    expect(readFancy(s)).toEqual({ meteors: false, shimmer: true, orbit: false, blurFade: true });
  });

  test("garbage, a missing key or a wrong type fall back to on, per key", () => {
    const s = fakeStorage();
    s.data.set(FANCY_KEY, "not json");
    expect(readFancy(s)).toEqual(ALL_ON);
    s.data.set(FANCY_KEY, JSON.stringify({ meteors: false, shimmer: "no" }));
    expect(readFancy(s)).toEqual({ ...ALL_ON, meteors: false });
    s.data.set(FANCY_KEY, "null");
    expect(readFancy(s)).toEqual(ALL_ON);
  });

  test("a throwing storage reads as all on and writes without error", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readFancy(broken)).toEqual(ALL_ON);
    expect(() => writeFancy(broken, ALL_ON)).not.toThrow();
  });
});
