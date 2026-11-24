// OLED burn-in protection. Nothing a theme draws may stay on the same pixels for hours, so every few minutes
// the content block fades out and reappears in another region of the screen. Between relocations it sits still
// on a whole-pixel position: a continuous drift left the text mid-transition at sub-pixel offsets, which looked
// blurry on the TV.

export interface Offset {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

/** Free room per axis once the content and a margin on every side are accounted for. */
export function floatRange(viewport: Size, content: Size, margin: number): Offset {
  return {
    x: Math.max(0, viewport.w - content.w - 2 * margin),
    y: Math.max(0, viewport.h - content.h - 2 * margin),
  };
}

// Zone relocation. Every few minutes the block fades out and reappears in a different region. The 3x3 grid is
// dealt like a shuffled deck (a "bag"), so over nine relocations every region is visited exactly once.

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
 * Where #stage's top-left goes, in whole px: the margin plus the anchor (a fraction of each axis of `range`),
 * rounded and clamped into [0, range]. Always integers, so the text is never rasterised at a sub-pixel offset.
 */
export function stagePosition(anchorFrac: Offset, range: Offset, margin: number): Offset {
  const axis = (frac: number, extent: number): number => {
    const max = Math.max(0, Math.round(extent));
    return Math.round(margin) + Math.max(0, Math.min(max, Math.round(frac * extent)));
  };
  return { x: axis(anchorFrac.x, range.x), y: axis(anchorFrac.y, range.y) };
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
