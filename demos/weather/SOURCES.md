# Sources and licenses

All page code (`v1`-`v4`, `index.html`) is original and written for this repo; the sources below were read for
techniques and nothing was copied from them. The only third-party files are the Meteocons SVGs in `vendor/meteocons/`.

## Vendored

| Item | Used in | License | Notes |
|---|---|---|---|
| [Meteocons](https://github.com/basmilius/meteocons) by Bas Milius, `@meteocons/svg@3.0.0-next.10` (`fill` style) | v2 | MIT, (c) 2020-present Bas Milius | 9 SVGs in `vendor/meteocons/` (clear-day, clear-night, partly-cloudy-day/night, overcast, rain, thunderstorms-rain, snow, fog) plus `LICENSE`. Animated with SMIL inside the SVG, loaded through `<img>`, so no JS. `partly-cloudy-night.svg` is vendored but not wired up yet. Fetched from the [jsDelivr package listing](https://data.jsdelivr.com/v1/packages/npm/@meteocons/svg@3.0.0-next.10?structure=flat). |

## Inspiration only (nothing copied)

| Source | What it inspired | License (as found) | Usable in an MIT repo? |
|---|---|---|---|
| [SardineFish/raindrop-fx](https://github.com/SardineFish/raindrop-fx) | v3: drops that slip, leave smaller drops behind and refract a blurred background; its WebGL2 approach is too heavy for the TV, so v3 uses 2D canvas | MIT | Yes (code could be vendored; not needed) |
| [Codrops "Rain & Water Effect Experiments"](https://tympanus.net/codrops/?p=25417), [codrops/RainEffect](https://github.com/codrops/RainEffect) (Lucas Bebber) | v3: the look of drops on glass with trails | Codrops license: may build on it for personal/commercial projects, no republishing "as-is" ([terms](http://tympanus.net/codrops/licensing/)) | No for vendoring; fine as reference |
| [rainyday.js](https://github.com/skykain/rainyday.js) | v3: 2D-canvas drops on glass as a concept | GPL-2.0 (this fork's LICENSE link) | No, GPL; concept only |
| [vgerbot-libraries/weather-canvas](https://github.com/vgerbot-libraries/weather-canvas) | v1: which effect layers a canvas weather scene needs (sun, moon, stars, shooting stars, cloud, rain, snow, fog, lightning; wind affecting rain/snow) | MIT, (c) ChienHsinYang | Yes; not vendored |
| [CSS-Tricks: Drawing realistic clouds with SVG and CSS](https://css-tricks.com/drawing-realistic-clouds-with-svg-and-css), [LogRocket animated cloud generator](https://blog.logrocket.com/build-animated-cloud-generator-svg-css) | v1: layering several cloud sprites of different size/shade for depth (done here with pre-painted canvas sprites instead of feTurbulence filters, which are too slow on a weak CPU) | Article text; no code used | n/a |
| [DEV: starfield + shooting stars on canvas](https://dev.to/usman_awan/how-i-built-a-grok-inspired-starfield-shooting-stars-using-html-canvas-3872), [csswitch: canvas starfield](https://csswitch.github.io/jekyll-galaxy-theme/2024/01/22/canvas-starfield-tutorial/) | v1/v4: per-star twinkle phase, depth-dependent drift, rare shooting stars | Tutorials; no code used | n/a |
| [amCharts free animated SVG weather icons](https://www.amcharts.com/free-animated-svg-weather-icons/) | v2: alternative icon set considered (23 icons, animated with CSS) | CC BY 4.0, credit amCharts required | Yes with attribution; not used (Meteocons is MIT and has more variants) |
| [Skycons on cdnjs](https://cdnjs.com/libraries/skycons/0) | considered for v2 | listed as public domain (not verified) | Not evaluated |
| Lottie weather icons | considered for v2 | per-animation, varies; Meteocons also ships Lottie JSON | Not used: lottie-web adds a runtime and CPU cost on the TV |

## Techniques per version

- **v1 Cinematic**: three rain depth layers (length, speed, alpha, ground line per layer) with splashes only on the nearer ones; clouds painted once to offscreen sprites (overlapping soft puffs, flat base, darker underside); fog as wide pre-painted bands that sway instead of wrapping; gust level from a product of slow sines drives rain slant and snow drift; lightning is a double pulse capped at 10% alpha plus a thin bolt.
- **v2 Animated icons**: Meteocons through `<img>` (SMIL runs in the SVG), cross-fade between two `<img>`; opacity 0.5 dims the icon instead of a CSS filter (compositor only).
- **v3 Window**: scene "outside" baked every 0.5 s; a 1/4-resolution copy is the frosted glass; drops wipe the glass (a "reveal" canvas that mists over again); each drop is a cached flipped, magnified patch of the sharp scene with a rim and a highlight; the canvas renders at 960x540 and is scaled 2x.
- **v4 Linework**: 1-2 px strokes only; cloud outline = union of circles stroked then filled black, so clouds occlude what is behind them; the sun/moon sits on the arc at the real hour (`?h=` overrides).
