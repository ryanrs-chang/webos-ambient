// All formatting takes an explicit time zone, so the TV's own setting and the
// test runner's machine never change what is drawn.

const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = timeZone + JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("zh-TW", { timeZone, ...options });
    cache.set(key, f);
  }
  return f;
}

export interface ClockParts {
  hour: number;
  minute: number;
}

export function clockParts(date: Date, timeZone: string): ClockParts {
  const parts = fmt(timeZone, { hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get("hour"), minute: get("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "08:30" */
export function formatTime(date: Date, timeZone: string): string {
  const { hour, minute } = clockParts(date, timeZone);
  return `${pad(hour)}:${pad(minute)}`;
}

/** "14" — the hour alone, for the hourly strip. */
export function formatHour(date: Date, timeZone: string): string {
  return pad(clockParts(date, timeZone).hour);
}

/** "11月24日星期二": no space between date and weekday, whatever the ICU version. */
export function formatDate(date: Date, timeZone: string): string {
  // ICU versions disagree on a space before the weekday ("11月24日 星期二" on Linux, none on macOS), so drop
  // whitespace: the date then reads the same on the TV, a desktop and CI.
  return fmt(timeZone, { month: "long", day: "numeric", weekday: "long" })
    .format(date)
    .replace(/\s+/g, "");
}

/** Milliseconds until the next minute boundary, so the display flips on :00. */
export function msToNextMinute(date: Date): number {
  return 60_000 - (date.getTime() % 60_000);
}
