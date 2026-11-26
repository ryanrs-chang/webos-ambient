import { syncLoops } from "./anim";
import {
  floatRange,
  nextRelocationDelayMs,
  nextZone,
  type Offset,
  stagePosition,
  type ZoneState,
  zoneTarget,
} from "./burnin";
import { formatTime, msToNextMinute } from "./clock";
import { defaultConfig, parseLaunchParams } from "./config";
import { applyKey, KEY, type KeyResult, loadPrefs, type Prefs, savePrefs } from "./controls";
import {
  applyFxPreview,
  type DevPanel,
  FANCY_ALL_ON,
  type FancyFlags,
  type FxOverride,
  isDevMode,
  isReducedMotion,
  mountDevPanel,
  parseFx,
  readFancy,
  readForceMotion,
  writeFancy,
  writeForceMotion,
} from "./devpanel";
import { effectPlan, startCinematic } from "./effects/cinematic";
import { startMeteors } from "./effects/meteors";
import { type Daypart, type EffectKind, effectIntensity, startEffects } from "./effects/particles";
import { startShimmer } from "./effects/shimmer";
import { parseFreeze } from "./freeze";
import { browserSocket, type Entities, startHa } from "./ha";
import { type Indoor, indoorReadings } from "./indoor";
import { type BridgeHost, startKeepAwake } from "./keepAwake";
import { themeIndex, themes } from "./themes";
import { describeWeather, type Forecast, fetchForecast } from "./weather";

declare global {
  interface Window {
    /** Present only inside the webOS app container. */
    PalmSystem?: { launchParams?: string };
  }
}

const HINT_MS = 2000;
const RETRY_MS = 60_000;
/** Theme switch: the old content fades out for this long, then the new one blur-fades in (CSS .is-entering). */
const LEAVE_MS = 250;
const ENTER_MS = 500;

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

const stage = byId("stage");
const fade = byId("fade");
const content = byId("content");
const backdrop = byId("backdrop");
const hint = byId("hint");
const effectsCanvas = byId("effects") as HTMLCanvasElement;
effectsCanvas.width = window.innerWidth;
effectsCanvas.height = window.innerHeight;
const effects = startEffects(effectsCanvas);
// The cinematic theme draws on the same canvas instead of `effects`; see syncEffects (one engine at a time).
const cinematicFx = startCinematic(effectsCanvas);
const meteorsLayer = byId("meteors");

const launch = parseLaunchParams(window.PalmSystem?.launchParams, location.search);
const config = { ...defaultConfig, weatherUrl: launch.weatherUrl ?? defaultConfig.weatherUrl };

/** Dev only (?freeze=1, ?now=): a deterministic page for screenshots, see src/freeze.ts. Off on the TV. */
const freeze = parseFreeze(location.protocol, location.search);
if (freeze.frozen) document.documentElement.classList.add("freeze");
const clockNow = (): Date => freeze.now ?? new Date();

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = storage();
let prefs: Prefs = loadPrefs(store ?? { getItem: () => null }, themeIndex(config.defaultTheme, themes[0].id));
// An explicit theme from the launch parameters beats the saved preference.
prefs = { ...prefs, themeIndex: themeIndex(launch.theme, themes[prefs.themeIndex].id) };

let forecast: Forecast | null = null;
let stale = false;
/** Latest Home Assistant indoor readings; drawn on the next render, not on every push (the display changes once a minute). */
let indoor: Indoor | null = null;
/** Where in the free range the block sits, as a fraction of each axis, so a theme of another size keeps its zone. */
let anchorFrac: Offset | null = null;
let zones: ZoneState = { bag: [], last: null };
let relocateTimer: ReturnType<typeof setTimeout> | undefined;
let relocateJumpTimer: ReturnType<typeof setTimeout> | undefined;
let blurInTimer: ReturnType<typeof setTimeout> | undefined;

/** The time drawn by the last render; null before the first one and after a theme switch (so no digit roll). */
let lastTime: string | null = null;
/** Set on launch and on every theme change; the next render with a forecast plays the strip entrance, once. */
let enterPending = true;
/** True from a theme change until the new theme is drawn; minute/forecast renders wait so they do not interrupt it. */
let switching = false;
let switchTimer: ReturnType<typeof setTimeout> | undefined;
let enterTimer: ReturnType<typeof setTimeout> | undefined;

