// Keeps the TV's screen saver (which on a recent OLED hands over to Always Ready) from starting while the app is
// in the foreground. webOS has no public per-app switch for this; the mechanism every webOS app that needs it
// (Kodi, RetroArch, YouTube/Jellyfin/Immich clients) uses is the tvpower service's screen-saver vote:
//   1. subscribe to `registerScreenSaverRequest` with a client name;
//   2. each time the TV is about to start the saver it publishes a message carrying a `timestamp`;
//   3. answer that timestamp with `responseScreenSaverRequest` and `ack: false` (do not start it).
// Undocumented, so every failure is logged and swallowed: the clock must keep running without it.
// The pure parts (payloads, the reply decision) and the bridge wiring are unit-tested; a desktop browser has no
// bridge and gets a no-op.

export const REGISTER_URI = "luna://com.webos.service.tvpower/power/registerScreenSaverRequest";
export const RESPONSE_URI = "luna://com.webos.service.tvpower/power/responseScreenSaverRequest";
export const CLIENT_NAME = "dev.ryanrs.ambient";

export function registerPayload(clientName: string): string {
  return JSON.stringify({ subscribe: true, clientName });
}

export type ScreenSaverDecision =
  | { action: "veto"; payload: string }
  | { action: "subscribed" }
  | { action: "error"; message: string }
  | { action: "ignore" };

/**
 * What to do with one message from the subscription. A message with a timestamp is a screen saver about to
 * start (webOS 4 sends no `state`, so the timestamp is the signal) and gets `ack: false` with that timestamp
 * echoed unchanged; the first answer has none and only confirms the subscription.
 */
export function decideScreenSaverReply(raw: string, clientName: string): ScreenSaverDecision {
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
  return { action: "veto", payload: JSON.stringify({ clientName, ack: false, timestamp: m.timestamp }) };
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
  stop(): void;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Starts holding the screen saver off. Returns null (and logs why) where there is no bridge or it fails. */
export function startKeepAwake(
  host: BridgeHost,
  log: (message: string) => void = (m) => console.log(m),
  clientName: string = CLIENT_NAME,
): KeepAwake | null {
  const Bridge = host.WebOSServiceBridge ?? host.PalmServiceBridge;
  if (!Bridge) {
    log("[keepAwake] no service bridge (not on webOS); screen saver is left to the TV");
    return null;
  }
  let stopped = false;
  let vetoes = 0;
  try {
    const sub = new Bridge();
    sub.onservicecallback = (raw) => {
      if (stopped) return;
      const decision = decideScreenSaverReply(raw, clientName);
      switch (decision.action) {
        case "subscribed":
          log("[keepAwake] subscribed to registerScreenSaverRequest");
          break;
        case "error":
          log(`[keepAwake] tvpower refused: ${decision.message}`);
          break;
        case "veto":
          try {
            const reply = new Bridge();
            reply.onservicecallback = (ack) => {
              if (decideScreenSaverReply(ack, clientName).action === "error") log(`[keepAwake] ack failed: ${ack}`);
              reply.cancel?.();
            };
            reply.call(RESPONSE_URI, decision.payload);
            vetoes++;
            log(`[keepAwake] screen saver vetoed (#${vetoes}) ${raw}`);
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
