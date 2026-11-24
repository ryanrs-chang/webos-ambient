// Keeps the TV's screen saver (which on a recent OLED hands over to Always Ready) from starting while the app is
// in the foreground. webOS has no public per-app switch for this; the mechanism every webOS app that needs it
// (Kodi, RetroArch, YouTube/Jellyfin/Immich clients) uses is the tvpower service's screen-saver vote:
//   1. subscribe to `registerScreenSaverRequest` with a client name;
//   2. each time the TV is about to start the saver it publishes a message carrying a `timestamp`;
//   3. answer that timestamp with `responseScreenSaverRequest` and `ack: false` (do not start it).
// Undocumented, so every failure is logged and swallowed: the clock must keep running without it.
// Fallback: the veto lasts at most `maxVetoMs` (1 h by default) since the app started or the last remote key
// (`poke()`); after that each request is answered `ack: true`, so a TV left on by mistake still goes to sleep.
// The pure parts (payloads, the reply decision) and the bridge wiring are unit-tested; a desktop browser has no
// bridge and gets a no-op.

export const REGISTER_URI = "luna://com.webos.service.tvpower/power/registerScreenSaverRequest";
export const RESPONSE_URI = "luna://com.webos.service.tvpower/power/responseScreenSaverRequest";
export const CLIENT_NAME = "dev.ryanrs.ambient";
/** How long the screen saver is held off without any remote key, before the TV is let go. */
export const MAX_VETO_MS = 60 * 60_000;

export function registerPayload(clientName: string): string {
  return JSON.stringify({ subscribe: true, clientName });
}

export type ScreenSaverDecision =
  | { action: "veto"; payload: string }
  | { action: "allow"; payload: string }
  | { action: "subscribed" }
  | { action: "error"; message: string }
  | { action: "ignore" };

/** True while the veto window, counted from `sinceMs` (start or last remote key), is still open. */
export function vetoWindowOpen(nowMs: number, sinceMs: number, maxVetoMs: number): boolean {
  return nowMs - sinceMs < maxVetoMs;
}

/**
 * What to do with one message from the subscription. A message with a timestamp is a screen saver about to
 * start (webOS 4 sends no `state`, so the timestamp is the signal) and gets `ack: false` with that timestamp
 * echoed unchanged, or `ack: true` once `veto` is false (the window is over); the first answer has none and only
 * confirms the subscription.
 */
export function decideScreenSaverReply(raw: string, clientName: string, veto = true): ScreenSaverDecision {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { action: "ignore" };
  }
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return { action: "ignore" };
  const m = msg as Record<string, unknown>;
  if (m.returnValue === false) {
    return { action: "error", message: typeof m.errorText === "string" ? m.errorText : "returnValue false" };
  }
  if (m.timestamp === undefined || m.timestamp === null) return { action: "subscribed" };
  return {
    action: veto ? "veto" : "allow",
    payload: JSON.stringify({ clientName, ack: !veto, timestamp: m.timestamp }),
  };
}

export interface ServiceBridge {
  onservicecallback: ((msg: string) => void) | null;
  call(uri: string, params: string): void;
  cancel?(): void;
}
type BridgeCtor = new () => ServiceBridge;

/** The two names webOS has used for the bridge class; the newer one wins, as in webOSTV.js. */
export interface BridgeHost {
  WebOSServiceBridge?: BridgeCtor;
  PalmServiceBridge?: BridgeCtor;
}

export interface KeepAwake {
  /** Someone is there (a remote key): restart the veto window. */
  poke(): void;
  stop(): void;
}

export interface KeepAwakeOptions {
  clientName?: string;
  maxVetoMs?: number;
  now?: () => number;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Starts holding the screen saver off. Returns null (and logs why) where there is no bridge or it fails. */
export function startKeepAwake(
  host: BridgeHost,
  log: (message: string) => void = (m) => console.log(m),
  { clientName = CLIENT_NAME, maxVetoMs = MAX_VETO_MS, now = Date.now }: KeepAwakeOptions = {},
): KeepAwake | null {
  const Bridge = host.WebOSServiceBridge ?? host.PalmServiceBridge;
  if (!Bridge) {
    log("[keepAwake] no service bridge (not on webOS); screen saver is left to the TV");
    return null;
  }
  let stopped = false;
  let vetoes = 0;
  let since = now();
  try {
    const sub = new Bridge();
    sub.onservicecallback = (raw) => {
      if (stopped) return;
      const decision = decideScreenSaverReply(raw, clientName, vetoWindowOpen(now(), since, maxVetoMs));
      switch (decision.action) {
        case "subscribed":
          log("[keepAwake] subscribed to registerScreenSaverRequest");
          break;
        case "error":
          log(`[keepAwake] tvpower refused: ${decision.message}`);
          break;
        case "veto":
        case "allow":
          try {
            const reply = new Bridge();
            reply.onservicecallback = (ack) => {
              if (decideScreenSaverReply(ack, clientName).action === "error") log(`[keepAwake] ack failed: ${ack}`);
              reply.cancel?.();
            };
            reply.call(RESPONSE_URI, decision.payload);
            if (decision.action === "veto") {
              vetoes++;
              log(`[keepAwake] screen saver vetoed (#${vetoes}) ${raw}`);
            } else {
              log(`[keepAwake] veto window over, screen saver allowed ${raw}`);
            }
          } catch (e) {
            log(`[keepAwake] reply failed: ${errText(e)}`);
          }
          break;
        case "ignore":
          break;
      }
    };
    sub.call(REGISTER_URI, registerPayload(clientName));
    log("[keepAwake] registerScreenSaverRequest sent");
    return {
      poke() {
        since = now();
      },
      stop() {
        stopped = true;
        try {
          sub.cancel?.();
        } catch {
          // Already gone.
        }
        sub.onservicecallback = null;
      },
    };
  } catch (e) {
    log(`[keepAwake] could not start: ${errText(e)}`);
    return null;
  }
}