/** Dev panel "force motion": html.force-motion makes CSS (see src/styles/motion.css) and this check ignore the OS setting. */
const reducedMotion = (): boolean =>
  isReducedMotion(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    document.documentElement.classList.contains("force-motion"),
  );

/**
 * The four "fancy" effects (README, "Fancy effects"). The TV always runs all of them; the dev panel can switch each
 * off. Meteors and shimmer ask `fancy` when one is due; the orbit dots and the blur-fade are CSS, switched by a class.
 */
let fancy: FancyFlags = FANCY_ALL_ON;
function applyFancy(flags: FancyFlags): void {
  fancy = flags;
  document.documentElement.classList.toggle("no-orbit", !flags.orbit);
  document.documentElement.classList.toggle("no-blur-fade", !flags.blurFade);
}

/** Meteors and shimmer are decoration: not under reduced motion, not in ?freeze=1 screenshots. */
const meteors = startMeteors(meteorsLayer, () => fancy.meteors && !reducedMotion() && !freeze.frozen);
startShimmer(content, () => fancy.shimmer && !reducedMotion() && !freeze.frozen);
// Veto the TV's idle screen saver (it hands over to Always Ready) for at most an hour after start or the last
// remote key; a no-op outside webOS.
const keepAwake = startKeepAwake(window as unknown as BridgeHost);

/**
 * Burn-in protection: the stage sits still at a zone anchor (see relocate), on whole pixels. Called at start,
 * after every render (themes differ in size, so the range is measured again) and on each relocation jump. There
 * is no transition on #stage: it only ever changes position while #fade is invisible.
 */
function placeStage(): void {
  const range = currentRange();
  if (anchorFrac === null) pickAnchor(range);
  if (freeze.frozen) anchorFrac = { x: 0, y: 0 };
  const { x, y } = stagePosition(anchorFrac ?? { x: 0, y: 0 }, range, config.floatMarginPx);
  stage.style.transform = `translate(${x}px, ${y}px)`;
}

/** Next zone from the shuffled bag, and a random point in it. */
function pickAnchor(range: Offset): void {
  const next = nextZone(zones, Math.random);
  zones = next.state;
  const target = zoneTarget(next.zone, range, Math.random);
  anchorFrac = { x: range.x > 0 ? target.x / range.x : 0, y: range.y > 0 ? target.y / range.y : 0 };
}

function currentRange(): Offset {
  return floatRange(
    { w: window.innerWidth, h: window.innerHeight },
    { w: content.offsetWidth, h: content.offsetHeight },
    config.floatMarginPx,
  );
}

/**
 * Burn-in protection: every minute (at :30 past the minute, away from the :00 digit roll) the block fades
 * out, jumps to another zone while invisible, and fades back in. The fade is on #fade, its own layer, so it
 * does not touch #stage's --dim opacity or #content's theme-switch animations. Reduced motion relocates at once.
 */
function relocate(): void {
  scheduleRelocation();
  clearTimeout(relocateJumpTimer);
  const move = () => {
    pickAnchor(currentRange());
    placeStage();
  };
  if (reducedMotion()) {
    move();
    fade.classList.remove("relocating");
    return;
  }
  fade.style.transitionDuration = `${config.relocateFadeMs}ms`;
  fade.classList.add("relocating");
  relocateJumpTimer = setTimeout(() => {
    move();
    fade.classList.remove("relocating");
    blurIn();
  }, config.relocateFadeMs);
}

/** The fade back in after the jump also clears a blur (CSS #fade.blur-in); restarts it if one is still running. */
function blurIn(): void {
  clearTimeout(blurInTimer);
  fade.style.animationDuration = `${config.relocateFadeMs}ms`;
  fade.classList.remove("blur-in");
  void fade.offsetWidth;
  fade.classList.add("blur-in");
  blurInTimer = setTimeout(() => fade.classList.remove("blur-in"), config.relocateFadeMs + 100);
}

