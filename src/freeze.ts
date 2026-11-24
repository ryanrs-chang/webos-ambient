// Dev-only deterministic mode for screenshots and visual comparison (README, "Freeze"). `?freeze=1` pins the
// content to the zone-0 anchor with no relocation, pauses CSS animations and hides the weather canvas;
// `?now=<ISO time>` pins the clock. Never active from file:// (the TV).

export interface FreezeParams {
  frozen: boolean;
  /** The pinned clock, or null to use the real one. */
  now: Date | null;
}

/** The instant the test fixture's "current" hour is at (2026-11-24 18:00 in Asia/Taipei); the clock `?freeze=1` uses. */
export const FREEZE_NOW = new Date(Date.UTC(2026, 10, 24, 10, 0));

const OFF: FreezeParams = { frozen: false, now: null };

export function parseFreeze(protocol: string, search: string): FreezeParams {
  if (protocol !== "http:" && protocol !== "https:") return OFF;
  const query = new URLSearchParams(search);
  const frozen = query.get("freeze") === "1";
  const raw = query.get("now");
  const parsed = raw ? new Date(raw) : null;
  const now = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  return { frozen, now: now ?? (frozen ? FREEZE_NOW : null) };
}
