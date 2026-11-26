// Home Assistant link over its WebSocket API (https://developers.home-assistant.io/docs/api/websocket):
//   1. the server sends `auth_required`; we answer `auth` with the long-lived access token;
//   2. on `auth_ok` we send `subscribe_entities` for the configured entity ids;
//   3. the server pushes compressed state events: `a` (added, full state), `c` (changed, a `+`/`-` diff),
//      `r` (removed). The first event carries every subscribed entity under `a`.
// WebSocket rather than REST: HA pushes changes instead of being polled (the TV's CPU is weak), and a WebSocket
// from file:// is not subject to the CORS check a REST fetch with Origin `null` would face.
// The protocol (`websocketUrl`, `handleHaMessage`, `applyEntityEvent`, `reconnectDelayMs`) is pure and tested;
// `startHa` wires it to an injected socket factory and timers. The token is never logged.

export const SUBSCRIBE_ID = 1;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;

export interface EntityState {
  state: string;
  attributes: Readonly<Record<string, unknown>>;
}

export type Entities = Readonly<Record<string, EntityState>>;

/** "http://ha.example:8123/" -> "ws://ha.example:8123/api/websocket" (https -> wss). */
export function websocketUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "").replace(/^http/, "ws")}/api/websocket`;
}

/** 5 s, 10 s, 20 s ... capped at 5 min; `attempt` counts failures since the last successful auth. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** Math.max(0, attempt), RECONNECT_MAX_MS);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Applies one `subscribe_entities` event to the known states; returns a new object, the input is untouched. */
export function applyEntityEvent(entities: Entities, event: unknown): Entities {
  if (!isRecord(event)) return entities;
  const out: Record<string, EntityState> = { ...entities };
  if (isRecord(event.a)) {
    for (const [id, full] of Object.entries(event.a)) {
      if (!isRecord(full)) continue;
      out[id] = { state: String(full.s ?? ""), attributes: isRecord(full.a) ? { ...full.a } : {} };
    }
  }
  if (isRecord(event.c)) {
    for (const [id, diff] of Object.entries(event.c)) {
      const prev = out[id];
      if (!prev || !isRecord(diff)) continue;
      const attributes: Record<string, unknown> = { ...prev.attributes };
      let state = prev.state;
      const plus = diff["+"];
      if (isRecord(plus)) {
        if (plus.s !== undefined) state = String(plus.s);
        if (isRecord(plus.a)) Object.assign(attributes, plus.a);
      }
      const minus = diff["-"];
      if (isRecord(minus) && Array.isArray(minus.a)) {
        for (const key of minus.a) if (typeof key === "string") delete attributes[key];
      }
      out[id] = { state, attributes };
    }
  }
  if (Array.isArray(event.r)) {
    for (const id of event.r) if (typeof id === "string") delete out[id];
  }
  return out;
}

export interface HaSession {
  token: string;
  entityIds: readonly string[];
}

export type HaReply =
  | { action: "send"; payload: string; authed?: boolean }
  | { action: "entities"; entities: Entities }
  /** Wrong or revoked token: retrying will not help. */
  | { action: "fatal"; message: string }
  | { action: "error"; message: string }
  | { action: "ignore" };

/** What to do with one message from the server, given the states known so far. */
export function handleHaMessage(raw: string, session: HaSession, entities: Entities): HaReply {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { action: "ignore" };
  }
  if (!isRecord(msg)) return { action: "ignore" };
  switch (msg.type) {
    case "auth_required":
      return { action: "send", payload: JSON.stringify({ type: "auth", access_token: session.token }) };
    case "auth_ok":
      return {
        action: "send",
        authed: true,
        payload: JSON.stringify({ id: SUBSCRIBE_ID, type: "subscribe_entities", entity_ids: [...session.entityIds] }),
      };
    case "auth_invalid":
      return { action: "fatal", message: typeof msg.message === "string" ? msg.message : "auth_invalid" };
    case "result": {
      if (msg.id !== SUBSCRIBE_ID || msg.success !== false) return { action: "ignore" };
      const err = isRecord(msg.error) && typeof msg.error.message === "string" ? msg.error.message : "unknown";
      return { action: "error", message: `subscribe_entities failed: ${err}` };
    }
    case "event":
      if (msg.id !== SUBSCRIBE_ID) return { action: "ignore" };
      return { action: "entities", entities: applyEntityEvent(entities, msg.event) };
    default:
      return { action: "ignore" };
  }
}

/** The part of a browser WebSocket this module uses. */
export interface SocketLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

/** Adapts a browser WebSocket (whose handler types are DOM events) to SocketLike. */
export function browserSocket(url: string): SocketLike {
  const ws = new WebSocket(url);
  const s: SocketLike = {
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
  ws.onmessage = (event) => s.onmessage?.({ data: event.data });
  ws.onclose = () => s.onclose?.();
  ws.onerror = () => s.onerror?.();
  return s;
}

export interface HaOptions extends HaSession {
  baseUrl: string;
  connect: (url: string) => SocketLike;
  onEntities: (entities: Entities) => void;
  log?: (message: string) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface HaLink {
  stop(): void;
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Connects, subscribes and reconnects with backoff; never throws. Stops for good on a rejected token. */
export function startHa({
  baseUrl,
  token,
  entityIds,
  connect,
  onEntities,
  log = (m) => console.log(m),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}: HaOptions): HaLink {
  const url = websocketUrl(baseUrl);
  const session: HaSession = { token, entityIds };
  let entities: Entities = {};
  let attempt = 0;
  let stopped = false;
  let socket: SocketLike | null = null;
  let timer: unknown;

  const scheduleReconnect = () => {
    if (stopped) return;
    const delay = reconnectDelayMs(attempt++);
    log(`[ha] disconnected; retrying in ${Math.round(delay / 1000)} s`);
    timer = setTimer(open, delay);
  };

  function open(): void {
    if (stopped) return;
    let s: SocketLike;
    try {
      s = connect(url);
    } catch (e) {
      log(`[ha] could not connect: ${errText(e)}`);
      scheduleReconnect();
      return;
    }
    socket = s;
    s.onmessage = (event) => {
      if (stopped || typeof event.data !== "string") return;
      const reply = handleHaMessage(event.data, session, entities);
      switch (reply.action) {
        case "send":
          if (reply.authed) {
            attempt = 0;
            log(`[ha] authenticated; subscribing to ${entityIds.length} entities`);
          }
          s.send(reply.payload);
          break;
        case "entities":
          entities = reply.entities;
          onEntities(entities);
          break;
        case "fatal":
          log(`[ha] token rejected (${reply.message}); not retrying`);
          stopped = true;
          s.close();
          break;
        case "error":
          log(`[ha] ${reply.message}`);
          s.close();
          break;
        case "ignore":
          break;
      }
    };
    s.onerror = () => log("[ha] socket error");
    s.onclose = () => {
      if (socket !== s) return;
      socket = null;
      scheduleReconnect();
    };
  }

  open();
  return {
    stop() {
      stopped = true;
      clearTimer(timer);
      const s = socket;
      socket = null;
      s?.close();
    },
  };
}
