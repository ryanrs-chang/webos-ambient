// OLED burn-in protection. Nothing a theme draws may stay on the same pixels
// for hours: the content block floats continuously across all free screen
// space, bouncing off the edges like a screensaver, so the panel never holds a
// static image.

export interface Offset {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** y moves at this fraction of x's speed so the path does not close into a short loop. */
const Y_SPEED_RATIO = 0.73;

/** Triangle wave: position after travelling `distance` px back and forth inside [0, range]. */
function bounce(distance: number, range: number): number {
  if (range <= 0) return 0;
  const m = distance % (2 * range);
  // Math.floor keeps the result inside [0, range] even for a float that lands on the edge.
  return Math.floor(m <= range ? m : 2 * range - m);
}

/**
 * Position at time `t` on a bouncing path inside [0, rangeX] x [0, rangeY].
 * x moves at `speedPxPerS`, y at 0.73 of it; each reflects at its edges.
 */
export function floatPosition(tMs: number, rangeX: number, rangeY: number, speedPxPerS: number): Offset {
  const d = (speedPxPerS * tMs) / 1000;
  return { x: bounce(d, rangeX), y: bounce(d * Y_SPEED_RATIO, rangeY) };
}

/** Free travel per axis once the content and a margin on every side are accounted for. */
export function floatRange(viewport: Size, content: Size, margin: number): Offset {
  return {
    x: Math.max(0, viewport.w - content.w - 2 * margin),
    y: Math.max(0, viewport.h - content.h - 2 * margin),
  };
}

// Zone relocation. Floating alone only ever covers a strip around where the content started, so every few
// minutes the block fades out and reappears in a different region. The 3x3 grid is dealt like a shuffled deck
// (a "bag"), so over nine relocations every region is visited exactly once.

export type Rng = () => number;

/** A cell of the 3x3 grid, col and row each 0..2. */
export interface Zone {
  col: number;
  row: number;
}

export interface ZoneState {
  /** Zones still to visit in this round; drawn from the front. */
  bag: Zone[];
  /** The zone drawn last, so a refill never starts with it. */
  last: Zone | null;
}

const GRID = 3;

/** All 9 zones in a random order (Fisher-Yates). */
export function zoneBag(rng: Rng): Zone[] {
  const zones: Zone[] = [];
  for (let row = 0; row < GRID; row++) for (let col = 0; col < GRID; col++) zones.push({ col, row });
  for (let i = zones.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [zones[i], zones[j]] = [zones[j], zones[i]];
  }
  return zones;
}

const sameZone = (a: Zone | null, b: Zone): boolean => a !== null && a.col === b.col && a.row === b.row;

/** Draws the next zone; an empty bag is refilled with a new shuffle that does not start with the last zone. Pure. */
export function nextZone(state: ZoneState, rng: Rng): { zone: Zone; state: ZoneState } {
  let bag = state.bag;
  if (bag.length === 0) {
    bag = zoneBag(rng);
    if (sameZone(state.last, bag[0])) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
  }
  const [zone, ...rest] = bag;
  return { zone, state: { bag: rest, last: zone } };
}

/** A random whole-pixel point inside the zone's third of the float range; a zero range on an axis gives 0. */
export function zoneTarget(zone: Zone, range: Offset, rng: Rng): Offset {
  const pick = (cell: number, extent: number): number => {
    if (extent <= 0) return 0;
    const lo = Math.ceil((cell * extent) / GRID);
    const hi = Math.max(lo, Math.floor(((cell + 1) * extent) / GRID));
    return Math.min(extent, lo + Math.floor(rng() * (hi - lo + 1)));
  };
  return { x: pick(zone.col, range.x), y: pick(zone.row, range.y) };
}

/**
 * The block's offset inside the float range: the zone anchor plus a slow drift of up to `drift` px either
 * side of it (the same bounce as floatPosition, in a small box), clamped into [0, range] so it is always
 * moving yet never leaves the free space.
 */
export function anchoredPosition(
  anchor: Offset,
  range: Offset,
  tMs: number,
  drift: number,
  speedPxPerS: number,
): Offset {
  const d = floatPosition(tMs, 2 * drift, 2 * drift, speedPxPerS);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(Math.max(0, max), v));
  return { x: clamp(anchor.x + d.x - drift, range.x), y: clamp(anchor.y + d.y - drift, range.y) };
}

/**
 * Ms until the next relocation: slots sit at multiples of `intervalMs` plus `offsetMs` (epoch-aligned, so with
 * whole-minute intervals they fall at a fixed second of the minute; the default half minute keeps clear of the
 * :00 digit roll). Standing exactly on a slot waits a whole interval, never 0.
 */
export function nextRelocationDelayMs(nowMs: number, intervalMs: number, offsetMs = 30_000): number {
  const wait = (((offsetMs - nowMs) % intervalMs) + intervalMs) % intervalMs;
  return wait === 0 ? intervalMs : wait;
}
