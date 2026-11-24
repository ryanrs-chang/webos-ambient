# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Packaged LG webOS TV web app (clock + weather, always on, OLED). Bun + TypeScript, bundled to one script. No framework: themes are template strings rendered into the DOM. Target engine: webOS 26 (Chromium ≥ 120), weak CPU.

## Commands

- `bun test` — unit tests (`test/`); one file: `bun test test/burnin.test.ts`; one test by name: `bun test -t "every 9 consecutive draws"`
- Before calling a change done: `bun test && bunx biome check . && bunx tsc --noEmit -p . && bun run build`
- `bunx biome check .` (`bun run lint`; `bun run format` to fix) and `bunx tsc --noEmit -p .`
- `bun run setup` — writes `config.local.json` (interactive, or `--place/--lat/--lon/--tz` flags); `bun run check:secrets` — the leak guard (see Personal values)
- `bun run build` — `build:css` (Tailwind, `src/tailwind.css` → `app/style.css`, minified) then `build:js` (`scripts/build-js.ts`: `src/main.ts` → `app/main.js`, with the validated user config inlined as `__USER_CONFIG__`). Both outputs are generated and gitignored; `package` runs `build` first.
- `bun run dev` — build, then serve `app/` on :5173 and run the Tailwind watcher (`scripts/dev.ts`); `/fixture.json` is `test/fixtures/forecast.json`. `app/main.js` is built once: re-run `build:js` after editing a `.ts` file.
- `bun run package` / `install:tv` / `launch:tv` — see README
- `bun run icons` — regenerate `app/icon.png`, `app/largeIcon.png` from `assets/icon.svg` (needs `rsvg-convert`)

## Architecture

`src/main.ts` is the only DOM wiring; everything it calls is a pure, tested module. The runtime loop:

1. Startup: `defaultConfig` (`src/config.ts`, personal values inlined at build time) + launch params (`window.PalmSystem.launchParams` on the TV, the query string in dev) + persisted prefs (`src/controls.ts`, localStorage) decide the theme and brightness.
2. Data: `refreshForecast` fetches Open-Meteo via `src/weather.ts` every `refreshMinutes`; on failure it keeps the last forecast, marks it `stale` and retries in 60 s.
3. Render: `render()` builds a `ViewState` (`src/themes/types.ts`) and replaces `#content.innerHTML` with `themes[i].render(state)` — on start, every minute boundary (`tickMinute`), forecast change and theme switch. Because the DOM is rebuilt, continuity is restored after each render: `syncLoops` re-phases infinite CSS animations, the digit roll is driven by diffing against the previous time (`src/anim.ts`), then `syncBackdrop`/`syncEffects` update the layers below.
4. Motion: `float()` every second and `relocate()` every few minutes move `#stage` (burn-in, below); `startEffects`/`startMeteors`/`startShimmer` run independently of renders.
5. Input: remote keys (`keydown`, webOS keyCodes) and the `webOSRelaunch` event go through `applyKey` → `commit()`; the dev panel (`src/devpanel.ts`, localhost only) calls the same path.

DOM layers, back to front (`app/index.html`): `#backdrop` (ambient tint) → `canvas#effects` (weather particles) → `#meteors` → `#stage > #fade > #content` (the moving theme content) → `#hint`.

## file:// constraints

Packaged apps load from `file://`:

- The bundle is a classic IIFE script (`--format iife`), not an ES module; `index.html` uses a plain `<script src>`.
- Config is bundled (`src/config.ts`, personal values injected by `scripts/build-js.ts`); never fetch a local file at runtime.
- Only the forecast API is fetched over the network.

## Personal values

The repo is public. Personal values (place, latitude, longitude, time zone, later the Home Assistant URL) come only from `config.local.json` (gitignored, written by `bun run setup`), never from committed source, tests, fixtures or docs. `config.example.json` holds neutral placeholders; `src/config.ts` holds only non-sensitive tuning. Tests use `test/testConfig.ts` and never read `config.local.json`. A new user-settable key goes in `config.example.json`, `src/userConfig.ts` (`parseUserConfig`, with a test) and `scripts/setupArgs.ts`. `test/leakGuard.test.ts` fails if a value from `config.local.json` shows up in a committable file; do not weaken it.

