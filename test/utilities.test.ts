import { describe, expect, test } from "bun:test";
import { themes } from "../src/themes/index";
import type { ViewState } from "../src/themes/types";
import { parseForecast } from "../src/weather";
import raw from "./fixtures/forecast.json";
import { testConfig } from "./testConfig";

// Tailwind only emits a utility whose full class name it finds in the scanned files, so a class built at runtime
// (`text-${x}`) silently has no CSS. This builds the real stylesheet and checks every utility the themes render.

const root = new URL("..", import.meta.url).pathname;
const NOW = new Date(Date.UTC(2026, 10, 24, 10, 0));
const fc = parseForecast(raw, NOW);

const built = Bun.spawnSync([`${root}node_modules/.bin/tailwindcss`, "-i", `${root}src/tailwind.css`, "-o", "-"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
const css = built.stdout.toString();

/** Class names that are hooks (tests, hand-written CSS, JS state), not utilities. */
const HOOK = /^(t-|wx|weather|digit|colon|devpanel|is-|shimmer|stale|show$)/;

const escapeSelector = (c: string) => c.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

const states: [string, Partial<ViewState>][] = [
  ["with a forecast", {}],
  ["stale", { stale: true }],
  ["loading", { forecast: null }],
  ["entering, rolling digits", { anim: { prevTime: "17:59", enter: true } }],
];

describe("utility classes in the theme markup", () => {
  test("the stylesheet builds", () => {
    expect(built.exitCode).toBe(0);
    expect(css).toContain("@layer utilities");
  });

  describe.each(themes.map((t) => [t.id, t] as const))("%s", (_id, theme) => {
    test.each(states)("every utility rendered %s exists in the stylesheet", (_name, over) => {
      const html = theme.render({ now: NOW, forecast: fc, stale: false, config: testConfig, ...over });
      const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
      const utilities = [...classes].filter((c) => !HOOK.test(c));
      expect(utilities.length).toBeGreaterThan(0);
      const missing = utilities.filter((c) => !css.includes(`.${escapeSelector(c)}`));
      expect(missing).toEqual([]);
    });
  });

  test("no template literal builds a utility name from parts, as in text-<expression>", async () => {
    const files = [...new Bun.Glob("**/*.ts").scanSync(`${root}src`)];
    const texts = await Promise.all(files.map((f) => Bun.file(`${root}src/${f}`).text()));
    const dynamic = texts.flatMap((t) => t.match(/[a-z0-9\]]-\$\{/g) ?? []);
    expect(dynamic).toEqual([]);
  });
});
