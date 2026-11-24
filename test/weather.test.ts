import { describe, expect, test } from "bun:test";
import { describeWeather, fetchForecast, forecastUrl, parseForecast } from "../src/weather";
import fixture from "./fixtures/forecast.json";
import { testConfig } from "./testConfig";

const HOUR_MS = 3_600_000;
const hourlyMs = fixture.hourly.time.map((s) => s * 1000);

describe("describeWeather", () => {
  const cases: [number, string, string][] = [
    [0, "clear", "晴"],
    [1, "partly", "晴時多雲"],
    [2, "partly", "多雲"],
    [3, "cloudy", "陰"],
    [45, "fog", "霧"],
    [61, "rain", "小雨"],
    [80, "rain", "陣雨"],
    [71, "snow", "小雪"],
    [95, "storm", "雷雨"],
  ];
  for (const [code, kind, label] of cases) {
    test(`code ${code} -> ${kind}`, () => {
      expect(describeWeather(code)).toEqual({ kind, label } as ReturnType<typeof describeWeather>);
    });
  }

  for (const code of [4, 100, -1, Number.NaN]) {
    test(`unknown code ${code} falls back to cloudy`, () => {
      expect(describeWeather(code)).toEqual({ kind: "cloudy", label: "—" });
    });
  }
});

describe("forecastUrl", () => {
  test("carries location, zone and unix time format", () => {
    const url = new URL(forecastUrl(testConfig));
    expect(`${url.origin}${url.pathname}`).toBe(testConfig.weatherUrl);
    expect(url.searchParams.get("latitude")).toBe(String(testConfig.latitude));
    expect(url.searchParams.get("longitude")).toBe(String(testConfig.longitude));
    expect(url.searchParams.get("timezone")).toBe("Asia/Taipei");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
  });

  test("uses the baseUrl override when given", () => {
    const url = new URL(forecastUrl(testConfig, "http://localhost:8080/forecast"));
    expect(`${url.origin}${url.pathname}`).toBe("http://localhost:8080/forecast");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
  });

  test("uses config.weatherUrl when no override is given", () => {
    const url = forecastUrl({ ...testConfig, weatherUrl: "http://example.test/x" });
    expect(url.startsWith("http://example.test/x?")).toBe(true);
  });

  test("encodes a non-default zone", () => {
    const url = new URL(forecastUrl({ ...testConfig, timeZone: "America/New_York" }));
    expect(url.searchParams.get("timezone")).toBe("America/New_York");
  });
});

