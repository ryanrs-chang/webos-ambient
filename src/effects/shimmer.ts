// Shimmer: every 20 to 60 s a thin, soft highlight sweeps once across the date line (and the temperatures).
// The pure half (the random gap and the limits) is tested; startShimmer is the DOM half. The sweep itself is CSS
// (`.shimmer::after`, keyframes `shimmer-sweep` in src/styles/motion.css): a gradient pseudo-element translating
// left to right, transform and opacity only.

export const SHIMMER_MIN_MS = 20_000;
export const SHIMMER_MAX_MS = 60_000;
/** One sweep; keep in step with the animation duration in motion.css. */
export const SHIMMER_MS = 1600;
/** The brightest the highlight gets (its gradient's peak alpha in motion.css). */
export const SHIMMER_PEAK_ALPHA = 0.25;

/** Gap until the next sweep. */
export function nextShimmerDelayMs(rng: () => number): number {
  return SHIMMER_MIN_MS + rng() * (SHIMMER_MAX_MS - SHIMMER_MIN_MS);
}

/** Class on every element that shimmers (set by the themes); `shimmer--run` plays one sweep. */
const TARGET = ".shimmer";
const RUN = "shimmer--run";
/** Targets sweep one after another, this far apart, so the date and the temperature do not flash together. */
const STAGGER_MS = 350;

/**
 * Schedules sweeps over whatever `.shimmer` elements `root` holds at that moment. #content is rebuilt every
 * minute, so nothing is cached: the class goes on the current elements and comes off when the sweep ends.
 */
export function startShimmer(root: HTMLElement, enabled: () => boolean, rng: () => number = Math.random): void {
  root.addEventListener("animationend", (event) => {
    if (event.animationName === "shimmer-sweep" && event.target instanceof HTMLElement) {
      event.target.classList.remove(RUN);
    }
  });
  const fire = (): void => {
    if (enabled() && !document.hidden) {
      const targets = root.querySelectorAll<HTMLElement>(TARGET);
      targets.forEach((el, i) => {
        el.style.setProperty("--shimmer-delay", `${i * STAGGER_MS}ms`);
        el.classList.add(RUN);
        // If the sweep never reports its end (animation off, element rebuilt), do not leave the class behind.
        setTimeout(() => el.classList.remove(RUN), SHIMMER_MS + i * STAGGER_MS + 500);
      });
    }
    setTimeout(fire, nextShimmerDelayMs(rng));
  };
  setTimeout(fire, nextShimmerDelayMs(rng));
}
