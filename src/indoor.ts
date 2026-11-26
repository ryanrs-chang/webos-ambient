// Indoor readings from Home Assistant (src/ha.ts): temperature, humidity, CO2 and PM2.5.
// Each configured entity is classified by its `device_class` attribute, or failing that by its unit, so the
// config only lists entity ids. When two entities share a slot, the first one in `haEntities` wins.
import type { Entities, EntityState } from "./ha";

export interface Indoor {
  temp?: number;
  humidity?: number;
  co2?: number;
  pm25?: number;
}

export type IndoorSlot = keyof Indoor;

export interface Band {
  /** The band holds values below this (Infinity for the last one). */
  below: number;
  label: string;
  /** Drawn brighter: something to act on (open a window, run the purifier, dehumidify). */
  warn: boolean;
}

// CO2: Taiwan's indoor standard is 1000 ppm (8 h), 800 ppm for sensitive sites; decision-making drops from about
// 1000 ppm in chamber studies (Satish et al. 2012), though results vary.
export const CO2_BANDS: readonly Band[] = [
  { below: 800, label: "清新", warn: false },
  { below: 1000, label: "還行", warn: false },
  { below: 1500, label: "有點悶", warn: true },
  { below: 2000, label: "很悶", warn: true },
  { below: Number.POSITIVE_INFINITY, label: "該通風", warn: true },
];

// PM2.5 (µg/m3): US EPA 2024 AQI "good" up to 9, Taiwan's indoor standard 35 (24 h), EPA "unhealthy" from 55.5.
export const PM25_BANDS: readonly Band[] = [
  { below: 9.5, label: "乾淨", warn: false },
  { below: 35.5, label: "普通", warn: false },
  { below: 55.5, label: "偏高", warn: true },
  { below: Number.POSITIVE_INFINITY, label: "不健康", warn: true },
];

// Relative humidity (%): 30-50 is the commonly advised range, dust mites thrive above 50, mold above 60.
export const HUMIDITY_BANDS: readonly Band[] = [
  { below: 30, label: "乾燥", warn: true },
  { below: 50.5, label: "舒適", warn: false },
  { below: 60.5, label: "還可以", warn: false },
  { below: Number.POSITIVE_INFINITY, label: "偏濕", warn: true },
];

/** The band a value falls in (bands are sorted by `below`, the last one is open-ended). */
export function bandOf(value: number, bands: readonly Band[]): Band {
  return bands.find((b) => value < b.below) ?? bands[bands.length - 1];
}

const BY_DEVICE_CLASS: Readonly<Record<string, IndoorSlot>> = {
  temperature: "temp",
  humidity: "humidity",
  carbon_dioxide: "co2",
  pm25: "pm25",
};

const BY_UNIT: Readonly<Record<string, IndoorSlot>> = {
  "°C": "temp",
  "%": "humidity",
  ppm: "co2",
  "µg/m\u00b3": "pm25",
  "μg/m\u00b3": "pm25",
};

/** Which slot an entity fills, or null when it is none of the four. */
export function slotOf(e: EntityState): IndoorSlot | null {
  const dc = e.attributes.device_class;
  if (typeof dc === "string" && BY_DEVICE_CLASS[dc]) return BY_DEVICE_CLASS[dc];
  const unit = e.attributes.unit_of_measurement;
  if (typeof unit === "string" && BY_UNIT[unit]) return BY_UNIT[unit];
  return null;
}

/** The readings for `ids` (in order); null when none of them has a numeric state. */
export function indoorReadings(entities: Entities, ids: readonly string[]): Indoor | null {
  const out: Indoor = {};
  for (const id of ids) {
    const e = entities[id];
    if (!e) continue;
    const slot = slotOf(e);
    // "unavailable" / "unknown" are not numbers and leave the slot empty.
    const value = Number.parseFloat(e.state);
    if (slot && out[slot] === undefined && Number.isFinite(value)) out[slot] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** "68% 偏濕": the value, then its band word; both brighter when the band says to act. */
function reading(text: string, value: number, bands: readonly Band[]): string {
  const { label, warn } = bandOf(value, bands);
  return (
    `<span class="indoor__value${warn ? " indoor__value--warn text-fg" : ""}">${text}</span> ` +
    `<span class="indoor__label${warn ? " indoor__label--warn text-fg" : " text-fg-faint"}">${label}</span>`
  );
}

/** "室內 23.4° · 68% 偏濕  CO₂ 1445 ppm 有點悶  PM2.5 10 普通", only the parts that have a value; "" without readings. */
export function indoorLine(indoor: Indoor | null | undefined, className: string): string {
  if (!indoor) return "";
  const parts: string[] = [];
  const climate: string[] = [];
  if (indoor.temp !== undefined) climate.push(`<span class="indoor__value">${indoor.temp.toFixed(1)}°</span>`);
  if (indoor.humidity !== undefined) {
    climate.push(reading(`${Math.round(indoor.humidity)}%`, indoor.humidity, HUMIDITY_BANDS));
  }
  if (climate.length > 0) parts.push(`室內 ${climate.join(" · ")}`);
  if (indoor.co2 !== undefined) parts.push(`CO₂ ${reading(`${Math.round(indoor.co2)} ppm`, indoor.co2, CO2_BANDS)}`);
  if (indoor.pm25 !== undefined)
    parts.push(`PM2.5 ${reading(String(Math.round(indoor.pm25)), indoor.pm25, PM25_BANDS)}`);
  return `<div class="indoor flex gap-8 text-fg-dim ${className}">${parts.map((p) => `<span>${p}</span>`).join("")}</div>`;
}