## OLED rules

- Pure black background, thin gray text, no large bright areas (ambient tints stay under `#1a2333`).
- No seconds; the display changes once a minute.
- The content block is always moving and visits the whole screen (`src/burnin.ts`, applied in `src/main.ts`). Its position is `floatMargin + zone anchor + a slow drift`: `float()` runs every second, drifting +-60 px around the anchor with `anchoredPosition` (reuses `floatPosition`, clamped into `floatRange`). Every `relocateMinutes` (3), at `relocateOffsetSec` (:30, never the :00 digit roll) past the minute, `relocate()` fades `#fade` out over `relocateFadeMs` (1200), jumps (no transform transition) to a point in the next zone of a shuffled 3x3 bag (`zoneBag`/`nextZone`/`zoneTarget`: every region once per 9 relocations, never the same twice in a row), and fades back in. The anchor is stored as a fraction of the float range so a theme of another size keeps its zone. Reduced motion still relocates, without the fade. Speed, margin and the three relocate settings are in `src/config.ts`. Themes must stay content-sized with real room to move (forecast is 1450 px wide). Do not add static elements outside `#stage`, other than `#hint` (shows for 2 s), `#meteors` (empty except for one moving, dim meteor at a time) and `#backdrop` (the ambient tint: a fixed full-screen layer, very dark, set from the theme's `data-kind`/`data-daypart`, ambient theme only).
- Opacity layers, so nothing fights: `#stage` carries `--dim` (brightness), `#fade` carries the relocation fade (`.relocating`), `#content` carries the theme-switch animations. Never put two of these on one element.

Weather effects (all four themes): `src/effects/particles.ts` has a pure, tested simulation core (`createScene`/`stepScene`, injected rng, per-particle `shape`) and a thin canvas renderer (`startEffects`, `#effects` between `#backdrop` and `#stage`). `syncEffects` in `src/main.ts` runs the effect for the forecast's kind/daypart in every theme and `none` only without a forecast; `?fx=` forces one. `intensity` (a parameter of `createScene` and `setWeather`, from `effectIntensity(themeId)`) multiplies every alpha and the flash: ambient 1, the black themes (minimal, forecast, analog) `BLACK_THEME_INTENSITY` = 0.6. Dimness rule: per-kind alpha caps in `MAX_ALPHA` (rain/storm 0.25, snow 0.35, night stars 0.5, day rays 0.06, clouds 0.07, fog 0.1) times intensity, storm flash at most 8% (times intensity) for 300 ms every 20-60 s, particle caps in `MAX_PARTICLES`, nothing static, about 30 fps, dt clamped, paused while hidden; the canvas also gets `opacity: var(--dim)`. Partly cloudy is its own scene: a few cloud blobs plus light rays by day, or about 40 stars plus blobs by night (cloudy is blobs only). Any new effect must stay inside those limits; add a test for its cap and alpha, including at intensity < 1.

Fancy effects (Magic UI-inspired, pure CSS keyframes on transform/opacity; blur only on the `#content` entrance and the `#fade` fade-in after a relocation): (1) meteors, `src/effects/meteors.ts` (pure: `meteorsActive` = clear/partly + night, `nextMeteorDelayMs` 8-25 s, `createMeteor` start in the top/right edge band and end on screen, travel 600-900 px, head alpha at most `METEOR_MAX_ALPHA` 0.35 x intensity) plus `startMeteors`, which creates one `.meteor` element on `#meteors` (fixed, between `#effects` and `#stage`, outside the float) per meteor and removes it on `animationend`; (2) shimmer, `src/effects/shimmer.ts` (pure `nextShimmerDelayMs` 20-60 s; `startShimmer` adds `.shimmer--run` to whatever `.shimmer` elements `#content` holds at that moment, so the per-minute `innerHTML` rebuild is harmless; the element must hug its text, `w-fit`, because it clips the sweep); (3) orbit dots, `orbit` in `src/icons.ts` on the big weather icon only (never the hourly strip, never ambient): three `.wx-orbit` groups of 18/24/30 s infinite rotations, which `syncLoops` already re-syncs because they have infinite iterations; (4) blur-fade, `theme-in-blur` and `#fade.blur-in`. Alpha caps: meteor head 0.35, shimmer peak 0.25, dot 0.4, each asserted by a test (`test/meteors.test.ts`, `test/style.test.ts`). Each is switched off under reduced motion by a scoped rule (`#meteors`, `.shimmer--run::after`, `.wx-orbit`, `#fade.blur-in`, `#content.is-entering`) and meteors/shimmer also by JS (`reducedMotion()`, `freeze.frozen`); `?freeze=1` hides `#meteors`. The dev panel's 特效 checkboxes (`FancyFlags` in `src/devpanel.ts`, persisted) switch each off in dev; the TV always has all four. A new meteor-like decoration must stay under these caps and ship with a reduced-motion rule.

## Layout

- Pure logic with tests: `src/controls.ts`, `src/clock.ts`, `src/burnin.ts` (float, zones, relocation timing), `src/config.ts`, `src/weather.ts`, `src/anim.ts` (digit roll helpers; `syncLoops` is DOM), `src/effects/particles.ts` (core half), `src/effects/meteors.ts` and `src/effects/shimmer.ts` (scheduling and geometry; their `start*` functions are DOM), `src/themes/*`.
- DOM wiring only, untested: `src/main.ts`. Put anything testable in a pure module.
- Each theme's class names are defined in `src/themes/*`; every utility they use must exist in the built stylesheet (`test/utilities.test.ts`) and every hook class that needs CSS must be styled in `src/styles/`.
- `src/freeze.ts` (pure, tested): the dev-only `?freeze=1` / `?now=` parameters, see README "Freeze". Use them for any screenshot comparison; they are never active from `file://`.

## Styling (Tailwind CSS v4)

`app/style.css` is generated; never edit it. Source: `src/tailwind.css` (entry, layer order `theme < base < components < utilities`, no preflight), `src/styles/theme.css` (`@theme` tokens: `text-fg`, `text-fg-dim`, `text-fg-faint`, `border-line`, `bg-accent`, `font-sans`, `text-tv-30`..`text-tv-300`, `--spacing: 4px`), `base.css`, and the hand-written CSS in `stage.css`, `components.css`, `motion.css`, `dev.css` (all in the `components` layer, so a utility always overrides them).

- Static layout, type size and colour go in the markup as utilities (themes, `app/index.html`, dev panel). Keep the BEM class on the element as a hook.
- Keep as hand-written CSS: burn-in/float (`#stage`, `#fade`, `#backdrop`, `#effects`: JS sets their transform/opacity), the digit roll, colon, icon animations, theme-switch and forecast-entrance animations, the analog hand sweep, pseudo-elements (`.t-forecast__pop::after`, `.digit--changed::before`), the forecast grid areas, and the reduced-motion block.
- Never build a class name from parts (`text-${x}`, `gap-${n}`): Tailwind only sees full literal names in `src/**/*.ts` and `app/index.html`. Use full names or a lookup table of them (`LINE_SIZES` in `src/themes/minimal.ts`). `test/utilities.test.ts` catches both a missing utility and an interpolated name.
- Layer trap: an unlayered rule beats every layer, so never write unlayered CSS; and a state class toggled from JS (`.show`, `.is-active`) must beat the utility it overrides by specificity (`[&.show]:opacity-100`), not by order.
- To change how a theme looks without moving a pixel unintentionally, compare before/after with `?freeze=1` screenshots (README).

## Tooling note

`patches/fstream@1.0.12.patch` (via `patchedDependencies`) adapts fstream to the promise-based mkdirp 3 that `@webos-tools/cli` pulls in; without it `ares-package` fails with "mkdir is not a function". Drop the patch if the CLI fixes this.

## Reduced motion

Every rule inside `@media (prefers-reduced-motion: reduce)` in `src/styles/*.css` (it lives in `motion.css`) must have selectors starting with `html:not(.force-motion)` (checked by `test/style.test.ts`), and JS asks `reducedMotion()` in `src/main.ts` (backed by `isReducedMotion` in `src/devpanel.ts`), never `matchMedia` directly. That is what the dev panel's 強制動畫 toggle (`html.force-motion`) switches off; the TV never sets the class.
