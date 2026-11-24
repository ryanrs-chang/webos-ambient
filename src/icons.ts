import type { WeatherKind } from "./weather";

// Line icons drawn with currentColor. Inline SVG rather than emoji: the TV's
// fonts are not guaranteed to carry colour emoji, and a thin line glyph is
// gentler on an OLED panel than a filled one.

const CLOUD = "M7 19h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 11.2 4 4 0 0 0 7 19z";
const SUN_RAYS = [0, 45, 90, 135, 180, 225, 270, 315]
  .map((deg) => {
    const r = (deg * Math.PI) / 180;
    const p = (d: number) => `${(12 + d * Math.cos(r)).toFixed(2)} ${(12 + d * Math.sin(r)).toFixed(2)}`;
    return `M${p(7)}L${p(9.5)}`;
  })
  .join("");

// Class hooks for src/styles/motion.css (transform/opacity only). Moving parts get their own element, and a cloud
// is wrapped in a <g> because a CSS transform would replace the cloud path's own transform attribute.
const cloud = (transform?: string) =>
  `<g class="wx-cloud"><path d="${CLOUD}"${transform ? ` transform="${transform}"` : ""}/></g>`;
const sunShape = `<circle cx="12" cy="12" r="4.2"/><path class="wx-rays" d="${SUN_RAYS}"/>`;
const dots = (cls: string, points: string[]) =>
  points.map((d, i) => `<path class="${cls} ${cls}--${i}" d="${d}"/>`).join("");

const SHAPES: Record<string, string> = {
  sun: sunShape,
  moon: `<path class="wx-moon" d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z"/>`,
  partlyDay: `<g transform="translate(-3 -4) scale(.7)">${sunShape}</g>${cloud("translate(2 1)")}`,
  partlyNight: `<path class="wx-moon" d="M12 7.5A4.5 4.5 0 0 1 6.3 2 4.5 4.5 0 1 0 12 7.5z"/>${cloud("translate(2 1)")}`,
  cloudy: cloud(),
  fog: `<path d="M4 9h16M6 13h12M4 17h16"/>`,
  rain: `${cloud("translate(0 -3)")}${dots("wx-drop", ["M8 19l-1 2.5", "M12 19l-1 2.5", "M16 19l-1 2.5"])}`,
  snow: `${cloud("translate(0 -3)")}${dots("wx-flake", ["M8 20h.01", "M12 21h.01", "M16 20h.01"])}`,
  storm: `${cloud("translate(0 -3)")}<path class="wx-bolt" d="M12.5 16l-2 3h3l-2 3"/>`,
};

/** Hook plus the two utilities every icon needs: never shrink inside a flex row, sit on the text's middle. */
export const ICON_CLASS = "wx flex-none align-middle";

/** Distance of each orbiting dot from the icon's centre, in viewBox units (the glyph itself reaches about 10). */
const ORBIT_RADII = [12.6, 14, 13.3];
/** Diameter of a dot on screen, px, whatever the icon size. */
const DOT_PX = 3.5;

/**
 * Tiny dots circling the icon (CSS: .wx-orbit, one rotating group each; periods and phases in motion.css). The
 * svg must not clip them, and a dot's radius is in viewBox units, so it follows the icon's size to stay DOT_PX wide.
 */
function orbitDots(size: number): string {
  const r = ((DOT_PX / 2) * 24) / size;
  return ORBIT_RADII.map(
    (d, i) =>
      `<g class="wx-orbit wx-orbit--${i}"><circle class="wx-dot" cx="12" cy="${12 - d}" r="${r.toFixed(3)}"/></g>`,
  ).join("");
}

/** `orbit` adds the orbiting dots; the hourly strip does not, so only the big icons carry them. */
export function weatherIcon(kind: WeatherKind, isDay: boolean, size: number, className = "wx", orbit = false): string {
  const shape =
    kind === "clear"
      ? isDay
        ? SHAPES.sun
        : SHAPES.moon
      : kind === "partly"
        ? isDay
          ? SHAPES.partlyDay
          : SHAPES.partlyNight
        : SHAPES[kind];
  const overflow = orbit ? ` overflow="visible"` : "";
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"${overflow} aria-hidden="true">${shape}${orbit ? orbitDots(size) : ""}</svg>`;
}
