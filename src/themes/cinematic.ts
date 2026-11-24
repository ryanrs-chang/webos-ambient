import { timeHtml } from "../anim";
import { formatDate, formatTime } from "../clock";
import { CINEMATIC_THEME_ID } from "../effects/cinematic";
import { describeWeather } from "../weather";
import { deg, esc, LOADING, type Theme, type ViewState, weatherClass } from "./types";

const LINE = "t-cinematic__weather text-tv-36 text-fg-dim";

/**
 * "Testville 16° 陰 · 16°–19°": no icon (the scene behind the clock is the weather) and no rain chance, so the
 * line stays short under the big clock.
 */
function weatherLine(state: ViewState): string {
  const { forecast, config } = state;
  if (!forecast) return `<div class="${weatherClass(state, LINE, "weather--loading")}">${LOADING}</div>`;
  const { label } = describeWeather(forecast.current.code);
  const { today } = forecast;
  return (
    `<div class="${weatherClass(state, LINE)}">` +
    `<span class="t-cinematic__place">${esc(config.place)}</span> ` +
    `<span class="t-cinematic__temp text-fg">${deg(forecast.current.temp)}</span> ` +
    `<span class="t-cinematic__label">${esc(label)}</span> ` +
    `<span class="t-cinematic__range">· ${deg(today.min)}–${deg(today.max)}</span>` +
    `</div>`
  );
}

/**
 * 電影感: a big thin clock, the date and one weather line over the layered canvas scene of
 * src/effects/cinematic.ts. Content-sized like every theme, so the one-minute zone relocation still moves it.
 */
export const cinematic: Theme = {
  id: CINEMATIC_THEME_ID,
  name: "電影感",
  render(state) {
    const { now, config } = state;
    return (
      `<div class="t-cinematic flex flex-col items-center justify-center gap-8">` +
      `<div class="t-cinematic__time text-tv-300 font-extralight leading-none tracking-[0.02em] tabular-nums">${timeHtml(formatTime(now, config.timeZone), state.anim?.prevTime ?? null)}</div>` +
      `<div class="t-cinematic__date shimmer text-tv-40 tracking-[0.08em] text-fg-dim">${esc(formatDate(now, config.timeZone))}</div>` +
      weatherLine(state) +
      `</div>`
    );
  },
};
