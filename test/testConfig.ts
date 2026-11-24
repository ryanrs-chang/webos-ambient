import { defaultConfig } from "../src/config";

/**
 * The config tests render with. The place and zone are fixed here so no test depends on config.local.json or on
 * the example values: the fixture's "current" hour is 18:00 in Asia/Taipei.
 */
export const testConfig = { ...defaultConfig, place: "Testville", timeZone: "Asia/Taipei" };