function scheduleRelocation(): void {
  if (freeze.frozen) return;
  clearTimeout(relocateTimer);
  relocateTimer = setTimeout(
    relocate,
    nextRelocationDelayMs(Date.now(), config.relocateMinutes * 60_000, config.relocateOffsetSec * 1000),
  );
}

/** The ambient tint lives on a fixed full-screen layer so it does not move with the content. */
function syncBackdrop(): void {
  const tinted = content.querySelector<HTMLElement>("[data-kind][data-daypart]");
  if (tinted) {
    backdrop.dataset.kind = tinted.dataset.kind;
    backdrop.dataset.daypart = tinted.dataset.daypart;
  } else {
    delete backdrop.dataset.kind;
    delete backdrop.dataset.daypart;
  }
}

/** Dev override: ?fx=rain|snow|storm|cloudy|partly|fog|clear-day|clear-night forces the effect (the dev panel changes it at runtime). */
const initialFx = new URLSearchParams(location.search).get("fx");
let fxValue: string | null = initialFx;
let fxOverride: FxOverride | null = parseFx(fxValue);

/** What the themes and effects draw: the forecast, or with a dev weather override its preview (see applyFxPreview). */
function shownForecast(): Forecast | null {
  return forecast && fxOverride ? applyFxPreview(forecast, fxValue) : forecast;
}

/**
 * The effect follows the forecast in every theme (dimmer on the black ones, see effectIntensity); none until
 * there is a forecast. Only the backdrop tint stays ambient-only. Exactly one engine draws on #effects
 * (effectPlan): the cinematic theme's scene (src/effects/cinematic.ts) or the regular particles, never both, and
 * the meteors only with the particles. An engine told "none" clears the canvas, so the idle one is stopped
 * first. The cinematic scene is off under reduced motion and in ?freeze=1, not frozen on one frame.
 */
function syncEffects(): void {
  const themeId = themes[prefs.themeIndex].id;
  const intensity = effectIntensity(themeId);
  const plan = effectPlan(themeId, reducedMotion() || freeze.frozen);
  const shown = shownForecast();
  let kind: EffectKind = "none";
  let daypart: Daypart = "night";
  if (shown) {
    kind = describeWeather(shown.current.code).kind;
    daypart = shown.current.isDay ? "day" : "night";
  } else if (fxOverride) {
    ({ kind, daypart } = fxOverride);
  }
  if (plan.engine !== "particles") effects.setWeather("none", "night");
  if (plan.engine !== "cinematic") cinematicFx.setWeather("none", "night");
  if (plan.engine === "particles") effects.setWeather(kind, daypart, intensity);
  if (plan.engine === "cinematic") cinematicFx.setWeather(kind, daypart, intensity);
  if (plan.meteors) meteors.setWeather(kind, daypart, intensity);
  else meteors.setWeather("none", "night");
}

function render(force = false): void {
  // The next minute/forecast render draws the same prefs anyway, so skipping during a theme switch loses nothing.
  if (switching && !force) return;
  const now = clockNow();
  const time = formatTime(now, config.timeZone);
  const enter = enterPending && forecast !== null;
  if (enter) enterPending = false;
  content.innerHTML = themes[prefs.themeIndex].render({
    now,
    forecast: shownForecast(),
    stale,
    config,
    indoor,
    anim: { prevTime: lastTime, enter },
  });
  lastTime = time;
  // innerHTML restarted every looping animation; put them back on their old phase.
  if (!freeze.frozen) syncLoops(content);
  document.documentElement.style.setProperty("--dim", String(prefs.brightness));
  syncBackdrop();
  syncEffects();
  placeStage();
}

/**
 * Theme changed: fade the old content out, draw the new one (placeStage() measures it inside render, after it is
 * in), fade it in. Reduced motion skips straight to the new theme.
 */
function switchTheme(): void {
  clearTimeout(switchTimer);
  clearTimeout(enterTimer);
  lastTime = null;
  enterPending = true;
  if (reducedMotion()) {
    render(true);
    return;
  }
  switching = true;
  content.classList.remove("is-entering");
  content.classList.add("is-leaving");
  switchTimer = setTimeout(() => {
    switching = false;
    content.classList.remove("is-leaving");
    render(true);
    content.classList.add("is-entering");
    enterTimer = setTimeout(() => content.classList.remove("is-entering"), ENTER_MS + 50);
  }, LEAVE_MS);
}

