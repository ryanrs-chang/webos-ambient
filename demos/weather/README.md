# Weather demos

Four standalone weather-scene demos, built before any of it went into the app. They are **reference material**: kept
so they can be revisited later, excluded from lint (`biome.json`) and from the build, never imported by `src/`, and not
part of the packaged TV app. `SOURCES.md` lists what each one was inspired by and its licences.

## Running them

No build, no network. Open `index.html` in a desktop browser (double-click it, or `open demos/weather/index.html`);
it links the four demos. Each page is a 1920x1080 stage scaled to the window, with a row of weather buttons, a clock
(HH:MM, no seconds) and an FPS / JS-time meter in the corner.

| Input | Does |
| --- | --- |
| `1`-`8` | Pick a weather: clear day, clear night, partly cloudy, overcast, rain, storm, snow, fog |
| Left / Right | Previous / next weather |
| `H` | Hide the buttons, the FPS meter and the hint |
| `?k=rain` (or `#rain`) | Start on one weather (`clear-day`, `clear-night`, `partly`, `overcast`, `rain`, `storm`, `snow`, `fog`) |
| `?clean` | Start with the UI hidden |
| `?h=14` (v4 only) | Pin the hour of day the sun or moon sits at, instead of the real time |

## What each one is

| Demo | What it is | Status |
| --- | --- | --- |
| `v1-cinematic.html` | Full-screen canvas scene behind a big clock: rain in three depth layers with ground splashes, layered drifting clouds, swaying fog bands, three-layer snow with wind gusts, twinkling stars with a dim moon and a shooting star, a soft sun with two counter-rotating ray layers, and a double-pulse lightning flash with a thin bolt. | **Ported** as the 電影感 theme: `src/effects/cinematic.ts` and `src/themes/cinematic.ts`. The demo's timings (a bolt every few seconds) were demo-only; the app uses lightning every 20-60 s and a shooting star every 15-45 s. |
| `v2-icons.html` | A big animated weather icon (Meteocons SVGs, animated with SMIL, no JS) beside a big clock on a near-black background with a very dark breathing tint. The lightest option. | Not used yet; a candidate for a future theme. **OLED caveat:** the icon is a large, lit shape, which fights the app's "no large bright areas" rule; it would need dimming and the periodic relocation to be safe. |
| `v3-window.html` | Rain on glass: refracting drops that trickle and wipe trails over dim city bokeh, frost for snow, mist for fog. The most striking one. | Not used yet; a candidate for a future theme. **CPU cost:** by far the heaviest (it re-bakes the scene, keeps a blurred copy and a wipe canvas, and draws refracted patches per drop), which is a risk on the TV's weak CPU even at its half-resolution canvas. Measure on the TV first. |
| `v4-linework.html` | Thin-stroke (1-2 px) line-art weather under a "sky arc" on which the sun or moon sits at the real hour. Clouds are stroked outlines filled black, so they hide what is behind them. | Not used yet; a candidate for a future theme. **Sparse:** at 3 m the 1-2 px lines look thin and the screen looks empty; it may need heavier strokes. |

## Licences

All page code is original; the only third-party files are the Meteocons SVGs vendored in `vendor/meteocons/` for v2
(MIT, Bas Milius, `vendor/meteocons/LICENSE`). Other sources were read for technique only and nothing was copied. Full
table, including what could and could not be vendored into an MIT repo: [`SOURCES.md`](SOURCES.md).

## Porting a demo into a theme

The checklist from porting v1. The app's rules live in the repo's `CLAUDE.md` (Architecture, OLED rules, Weather
effects, Styling, Reduced motion); this is the order that worked.

1. **Pure core first, with tests.** Put the scene in `src/effects/<name>.ts` as functions with no DOM: a `create...`
   (per `WeatherKind` x daypart) and a `step...` that takes an injected `rng` and `dt` in ms and mutates in place
   (nothing allocated per frame: fixed layers, a fixed pool for things that come and go). Test it in
   `test/<name>.test.ts` with a seeded rng: contents per kind, counts under their caps, alphas under their caps
   (at intensity 1 and below 1), the schedulers' intervals, nothing leaking off screen.
2. **Realistic timings, not the demo's.** Demos fire events every few seconds to look busy. On a TV that is on all day,
   lightning and shooting stars are 15-60 s apart; assert the range.
3. **Keep the alpha caps.** Every layer's alpha is a named cap times the scene's `intensity`; a flash or glow that can
   exceed it needs its own cap and a test. Sprites (clouds, glow, rays, fog) are painted once to offscreen canvases and
   pre-warmed; big soft gradients can be painted at half size.
4. **Thin renderer on `#effects`.** Same contract as `startEffects` (`setWeather(kind, daypart, intensity)`, `stop()`):
   ~30 fps cap, `clampDt`, paused while the page is hidden, a crossfade on a weather change, the design space scaled
   to the canvas. Do not add a second canvas.
5. **One engine at a time.** Add the theme id to `effectPlan` in `src/effects/cinematic.ts` (or generalise it): the
   new engine owns `#effects` while its theme is active, the regular particles and the meteors are off, and every
   other theme gets them back. Stop the idle engine first, because an engine told "none" clears the shared canvas.
6. **Reduced motion and `?freeze=1`.** Decide off or static; for anything bright that stays put, off (burn-in). Ask
   `reducedMotion()` in `src/main.ts`, never `matchMedia`; the dev panel's 強制動畫 must turn it back on.
7. **The dev panel and `?fx=`.** Both go through `shownForecast()` / `applyFxPreview`; nothing extra is needed as long
   as the engine is driven from `syncEffects`.
8. **A content-sized theme.** `src/themes/<name>.ts` renders a column that is only as big as its text (no `fixed`,
   `absolute` or full-screen sizes), because the one-minute zone relocation (`src/burnin.ts`) moves that block around
   the screen. Use the shared helpers (`timeHtml`, `esc`, `deg`, `LOADING`, `weatherClass`) and full Tailwind class
   names (never `text-${x}`). Register it last in `src/themes/index.ts` and add it to `test/themes.test.ts` (time and
   date, loading, stale marker, escaping, the registry order) and to `test/devpanel.test.ts` (one button per theme).
9. **Lint and docs.** `bun test && bunx biome check . && bunx tsc --noEmit -p . && bun run build && bun run check:secrets`;
   update the README themes table, `CLAUDE.md` (theme count, the engine and its caps) and this file's status table.
   Check it by eye with a headless browser at 1920x1080 (reduced motion emulated off) for each weather before the TV.
