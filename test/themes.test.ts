import { describe, expect, test } from "bun:test";
import { ambient } from "../src/themes/ambient";
import { analog } from "../src/themes/analog";
import { cinematic } from "../src/themes/cinematic";
import { forecast as forecastTheme } from "../src/themes/forecast";
import { nextThemeIndex, themeIndex, themes } from "../src/themes/index";
import { minimal } from "../src/themes/minimal";
import { deg, esc, type Theme, type ViewState } from "../src/themes/types";
import { type Forecast, parseForecast } from "../src/weather";
import raw from "./fixtures/forecast.json";
import { testConfig } from "./testConfig";

// 2026-11-24 18:00 in Asia/Taipei; the fixture's "current" is this same instant.
const NOW = new Date(Date.UTC(2026, 10, 24, 10, 0));
const TIME = "18:00";
const DATE = "11月24日星期二";

const fc = parseForecast(raw, NOW);

const state = (over: Partial<ViewState> = {}): ViewState => ({
  now: NOW,
  forecast: fc,
  stale: false,
  config: testConfig,
  ...over,
});

/** Visible text only, with whitespace collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("helpers", () => {
  test("esc escapes the five HTML metacharacters", () => {
    expect(esc(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });

  test("deg rounds and appends a degree sign", () => {
    expect(deg(15.8)).toBe("16°");
    expect(deg(-0.4)).toBe("0°");
    expect(deg(19.2)).toBe("19°");
  });
});

describe("registry", () => {
  test("themes are ordered minimal, forecast, analog, ambient, cinematic with their zh-TW names", () => {
    expect(themes.map((t) => [t.id, t.name])).toEqual([
      ["minimal", "極簡"],
      ["forecast", "今日預報"],
      ["analog", "指針"],
      ["ambient", "氛圍"],
      ["cinematic", "電影感"],
    ]);
  });

  test("themeIndex finds known ids, falls back for unknown or missing ones", () => {
    expect(themeIndex("analog", "minimal")).toBe(2);
    expect(themeIndex("nope", "ambient")).toBe(3);
    expect(themeIndex(undefined, "forecast")).toBe(1);
    expect(themeIndex("nope", "also-nope")).toBe(0);
  });

  test("nextThemeIndex wraps in both directions", () => {
    expect(nextThemeIndex(0, 1, 5)).toBe(1);
    expect(nextThemeIndex(4, 1, 5)).toBe(0);
    expect(nextThemeIndex(0, -1, 5)).toBe(4);
    expect(nextThemeIndex(2, -1, 5)).toBe(1);
    expect(nextThemeIndex(1, 5, 5)).toBe(1);
    expect(nextThemeIndex(1, -6, 5)).toBe(0);
  });
});

const rootClass: Record<string, string> = {
  minimal: "t-minimal",
  forecast: "t-forecast",
  analog: "t-analog",
  ambient: "t-ambient",
  cinematic: "t-cinematic",
};

describe.each(themes.map((t): [string, Theme] => [t.id, t]))("%s theme", (id, theme) => {
  test("root element carries the theme class", () => {
    expect(theme.render(state())).toContain(`class="${rootClass[id]}`);
  });

  test("shows the time and date for the configured zone", () => {
    const out = text(theme.render(state()));
    expect(out).toContain(TIME);
    expect(out).toContain(DATE);
  });

  test("draws the time one character per span, with a breathing colon", () => {
    const html = theme.render(state());
    expect(html).toContain('<span class="colon">:</span>');
    expect(html.match(/class="digit"/g)).toHaveLength(4);
    expect(html).not.toContain("digit--changed");
  });

  test("rolls only the digits that changed since the previous render", () => {
    const html = theme.render(state({ anim: { prevTime: "17:59", enter: false } }));
    expect(html.match(/digit--changed/g)).toHaveLength(3);
    expect(html).toContain('data-old="7"');
    expect(html).toContain('data-old="5"');
    expect(html).toContain('data-old="9"');
    expect(text(html)).toContain(TIME);
  });

  test("does not roll when the previous time is unknown (first render, theme switch)", () => {
    expect(theme.render(state({ anim: { prevTime: null, enter: true } }))).not.toContain("digit--changed");
  });

  test("never shows seconds", () => {
    expect(text(theme.render(state()))).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test("renders a muted loading text while there is no forecast", () => {
    const html = theme.render(state({ forecast: null }));
    expect(text(html)).toContain("天氣載入中");
    expect(text(html)).toContain(TIME);
  });

  test("marks the weather block stale only when stale", () => {
    const stale = theme.render(state({ stale: true }));
    const fresh = theme.render(state({ stale: false }));
    expect(stale).toMatch(/class="[^"]*\bweather\b[^"]*\bstale\b/);
    expect(fresh).not.toMatch(/\bstale\b/);
  });

  test("escapes the place name", () => {
    const html = theme.render(state({ config: { ...testConfig, place: "<script>alert(1)</script>" } }));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("minimal", () => {
  test("weather line reads place, temp, label, range and rain chance", () => {
    expect(text(minimal.render(state()))).toContain("Testville 16° 陰 · 16°–19° · 降雨 100%");
  });

  test("omits the rain chance when unknown", () => {
    const f: Forecast = { ...fc, today: { ...fc.today, pop: null } };
    const out = text(minimal.render(state({ forecast: f })));
    expect(out).toContain("Testville 16° 陰 · 16°–19°");
    expect(out).not.toContain("降雨");
  });
});

describe("forecast", () => {
  const html = forecastTheme.render(state());

  test("shows current conditions", () => {
    const out = text(html);
    expect(out).toContain("16°");
    expect(out).toContain("陰");
    expect(out).toContain("體感 16°");
    expect(out).toContain("濕度 84%");
  });

  test("renders exactly 12 hourly cells starting at the current hour", () => {
    expect(html.match(/class="t-forecast__hour[ "]/g)).toHaveLength(12);
    const hours = [...html.matchAll(/class="t-forecast__hour-time[^"]*">(\d+)</g)].map((m) => m[1]);
    expect(hours).toEqual(["18", "19", "20", "21", "22", "23", "00", "01", "02", "03", "04", "05"]);
  });

  test("--pop carries each hour's precipitation probability", () => {
    const pops = [...html.matchAll(/--pop:(\d+)/g)].map((m) => Number(m[1]));
    expect(pops).toEqual([73, 50, 31, 20, 14, 10, 9, 12, 14, 16, 18, 18]);
  });

  test("--pop is 0 when the probability is null", () => {
    const f: Forecast = { ...fc, hourly: fc.hourly.map((h) => ({ ...h, pop: null })) };
    const pops = [...forecastTheme.render(state({ forecast: f })).matchAll(/--pop:(\d+)/g)].map((m) => m[1]);
    expect(pops).toEqual(Array(12).fill("0"));
  });

  test("each hour cell carries its index for the staggered entrance", () => {
    expect([...html.matchAll(/class="t-forecast__hour[^"]*" style="--i:(\d+)"/g)].map((m) => Number(m[1]))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
  });

  test("the strip plays its entrance only when asked to", () => {
    expect(html).not.toContain("t-forecast__strip--enter");
    const entering = forecastTheme.render(state({ anim: { prevTime: null, enter: true } }));
    expect(entering).toMatch(/class="[^"]*\bt-forecast__strip\b[^"]*\bt-forecast__strip--enter\b/);
  });

  test("each hour uses the icon for that hour's day/night", () => {
    const f: Forecast = { ...fc, hourly: fc.hourly.map((h, i) => ({ ...h, code: 0, isDay: i === 0 })) };
    const cells = forecastTheme
      .render(state({ forecast: f }))
      .split(/class="t-forecast__hour(?: [^"]*)?"/)
      .slice(1);
    // Sun has a <circle>, moon is a single <path>.
    expect(cells[0]).toContain("<circle");
    expect(cells[1]).not.toContain("<circle");
  });
});

describe("analog", () => {
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 24, h - 8, m));
  const hands = (html: string) => ({
    hour: Number(html.match(/t-analog__hand--hour[^"]*"[^>]*rotate\(([\d.]+) 100 100\)/)?.[1]),
    minute: Number(html.match(/t-analog__hand--minute[^"]*"[^>]*rotate\(([\d.]+) 100 100\)/)?.[1]),
  });

  test("draws a 200x200 face with 12 ticks and no second hand", () => {
    const html = analog.render(state());
    expect(html).toContain('viewBox="0 0 200 200"');
    expect(html.match(/class="t-analog__tick/g)).toHaveLength(12);
    expect(html).not.toContain("second");
  });

  test("03:00 puts the hour hand at 90 and the minute hand at 0", () => {
    expect(hands(analog.render(state({ now: at(3, 0) })))).toEqual({ hour: 90, minute: 0 });
  });

  test("09:30 puts the hour hand at 285 and the minute hand at 180", () => {
    expect(hands(analog.render(state({ now: at(9, 30) })))).toEqual({ hour: 285, minute: 180 });
  });

  test("afternoon hours wrap on a 12-hour dial", () => {
    expect(hands(analog.render(state({ now: at(15, 0) })))).toEqual({ hour: 90, minute: 0 });
  });

  test("each hand sweeps to where it will be a minute later, joining mid-minute", () => {
    // 09:30:15 -> the minute hand goes 180 -> 186 and the hour hand 285 -> 285.5, 15 s in.
    const html = analog.render(state({ now: new Date(Date.UTC(2026, 10, 24, 1, 30, 15)) }));
    expect(html).toMatch(/t-analog__hand--hour[^"]*"[^>]*style="--a:285deg;--to:285\.5deg;animation-delay:-15\.00s"/);
    expect(html).toMatch(/t-analog__hand--minute[^"]*"[^>]*style="--a:180deg;--to:186deg;animation-delay:-15\.00s"/);
  });

  test("shares the minimal theme's weather line", () => {
    expect(text(analog.render(state()))).toContain("Testville 16° 陰 · 16°–19° · 降雨 100%");
  });
});

describe("ambient", () => {
  test("tags the root with the weather kind and day part", () => {
    const html = ambient.render(state());
    expect(html).toContain('data-kind="cloudy"');
    expect(html).toContain('data-daypart="night"');

    const sunny: Forecast = { ...fc, current: { ...fc.current, code: 0, isDay: true } };
    const day = ambient.render(state({ forecast: sunny }));
    expect(day).toContain('data-kind="clear"');
    expect(day).toContain('data-daypart="day"');
  });

  test("defaults to night when there is no forecast", () => {
    expect(ambient.render(state({ forecast: null }))).toContain('data-daypart="night"');
  });

  test("shows place, label and temperature", () => {
    expect(text(ambient.render(state()))).toContain("Testville · 陰 16°");
  });

  test("shows sunrise and sunset", () => {
    expect(text(ambient.render(state()))).toContain("日出 06:16 · 日落 17:04");
  });

  test("omits sunrise and sunset when unknown", () => {
    const f: Forecast = { ...fc, today: { ...fc.today, sunrise: null, sunset: null } };
    const out = text(ambient.render(state({ forecast: f })));
    expect(out).not.toContain("日出");
    expect(out).not.toContain("日落");
  });
});

describe("cinematic", () => {
  test("shows place, temperature, label and the day's range on one compact line", () => {
    expect(text(cinematic.render(state()))).toContain("Testville 16° 陰 · 16°–19°");
  });

  test("has no icon, no orbit dots and no rain chance: the scene behind is the weather", () => {
    const html = cinematic.render(state());
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("wx-orbit");
    expect(text(html)).not.toContain("降雨");
  });

  test("is one content-sized column (the one-minute relocation moves it), not a full-screen layer", () => {
    const html = cinematic.render(state());
    expect(html).toMatch(/^<div class="t-cinematic flex flex-col items-center/);
    expect(html).not.toMatch(/\b(fixed|absolute|w-screen|h-screen|w-full|h-full)\b/);
  });

  test("the clock is the big thin one, the date sits under it", () => {
    const html = cinematic.render(state());
    expect(html).toMatch(/class="t-cinematic__time [^"]*\btext-tv-300\b[^"]*\bfont-extralight\b/);
    expect(html.indexOf("t-cinematic__time")).toBeLessThan(html.indexOf("t-cinematic__date"));
    expect(html.indexOf("t-cinematic__date")).toBeLessThan(html.indexOf("t-cinematic__weather"));
  });

  test("is not tinted: no data-kind, so the ambient backdrop stays off", () => {
    expect(cinematic.render(state())).not.toContain("data-kind");
  });
});

describe("fancy effect hooks", () => {
  const DOTS = /class="wx-orbit /g;

  test("minimal, analog and forecast orbit dots around their main weather icon, ambient has none", () => {
    expect(minimal.render(state()).match(DOTS)).toHaveLength(3);
    expect(analog.render(state()).match(DOTS)).toHaveLength(3);
    expect(forecastTheme.render(state()).match(DOTS)).toHaveLength(3);
    expect(ambient.render(state()).match(DOTS)).toBeNull();
  });

  test("the forecast's hourly icons do not orbit", () => {
    const strip = forecastTheme.render(state()).split("t-forecast__strip")[1];
    expect(strip).not.toContain("wx-orbit");
  });

  test("the date line shimmers in every theme", () => {
    for (const t of themes) {
      expect(t.render(state())).toMatch(new RegExp(`class="t-${t.id}__date [^"]*\\bshimmer\\b`));
    }
  });

  test("so do the temperatures that stand out (ambient's is inline text, which cannot be clipped to its box)", () => {
    expect(minimal.render(state())).toMatch(/class="weather-line__temp [^"]*\bshimmer\b/);
    expect(forecastTheme.render(state())).toMatch(/class="t-forecast__temp [^"]*\bshimmer\b/);
  });

  test("a shimmering element hugs its text, so the sweep does not light empty space", () => {
    expect(forecastTheme.render(state())).toMatch(/class="t-forecast__date [^"]*\bw-fit\b/);
  });

  test("the loading state has no orbit dots", () => {
    expect(minimal.render(state({ forecast: null }))).not.toContain("wx-orbit");
  });
});
