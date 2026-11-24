import { sweepStyle, timeHtml } from "../anim";
import { clockParts, formatDate, formatTime } from "../clock";
import { weatherLine } from "./minimal";
import { esc, type Theme } from "./types";

const ticks = Array.from(
  { length: 12 },
  (_, i) =>
    `<line class="t-analog__tick ${i % 3 === 0 ? "t-analog__tick--major stroke-[#dcdcdc] stroke-[1.4]" : "stroke-fg-dim stroke-[0.8]"}" x1="100" y1="8" x2="100" y2="${i % 3 === 0 ? 24 : 16}" transform="rotate(${i * 30} 100 100)"/>`,
).join("");

export const analog: Theme = {
  id: "analog",
  name: "指針",
  render(state) {
    const { now, config } = state;
    const { hour, minute } = clockParts(now, config.timeZone);
    const hourAngle = (hour % 12) * 30 + minute * 0.5;
    const minuteAngle = minute * 6;
    // Each hand sweeps linearly to where it will be one minute later (see .t-analog__hand), joining mid-minute.
    const elapsed = now.getUTCSeconds() + now.getUTCMilliseconds() / 1000;
    const hourSweep = sweepStyle(hourAngle, hourAngle + 0.5, elapsed);
    const minuteSweep = sweepStyle(minuteAngle, minuteAngle + 6, elapsed);
    return (
      `<div class="t-analog flex flex-col items-center justify-center gap-4">` +
      `<svg class="t-analog__face size-140 text-fg" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">` +
      ticks +
      `<line class="t-analog__hand t-analog__hand--hour stroke-fg stroke-[3]" x1="100" y1="100" x2="100" y2="56" transform="rotate(${hourAngle} 100 100)" style="${hourSweep}"/>` +
      `<line class="t-analog__hand t-analog__hand--minute stroke-fg stroke-2" x1="100" y1="100" x2="100" y2="30" transform="rotate(${minuteAngle} 100 100)" style="${minuteSweep}"/>` +
      `<circle class="t-analog__pivot fill-fg stroke-none" cx="100" cy="100" r="2"/>` +
      `</svg>` +
      `<div class="t-analog__time text-tv-72 font-extralight leading-none tabular-nums">${timeHtml(formatTime(now, config.timeZone), state.anim?.prevTime ?? null)}</div>` +
      `<div class="t-analog__date shimmer text-tv-36 text-fg-dim">${esc(formatDate(now, config.timeZone))}</div>` +
      weatherLine(state, "small") +
      `</div>`
    );
  },
};
