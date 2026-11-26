import { timeHtml } from "../anim";
import { formatDate, formatTime } from "../clock";
import { ICON_CLASS, weatherIcon } from "../icons";
import { indoorLine } from "../indoor";
import { describeWeather } from "../weather";
import { deg, esc, LOADING, type Theme, type ViewState, weatherClass } from "./types";

const LINE_BASE = "flex items-center justify-center gap-4 text-fg";

/** Full class names only: Tailwind finds utilities by scanning for them, so they cannot be assembled from parts. */
const LINE_SIZES = {
  large: { line: "mt-8 text-tv-40", temp: "text-tv-48" },
  small: { line: "text-tv-32", temp: "text-tv-36" },
} as const;

export type WeatherLineSize = keyof typeof LINE_SIZES;

/** "[icon] Greenwich 16° 陰 · 16°–19° · 降雨 100%", or the loading text while there is no forecast. */
export function weatherLine(state: ViewState, size: WeatherLineSize = "large"): string {
  const { forecast, config } = state;
  const sizes = LINE_SIZES[size];
  const line = `weather-line ${LINE_BASE} ${sizes.line}`;
  if (!forecast) {
    return `<div class="${weatherClass(state, line, "weather--loading")}">${LOADING}</div>`;
  }
  const { kind, label } = describeWeather(forecast.current.code);
  const { today } = forecast;
  const pop =
    today.pop === null ? "" : ` <span class="weather-line__pop text-fg-dim">· 降雨 ${Math.round(today.pop)}%</span>`;
  return (
    `<div class="${weatherClass(state, line)}">` +
    weatherIcon(kind, forecast.current.isDay, 64, `${ICON_CLASS} weather-line__icon mr-1`, true) +
    `<span class="weather-line__place">${esc(config.place)}</span> ` +
    `<span class="weather-line__temp shimmer ${sizes.temp}">${deg(forecast.current.temp)}</span> ` +
    `<span class="weather-line__label text-fg-dim">${esc(label)}</span> ` +
    `<span class="weather-line__range text-fg-dim">· ${deg(today.min)}–${deg(today.max)}</span>` +
    `${pop}</div>`
  );
}

export const minimal: Theme = {
  id: "minimal",
  name: "極簡",
  render(state) {
    const { now, config } = state;
    return (
      `<div class="t-minimal flex flex-col items-center justify-center gap-6">` +
      `<div class="t-minimal__time text-tv-300 font-extralight leading-none tracking-[0.02em] tabular-nums">${timeHtml(formatTime(now, config.timeZone), state.anim?.prevTime ?? null)}</div>` +
      `<div class="t-minimal__date shimmer text-tv-56 text-fg-dim">${esc(formatDate(now, config.timeZone))}</div>` +
      weatherLine(state) +
      indoorLine(state.indoor, "text-tv-32") +
      `</div>`
    );
  },
};
