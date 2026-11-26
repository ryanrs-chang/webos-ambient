import { timeHtml } from "../anim";
import { formatDate, formatTime } from "../clock";
import { indoorLine } from "../indoor";
import { describeWeather } from "../weather";
import { deg, esc, LOADING, type Theme, type ViewState, weatherClass } from "./types";

const WEATHER_BOX = "mt-6 text-tv-44";

function placeLine(state: ViewState): string {
  const { forecast, config } = state;
  if (!forecast) {
    return `<div class="${weatherClass(state, "t-ambient__weather", WEATHER_BOX, "weather--loading")}">${LOADING}</div>`;
  }
  const { label } = describeWeather(forecast.current.code);
  return (
    `<div class="${weatherClass(state, "t-ambient__weather", WEATHER_BOX)}">` +
    `<span class="t-ambient__place text-fg-dim">${esc(config.place)}</span> · ` +
    `<span class="t-ambient__label text-fg-dim">${esc(label)}</span> ` +
    `<span class="t-ambient__temp text-tv-56">${deg(forecast.current.temp)}</span>` +
    `</div>`
  );
}

function sunLine(state: ViewState): string {
  if (!state.forecast) return "";
  const { sunrise, sunset } = state.forecast.today;
  const tz = state.config.timeZone;
  const parts = [
    sunrise ? `<span class="t-ambient__sunrise">日出 ${formatTime(sunrise, tz)}</span>` : "",
    sunset ? `<span class="t-ambient__sunset">日落 ${formatTime(sunset, tz)}</span>` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  return `<div class="${weatherClass(state, "t-ambient__sun", "text-tv-32 text-fg-faint")}">${parts.join(" · ")}</div>`;
}

export const ambient: Theme = {
  id: "ambient",
  name: "氛圍",
  render(state) {
    const { now, config, forecast } = state;
    // CSS tints a very dark background from these two; without a forecast, stay at the darkest.
    const kind = forecast ? describeWeather(forecast.current.code).kind : "none";
    const daypart = forecast?.current.isDay ? "day" : "night";
    return (
      `<div class="t-ambient flex flex-col items-center justify-center gap-5" data-kind="${kind}" data-daypart="${daypart}">` +
      `<div class="t-ambient__time text-tv-260 font-extralight leading-none tabular-nums">${timeHtml(formatTime(now, config.timeZone), state.anim?.prevTime ?? null)}</div>` +
      `<div class="t-ambient__date shimmer text-tv-52 text-fg-dim">${esc(formatDate(now, config.timeZone))}</div>` +
      placeLine(state) +
      sunLine(state) +
      indoorLine(state.indoor, "text-tv-32") +
      `</div>`
    );
  },
};