function tickMinute(): void {
  render();
  setTimeout(tickMinute, msToNextMinute(new Date()));
}

async function refreshForecast(): Promise<void> {
  let delay = config.refreshMinutes * 60_000;
  try {
    forecast = await fetchForecast(config, clockNow());
    stale = false;
  } catch {
    // Keep showing the previous forecast, marked stale, and try again soon.
    stale = true;
    delay = RETRY_MS;
  }
  render();
  setTimeout(refreshForecast, delay);
}

let hintTimer: ReturnType<typeof setTimeout> | undefined;
function showHint(text: string): void {
  hint.textContent = text;
  hint.classList.add("show");
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hint.classList.remove("show"), HINT_MS);
}

let devPanel: DevPanel | null = null;

/** The one path for a prefs change, whether it came from a remote key or the dev panel. */
function commit(result: KeyResult): void {
  const themeChanged = result.prefs.themeIndex !== prefs.themeIndex;
  prefs = result.prefs;
  if (store) savePrefs(store, prefs);
  if (themeChanged) switchTheme();
  else render();
  if (result.hint) showHint(result.hint);
  devPanel?.update(prefs);
}

document.addEventListener("keydown", (event) => {
  keepAwake?.poke();
  const result = applyKey(prefs, event.keyCode, themes.length);
  if (!result) return;
  event.preventDefault();
  commit(result);
});

// Fired when the app is launched again while already running (e.g. from Home Assistant).
document.addEventListener("webOSRelaunch", (event) => {
  keepAwake?.poke();
  const detail = (event as CustomEvent<unknown>).detail;
  const params =
    typeof detail === "string" ? parseLaunchParams(detail, "") : parseLaunchParams(JSON.stringify(detail ?? {}), "");
  if (!params.theme) return;
  const next = themeIndex(params.theme, themes[prefs.themeIndex].id);
  const themeChanged = next !== prefs.themeIndex;
  prefs = { ...prefs, themeIndex: next };
  if (themeChanged) switchTheme();
  else render();
  showHint(themes[prefs.themeIndex].name);
  devPanel?.update(prefs);
});

function applyForceMotion(forced: boolean): void {
  document.documentElement.classList.toggle("force-motion", forced);
}

if (isDevMode(location)) {
  const forceMotion = readForceMotion(store);
  applyForceMotion(forceMotion);
  applyFancy(readFancy(store));
  devPanel = mountDevPanel({
    themes,
    themeIndex: prefs.themeIndex,
    brightness: prefs.brightness,
    fx: initialFx,
    // Same result as pressing Left / Right until that theme: new index, hint with its name.
    onTheme: (index) => commit({ prefs: { ...prefs, themeIndex: index }, hint: themes[index].name }),
    onBrightness: (direction) => {
      const result = applyKey(prefs, direction > 0 ? KEY.UP : KEY.DOWN, themes.length);
      if (result) commit(result);
    },
    onFx: (value) => {
      fxValue = value;
      fxOverride = parseFx(value);
      // Redraw: the themes show the previewed icon and label, and the backdrop follows what they drew.
      render();
    },
    forceMotion,
    onForceMotion: (forced) => {
      applyForceMotion(forced);
      writeForceMotion(store, forced);
      render();
    },
    fancy,
    onFancy: (flags) => {
      applyFancy(flags);
      writeFancy(store, flags);
    },
    storage: store,
  });
}

function onHaEntities(entities: Entities): void {
  const first = indoor === null;
  indoor = indoorReadings(entities, config.haEntities);
  // Show the first readings right away instead of waiting up to a minute.
  if (first && indoor !== null) render();
}

tickMinute();
scheduleRelocation();
void refreshForecast();
if (config.haBaseUrl && config.haToken && config.haEntities.length > 0) {
  startHa({
    baseUrl: config.haBaseUrl,
    token: config.haToken,
    entityIds: config.haEntities,
    connect: browserSocket,
    onEntities: onHaEntities,
  });
}