describe("parseForecast", () => {
  test("hourly strip starts at the last slot at or before a mid-hour now", () => {
    const now = new Date(hourlyMs[5] + 20 * 60_000);
    const f = parseForecast(fixture, now);
    expect(f.hourly).toHaveLength(12);
    expect(f.hourly[0].time.getTime()).toBe(hourlyMs[5]);
    expect(f.hourly[11].time.getTime()).toBe(hourlyMs[16]);
  });

  test("a now exactly on a slot starts at that slot", () => {
    const f = parseForecast(fixture, new Date(hourlyMs[7]));
    expect(f.hourly[0].time.getTime()).toBe(hourlyMs[7]);
  });

  test("a now before the data falls back to the first slot", () => {
    const f = parseForecast(fixture, new Date(hourlyMs[0] - HOUR_MS));
    expect(f.hourly[0].time.getTime()).toBe(hourlyMs[0]);
  });

  test("strip is shorter near the end of the data", () => {
    const last = hourlyMs.length - 1;
    const f = parseForecast(fixture, new Date(hourlyMs[last - 2] + 1));
    expect(f.hourly).toHaveLength(3);
    expect(f.hourly[2].time.getTime()).toBe(hourlyMs[last]);
  });

  test("the hours argument sets the strip length", () => {
    expect(parseForecast(fixture, new Date(hourlyMs[0]), 5).hourly).toHaveLength(5);
  });

  test("hourly points mirror the raw arrays", () => {
    const f = parseForecast(fixture, new Date(hourlyMs[3]));
    f.hourly.forEach((p, j) => {
      const i = 3 + j;
      expect(p.temp).toBe(fixture.hourly.temperature_2m[i]);
      expect(p.pop).toBe(fixture.hourly.precipitation_probability[i]);
      expect(p.code).toBe(fixture.hourly.weather_code[i]);
      expect(p.isDay).toBe(fixture.hourly.is_day[i] === 1);
    });
  });

  test("isDay is a boolean, not a 0/1 number", () => {
    const f = parseForecast(fixture, new Date(hourlyMs[0]), 48);
    for (const p of f.hourly) expect(typeof p.isDay).toBe("boolean");
    expect(f.hourly.some((p) => p.isDay)).toBe(true);
    expect(f.hourly.some((p) => !p.isDay)).toBe(true);
    expect(typeof f.current.isDay).toBe("boolean");
    expect(f.current.isDay).toBe(false);
  });

  test("today comes from daily[0]", () => {
    const { today } = parseForecast(fixture, new Date(hourlyMs[5]));
    expect(today.max).toBe(fixture.daily.temperature_2m_max[0]);
    expect(today.min).toBe(fixture.daily.temperature_2m_min[0]);
    expect(today.pop).toBe(fixture.daily.precipitation_probability_max[0]);
    expect(today.sunrise?.getTime()).toBe(fixture.daily.sunrise[0] * 1000);
    expect(today.sunset?.getTime()).toBe(fixture.daily.sunset[0] * 1000);
  });

  test("current mirrors the raw current block", () => {
    const { current } = parseForecast(fixture, new Date(hourlyMs[5]));
    expect(current.time.getTime()).toBe(fixture.current.time * 1000);
    expect(current.temp).toBe(fixture.current.temperature_2m);
    expect(current.apparent).toBe(fixture.current.apparent_temperature);
    expect(current.humidity).toBe(fixture.current.relative_humidity_2m);
    expect(current.code).toBe(fixture.current.weather_code);
  });

  test("missing pop and sun times become null", () => {
    const raw = structuredClone(fixture) as unknown as {
      hourly: { precipitation_probability: (number | null)[] };
      daily: { precipitation_probability_max: (number | null)[]; sunrise: number[]; sunset: number[] };
    };
    raw.hourly.precipitation_probability[0] = null;
    raw.daily.precipitation_probability_max[0] = null;
    raw.daily.sunrise = [];
    raw.daily.sunset = [];
    const f = parseForecast(raw, new Date(hourlyMs[0]));
    expect(f.hourly[0].pop).toBeNull();
    expect(f.today.pop).toBeNull();
    expect(f.today.sunrise).toBeNull();
    expect(f.today.sunset).toBeNull();
  });

  const malformed: [string, unknown][] = [
    ["null", null],
    ["a string", "nope"],
    ["empty object", {}],
    ["no current", { hourly: fixture.hourly, daily: fixture.daily }],
    ["no hourly", { current: fixture.current, daily: fixture.daily }],
    ["no daily", { current: fixture.current, hourly: fixture.hourly }],
    ["hourly without time", { current: fixture.current, hourly: {}, daily: fixture.daily }],
  ];
  for (const [name, raw] of malformed) {
    test(`throws on malformed shape: ${name}`, () => {
      expect(() => parseForecast(raw, new Date())).toThrow("unexpected forecast shape");
    });
  }
});

describe("fetchForecast", () => {
  const jsonResponse = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init);

  test("fetches the forecast URL through the injected fetchFn and parses it", async () => {
    const seen: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return jsonResponse(fixture);
    }) as typeof fetch;
    const now = new Date(hourlyMs[5] + 60_000);
    const f = await fetchForecast(testConfig, now, fetchFn);
    expect(seen).toEqual([forecastUrl(testConfig)]);
    expect(f.hourly[0].time.getTime()).toBe(hourlyMs[5]);
    expect(f.today.max).toBe(fixture.daily.temperature_2m_max[0]);
  });

  test("throws on a non-ok status", async () => {
    const fetchFn = (async () => jsonResponse({}, { status: 503 })) as unknown as typeof fetch;
    await expect(fetchForecast(testConfig, new Date(), fetchFn)).rejects.toThrow("forecast HTTP 503");
  });

  test("throws when the body is not a forecast", async () => {
    const fetchFn = (async () => jsonResponse({ error: true })) as unknown as typeof fetch;
    await expect(fetchForecast(testConfig, new Date(), fetchFn)).rejects.toThrow("unexpected forecast shape");
  });
});
