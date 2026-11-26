import { describe, expect, test } from "bun:test";
import type { Entities } from "../src/ha";
import { bandOf, CO2_BANDS, HUMIDITY_BANDS, indoorLine, indoorReadings, PM25_BANDS, slotOf } from "../src/indoor";

const e = (state: string, attributes: Record<string, unknown> = {}) => ({ state, attributes });

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("slotOf", () => {
  test("uses device_class first", () => {
    expect(slotOf(e("1", { device_class: "temperature", unit_of_measurement: "%" }))).toBe("temp");
    expect(slotOf(e("1", { device_class: "humidity" }))).toBe("humidity");
    expect(slotOf(e("1", { device_class: "carbon_dioxide" }))).toBe("co2");
    expect(slotOf(e("1", { device_class: "pm25" }))).toBe("pm25");
  });

  test("falls back to the unit", () => {
    expect(slotOf(e("1", { unit_of_measurement: "°C" }))).toBe("temp");
    expect(slotOf(e("1", { unit_of_measurement: "%" }))).toBe("humidity");
    expect(slotOf(e("1", { unit_of_measurement: "ppm" }))).toBe("co2");
    expect(slotOf(e("1", { unit_of_measurement: "µg/m³" }))).toBe("pm25");
  });

  test("anything else is no slot", () => {
    expect(slotOf(e("1", { device_class: "battery", unit_of_measurement: "W" }))).toBeNull();
    expect(slotOf(e("1"))).toBeNull();
  });
});

describe("indoorReadings", () => {
  const entities: Entities = {
    "sensor.w100_t": e("23.4", { device_class: "temperature" }),
    "sensor.w100_h": e("55", { device_class: "humidity" }),
    "sensor.m8_t": e("25.1", { device_class: "temperature" }),
    "sensor.m8_co2": e("640", { unit_of_measurement: "ppm" }),
    "sensor.m8_pm": e("unavailable", { device_class: "pm25" }),
  };

  test("fills each slot from the first listed entity with a number", () => {
    expect(
      indoorReadings(entities, ["sensor.w100_t", "sensor.m8_t", "sensor.w100_h", "sensor.m8_co2", "sensor.m8_pm"]),
    ).toEqual({
      temp: 23.4,
      humidity: 55,
      co2: 640,
    });
  });

  test("order decides which temperature wins", () => {
    expect(indoorReadings(entities, ["sensor.m8_t", "sensor.w100_t"])?.temp).toBe(25.1);
  });

  test("null without any usable reading", () => {
    expect(indoorReadings(entities, ["sensor.m8_pm", "sensor.missing"])).toBeNull();
    expect(indoorReadings({}, [])).toBeNull();
  });
});

describe("bands", () => {
  const label = (v: number, bands: typeof CO2_BANDS) => bandOf(v, bands).label;

  test("CO2 follows 800 / 1000 / 1500 / 2000 ppm", () => {
    expect([799, 800, 999, 1000, 1445, 1500, 1999, 2000, 5000].map((v) => label(v, CO2_BANDS))).toEqual([
      "清新",
      "還行",
      "還行",
      "有點悶",
      "有點悶",
      "很悶",
      "很悶",
      "該通風",
      "該通風",
    ]);
  });

  test("PM2.5 follows 9 / 35 / 55, on rounded values", () => {
    expect([0, 9, 9.4, 10, 35, 36, 55, 56, 300].map((v) => label(v, PM25_BANDS))).toEqual([
      "乾淨",
      "乾淨",
      "乾淨",
      "普通",
      "普通",
      "偏高",
      "偏高",
      "不健康",
      "不健康",
    ]);
  });

  test("humidity follows 30 / 50 / 60 %", () => {
    expect([20, 30, 50, 51, 60, 61, 68].map((v) => label(v, HUMIDITY_BANDS))).toEqual([
      "乾燥",
      "舒適",
      "舒適",
      "還可以",
      "還可以",
      "偏濕",
      "偏濕",
    ]);
  });

  test("only the bands worth acting on warn", () => {
    expect(CO2_BANDS.filter((b) => b.warn).map((b) => b.label)).toEqual(["有點悶", "很悶", "該通風"]);
    expect(PM25_BANDS.filter((b) => b.warn).map((b) => b.label)).toEqual(["偏高", "不健康"]);
    expect(HUMIDITY_BANDS.filter((b) => b.warn).map((b) => b.label)).toEqual(["乾燥", "偏濕"]);
  });
});

describe("indoorLine", () => {
  test("renders each value with its band word", () => {
    expect(text(indoorLine({ temp: 24.26, humidity: 68.2, co2: 1445, pm25: 10 }, "x"))).toBe(
      "室內 24.3° · 68% 偏濕 CO₂ 1445 ppm 有點悶 PM2.5 10 普通",
    );
    expect(text(indoorLine({ co2: 640 }, "x"))).toBe("CO₂ 640 ppm 清新");
  });

  test("empty without readings", () => {
    expect(indoorLine(null, "x")).toBe("");
    expect(indoorLine(undefined, "x")).toBe("");
  });

  test("brightens the value and word only in a warning band", () => {
    expect(indoorLine({ temp: 22, humidity: 45, co2: 999, pm25: 35 }, "x")).not.toContain("--warn");
    const html = indoorLine({ humidity: 68, co2: 1000, pm25: 36 }, "x");
    expect(html.match(/indoor__value--warn/g)?.length).toBe(3);
    expect(html.match(/indoor__label--warn/g)?.length).toBe(3);
  });
});
