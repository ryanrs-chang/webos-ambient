import type { Config } from "./config";

export type WeatherKind = "clear" | "partly" | "cloudy" | "fog" | "rain" | "snow" | "storm";

export interface WeatherDescription {
  kind: WeatherKind;
  label: string;
}

export interface HourPoint {
  time: Date;
  temp: number;
  /** Precipitation probability in percent; null when the model has none. */
  pop: number | null;
  code: number;
  isDay: boolean;
}

export interface Forecast {
  current: {
    time: Date;
    temp: number;
    apparent: number;
    humidity: number;
    code: number;
    isDay: boolean;
  };
  today: {
    max: number;
    min: number;
    pop: number | null;
    sunrise: Date | null;
    sunset: Date | null;
  };
  hourly: HourPoint[];
}

// WMO weather interpretation codes, as Open-Meteo reports them.
const WMO: Record<number, WeatherDescription> = {
  0: { kind: "clear", label: "晴" },
  1: { kind: "partly", label: "晴時多雲" },
  2: { kind: "partly", label: "多雲" },
  3: { kind: "cloudy", label: "陰" },
  45: { kind: "fog", label: "霧" },
  48: { kind: "fog", label: "霧淞" },
  51: { kind: "rain", label: "毛毛雨" },
  53: { kind: "rain", label: "毛毛雨" },
  55: { kind: "rain", label: "毛毛雨" },
  56: { kind: "rain", label: "凍毛毛雨" },
  57: { kind: "rain", label: "凍毛毛雨" },
  61: { kind: "rain", label: "小雨" },
  63: { kind: "rain", label: "中雨" },
  65: { kind: "rain", label: "大雨" },
  66: { kind: "rain", label: "凍雨" },
  67: { kind: "rain", label: "凍雨" },
  71: { kind: "snow", label: "小雪" },
  73: { kind: "snow", label: "中雪" },
  75: { kind: "snow", label: "大雪" },
  77: { kind: "snow", label: "雪粒" },
  80: { kind: "rain", label: "陣雨" },
  81: { kind: "rain", label: "陣雨" },
  82: { kind: "rain", label: "強陣雨" },
  85: { kind: "snow", label: "陣雪" },
  86: { kind: "snow", label: "陣雪" },
  95: { kind: "storm", label: "雷雨" },
  96: { kind: "storm", label: "雷雨冰雹" },
  99: { kind: "storm", label: "雷雨冰雹" },
};

export function describeWeather(code: number): WeatherDescription {
  return WMO[code] ?? { kind: "cloudy", label: "—" };
}

export function forecastUrl(config: Config, baseUrl = config.weatherUrl): string {
  const params = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day",
    hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: config.timeZone,
    timeformat: "unixtime",
    forecast_days: "2",
  });
  return `${baseUrl}?${params}`;
}

interface OpenMeteoResponse {
  current: {
    time: number;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    is_day: number;
  };
  hourly: {
    time: number[];
    temperature_2m: number[];
    precipitation_probability: (number | null)[];
    weather_code: number[];
    is_day: number[];
  };
  daily: {
    time: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    sunrise: number[];
    sunset: number[];
  };
}

const fromUnix = (s: number) => new Date(s * 1000);

/** Turns an Open-Meteo response into the shape the themes draw, starting the hourly strip at the current hour. */
export function parseForecast(raw: unknown, now: Date, hours = 12): Forecast {
  const r = raw as OpenMeteoResponse;
  if (!r?.current || !r.hourly?.time || !r.daily?.time) throw new Error("unexpected forecast shape");

  const nowS = now.getTime() / 1000;
  // Last hourly slot that has started; fall back to the first one.
  let start = 0;
  r.hourly.time.forEach((t, i) => {
    if (t <= nowS) start = i;
  });

  const hourly: HourPoint[] = r.hourly.time.slice(start, start + hours).map((t, j) => {
    const i = start + j;
    return {
      time: fromUnix(t),
      temp: r.hourly.temperature_2m[i],
      pop: r.hourly.precipitation_probability[i] ?? null,
      code: r.hourly.weather_code[i],
      isDay: r.hourly.is_day[i] === 1,
    };
  });

  // daily[0] is "today" in the requested time zone.
  const d = r.daily;
  return {
    current: {
      time: fromUnix(r.current.time),
      temp: r.current.temperature_2m,
      apparent: r.current.apparent_temperature,
      humidity: r.current.relative_humidity_2m,
      code: r.current.weather_code,
      isDay: r.current.is_day === 1,
    },
    today: {
      max: d.temperature_2m_max[0],
      min: d.temperature_2m_min[0],
      pop: d.precipitation_probability_max[0] ?? null,
      sunrise: d.sunrise[0] ? fromUnix(d.sunrise[0]) : null,
      sunset: d.sunset[0] ? fromUnix(d.sunset[0]) : null,
    },
    hourly,
  };
}

export async function fetchForecast(
  config: Config,
  now = new Date(),
  fetchFn: typeof fetch = fetch,
): Promise<Forecast> {
  const res = await fetchFn(forecastUrl(config));
  if (!res.ok) throw new Error(`forecast HTTP ${res.status}`);
  return parseForecast(await res.json(), now);
}
