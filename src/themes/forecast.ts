import { timeHtml } from "../anim";
import { formatDate, formatHour, formatTime } from "../clock";
import { ICON_CLASS, weatherIcon } from "../icons";
import { indoorLine } from "../indoor";
import { describeWeather, type HourPoint } from "../weather";
import { deg, esc, LOADING, type Theme, type ViewState, weatherClass } from "./types";

// The areas of the grid are named in styles/components.css (.t-forecast__now).
const NOW_BOX = "grid grid-cols-[auto_auto] items-center justify-items-end gap-x-8 text-right";
const STRIP_BOX = "grid list-none grid-cols-[repeat(12,1fr)] gap-2 border-t border-t-line pt-8";

function hourCell(h: HourPoint, i: number, timeZone: string): string {
  const { kind } = describeWeather(h.code);
  // --pop is the only thing CSS needs to size the bar; null is "no data", drawn as empty.
  const pop = h.pop === null ? 0 : Math.round(h.pop);
  return (
    `<li class="t-forecast__hour flex flex-col items-center gap-4" style="--i:${i}">` +
    `<span class="t-forecast__hour-time text-tv-30 text-fg-dim tabular-nums">${formatHour(h.time, timeZone)}</span>` +
    weatherIcon(kind, h.isDay, 40, `${ICON_CLASS} t-forecast__hour-icon`) +
    `<span class="t-forecast__hour-temp text-tv-40">${deg(h.temp)}</span>` +
    `<span class="t-forecast__pop relative block h-1 w-[72%] bg-[#1a1a1a]" style="--pop:${pop}"></span>` +
    `</li>`
  );
}

function current(state: ViewState): string {
  const { forecast, config } = state;
  if (!forecast) {
    return `<div class="${weatherClass(state, "t-forecast__now", NOW_BOX, "weather--loading")}">${LOADING}</div>`;
  }
  const { current: c } = forecast;
  const { kind, label } = describeWeather(c.code);
  return (
    `<div class="${weatherClass(state, "t-forecast__now", NOW_BOX)}">` +
    `<span class="t-forecast__place text-tv-40 text-fg-dim">${esc(config.place)}</span>` +
    `<span class="t-forecast__temp shimmer text-tv-140 font-extralight leading-[1.1]">${deg(c.temp)}</span>` +
    weatherIcon(kind, c.isDay, 96, `${ICON_CLASS} t-forecast__icon`, true) +
    `<span class="t-forecast__label text-tv-44">${esc(label)}</span>` +
    `<span class="t-forecast__feels text-tv-32 text-fg-dim">體感 ${deg(c.apparent)}</span> ` +
    `<span class="t-forecast__humidity text-tv-32 text-fg-dim">濕度 ${Math.round(c.humidity)}%</span>` +
    `</div>`
  );
}

export const forecast: Theme = {
  id: "forecast",
  name: "今日預報",
  render(state) {
    const { now, config } = state;
    const strip = state.forecast
      ? `<ol class="${weatherClass(state, "t-forecast__strip", STRIP_BOX, ...(state.anim?.enter ? ["t-forecast__strip--enter"] : []))}">${state.forecast.hourly
          .slice(0, 12)
          .map((h, i) => hourCell(h, i, config.timeZone))
          .join("")}</ol>`
      : "";
    return (
      `<div class="t-forecast flex w-[1450px] flex-col gap-18">` +
      `<div class="t-forecast__top flex items-start justify-between">` +
      `<div class="t-forecast__clock">` +
      `<div class="t-forecast__time text-tv-220 font-extralight leading-none tabular-nums">${timeHtml(formatTime(now, config.timeZone), state.anim?.prevTime ?? null)}</div>` +
      `<div class="t-forecast__date shimmer mt-4 w-fit text-tv-48 text-fg-dim">${esc(formatDate(now, config.timeZone))}</div>` +
      `</div>` +
      current(state) +
      `</div>` +
      strip +
      indoorLine(state.indoor, "text-tv-32 justify-end") +
      `</div>`
    );
  },
};
