import { describe, expect, test } from "bun:test";
import { applyKey, DEFAULT_BRIGHTNESS, KEY, loadPrefs, PREFS_KEY, savePrefs } from "../src/controls";
import { themes } from "../src/themes";

const COUNT = themes.length;
const prefs = (themeIndex: number, brightness: number) => ({ themeIndex, brightness });

describe("applyKey theme", () => {
  test("RIGHT moves to the next theme and names it", () => {
    const r = applyKey(prefs(0, 0.7), KEY.RIGHT, COUNT);
    expect(r).toEqual({ prefs: prefs(1, 0.7), hint: themes[1].name });
  });

  test("LEFT wraps from the first theme to the last", () => {
    const r = applyKey(prefs(0, 0.7), KEY.LEFT, COUNT);
    expect(r?.prefs.themeIndex).toBe(COUNT - 1);
    expect(r?.hint).toBe(themes[COUNT - 1].name);
  });

  test("RIGHT wraps from the last theme to the first", () => {
    expect(applyKey(prefs(COUNT - 1, 0.7), KEY.RIGHT, COUNT)?.prefs.themeIndex).toBe(0);
  });
});

describe("applyKey brightness", () => {
  const cases: [string, number, number, number, string][] = [
    ["UP raises by a tenth", KEY.UP, 0.7, 0.8, "亮度 80%"],
    ["DOWN lowers by a tenth", KEY.DOWN, 0.7, 0.6, "亮度 60%"],
    ["float drift is rounded away (0.7+0.1)", KEY.UP, 0.7, 0.8, "亮度 80%"],
    ["UP clamps at 1.0", KEY.UP, 1.0, 1.0, "亮度 100%"],
    ["DOWN clamps at 0.3", KEY.DOWN, 0.3, 0.3, "亮度 30%"],
    ["DOWN from 0.4 reaches the floor", KEY.DOWN, 0.4, 0.3, "亮度 30%"],
    ["UP from 0.9 reaches the ceiling", KEY.UP, 0.9, 1.0, "亮度 100%"],
  ];
  for (const [name, key, from, to, hint] of cases) {
    test(name, () => {
      const r = applyKey(prefs(2, from), key, COUNT);
      expect(r).toEqual({ prefs: prefs(2, to), hint });
    });
  }

  test("an out-of-range stored value is pulled back into range", () => {
    expect(applyKey(prefs(0, 5), KEY.DOWN, COUNT)?.prefs.brightness).toBe(1.0);
  });
});

describe("applyKey ENTER and others", () => {
  test("ENTER shows the current theme and changes nothing", () => {
    const p = prefs(2, 0.5);
    expect(applyKey(p, KEY.ENTER, COUNT)).toEqual({ prefs: p, hint: themes[2].name });
  });

  test("an unhandled key returns null", () => {
    expect(applyKey(prefs(0, 0.7), 65, COUNT)).toBeNull();
  });

  test("does not mutate the input prefs", () => {
    const p = prefs(0, 0.7);
    applyKey(p, KEY.RIGHT, COUNT);
    expect(p).toEqual(prefs(0, 0.7));
  });
});

const store = (value: string | null) => ({ getItem: (k: string) => (k === PREFS_KEY ? value : null) });

describe("loadPrefs", () => {
  test("uses the key ambient.prefs", () => {
    expect(PREFS_KEY).toBe("ambient.prefs");
  });

  test("reads saved prefs", () => {
    expect(loadPrefs(store('{"themeIndex":2,"brightness":0.5}'), 0, COUNT)).toEqual(prefs(2, 0.5));
  });

  test("nothing saved → fallback theme, default brightness", () => {
    expect(loadPrefs(store(null), 1, COUNT)).toEqual(prefs(1, DEFAULT_BRIGHTNESS));
    expect(DEFAULT_BRIGHTNESS).toBe(0.7);
  });

  const garbage: [string, string][] = [
    ["not JSON", "{oops"],
    ["a JSON string", '"hi"'],
    ["null", "null"],
    ["an array", "[1,2]"],
    ["wrong field types", '{"themeIndex":"2","brightness":"x"}'],
  ];
  for (const [name, raw] of garbage) {
    test(`garbage (${name}) → defaults`, () => {
      expect(loadPrefs(store(raw), 3, COUNT)).toEqual(prefs(3, DEFAULT_BRIGHTNESS));
    });
  }

  test("out-of-range theme falls back, brightness is clamped", () => {
    expect(loadPrefs(store('{"themeIndex":99,"brightness":9}'), 1, COUNT)).toEqual(prefs(1, 1.0));
    expect(loadPrefs(store('{"themeIndex":-1,"brightness":0}'), 1, COUNT)).toEqual(prefs(1, 0.3));
    expect(loadPrefs(store('{"themeIndex":1.5,"brightness":0.5}'), 0, COUNT).themeIndex).toBe(0);
  });

  test("a partial object keeps the valid field", () => {
    expect(loadPrefs(store('{"brightness":0.4}'), 2, COUNT)).toEqual(prefs(2, 0.4));
  });

  test("a storage that throws is tolerated", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadPrefs(throwing, 1, COUNT)).toEqual(prefs(1, DEFAULT_BRIGHTNESS));
  });
});

describe("savePrefs", () => {
  test("round-trips through loadPrefs", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    savePrefs(storage, prefs(3, 0.4));
    expect(mem.has(PREFS_KEY)).toBe(true);
    expect(loadPrefs(storage, 0, COUNT)).toEqual(prefs(3, 0.4));
  });

  test("a storage that throws is tolerated", () => {
    const throwing = {
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => savePrefs(throwing, prefs(0, 0.7))).not.toThrow();
  });
});
