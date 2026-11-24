// Motion helpers. The pure half (diffTime, timeHtml, sweepStyle) is tested; syncLoops is DOM wiring.
// Only transform and opacity are ever animated, so the TV's weak CPU never re-layouts.

/** Which character positions of `next` differ from `prev`. No previous time (first render, theme switch) animates nothing. */
export function diffTime(prev: string | null, next: string): boolean[] {
  return Array.from(next, (c, i) => prev !== null && prev[i] !== c);
}

/**
 * "HH:MM" as one span per character so CSS can roll only the digits that changed.
 * A changed digit keeps its old character in `data-old` (drawn by a pseudo-element sliding out)
 * and the new one as its own text, so textContent stays the plain time.
 */
export function timeHtml(time: string, prev: string | null): string {
  const changed = diffTime(prev, time);
  return Array.from(time, (c, i) => {
    if (c === ":") return `<span class="colon">:</span>`;
    if (!changed[i]) return `<span class="digit">${c}</span>`;
    return `<span class="digit digit--changed" data-old="${prev?.[i]}"><span class="digit__n">${c}</span></span>`;
  }).join("");
}

/**
 * Inline style for a clock hand that sweeps from `from` to `to` degrees over the minute (see .t-analog__hand).
 * `elapsedSec` is how far into the minute we are, so a re-render mid-minute joins the sweep instead of restarting it.
 */
export function sweepStyle(from: number, to: number, elapsedSec: number): string {
  return `--a:${from}deg;--to:${to}deg;animation-delay:-${elapsedSec.toFixed(2)}s`;
}

/**
 * #content is rebuilt with innerHTML, which restarts every CSS animation. For the looping ones (colon, icons)
 * that would be a visible jump once a minute, so put each on the page clock instead: the new element lands
 * on the phase the old one would have reached. One-shot animations (digit roll, entrances) are left alone.
 */
export function syncLoops(root: Element): void {
  if (typeof root.getAnimations !== "function") return;
  const clock = performance.now();
  for (const a of root.getAnimations({ subtree: true })) {
    if (a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY) a.currentTime = clock;
  }
}
