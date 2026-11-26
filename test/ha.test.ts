import { describe, expect, test } from "bun:test";
import {
  applyEntityEvent,
  type Entities,
  handleHaMessage,
  reconnectDelayMs,
  type SocketLike,
  SUBSCRIBE_ID,
  startHa,
  websocketUrl,
} from "../src/ha";

const session = { token: "tok-123", entityIds: ["sensor.indoor_co2", "sensor.ambient_briefing"] };

describe("websocketUrl", () => {
  test("http becomes ws, https becomes wss, trailing slashes dropped", () => {
    expect(websocketUrl("http://ha.example:8123")).toBe("ws://ha.example:8123/api/websocket");
    expect(websocketUrl("https://ha.example/")).toBe("wss://ha.example/api/websocket");
  });
});

describe("reconnectDelayMs", () => {
  test("doubles from 5 s and caps at 5 min", () => {
    expect([0, 1, 2, 3].map(reconnectDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(reconnectDelayMs(20)).toBe(300_000);
  });
});

describe("handleHaMessage", () => {
  test("answers auth_required with the token", () => {
    const r = handleHaMessage('{"type":"auth_required","ha_version":"2026.11.0"}', session, {});
    expect(r.action).toBe("send");
    if (r.action === "send") expect(JSON.parse(r.payload)).toEqual({ type: "auth", access_token: "tok-123" });
  });

  test("subscribes to the configured entities on auth_ok", () => {
    const r = handleHaMessage('{"type":"auth_ok"}', session, {});
    expect(r).toMatchObject({ action: "send", authed: true });
    if (r.action === "send") {
      expect(JSON.parse(r.payload)).toEqual({
        id: SUBSCRIBE_ID,
        type: "subscribe_entities",
        entity_ids: session.entityIds,
      });
    }
  });

  test("auth_invalid is fatal", () => {
    expect(handleHaMessage('{"type":"auth_invalid","message":"Invalid access token"}', session, {})).toEqual({
      action: "fatal",
      message: "Invalid access token",
    });
  });

  test("a failed subscription is an error; a successful one is ignored", () => {
    const failed = `{"id":${SUBSCRIBE_ID},"type":"result","success":false,"error":{"code":"x","message":"nope"}}`;
    expect(handleHaMessage(failed, session, {})).toEqual({
      action: "error",
      message: "subscribe_entities failed: nope",
    });
    expect(handleHaMessage(`{"id":${SUBSCRIBE_ID},"type":"result","success":true}`, session, {}).action).toBe("ignore");
  });

  test("an event for the subscription updates the entities", () => {
    const raw = JSON.stringify({
      id: SUBSCRIBE_ID,
      type: "event",
      event: { a: { "sensor.indoor_co2": { s: "640" } } },
    });
    expect(handleHaMessage(raw, session, {})).toEqual({
      action: "entities",
      entities: { "sensor.indoor_co2": { state: "640", attributes: {} } },
    });
  });

  test("ignores events of other ids, unknown types and junk", () => {
    expect(handleHaMessage('{"id":9,"type":"event","event":{}}', session, {}).action).toBe("ignore");
    for (const raw of ["", "nope", "null", "[]", '{"type":"pong"}']) {
      expect(handleHaMessage(raw, session, {}).action).toBe("ignore");
    }
  });
});

describe("applyEntityEvent", () => {
  const initial = applyEntityEvent(
    {},
    {
      a: {
        "sensor.indoor_co2": { s: "640", a: { unit_of_measurement: "ppm" }, c: "ctx", lc: 1, lu: 1 },
        "sensor.ambient_briefing": { s: "2026-11-26T06:30:00", a: { text: "今天晴" } },
      },
    },
  );

  test("added entities carry state and attributes", () => {
    expect(initial["sensor.indoor_co2"]).toEqual({ state: "640", attributes: { unit_of_measurement: "ppm" } });
  });

  test("a change merges new state and attributes and drops removed attributes", () => {
    const next = applyEntityEvent(initial, {
      c: {
        "sensor.ambient_briefing": { "+": { s: "2026-11-26T07:00:00", a: { note: "x" } }, "-": { a: ["text"] } },
      },
    });
    expect(next["sensor.ambient_briefing"]).toEqual({ state: "2026-11-26T07:00:00", attributes: { note: "x" } });
    expect(next["sensor.indoor_co2"]).toBe(initial["sensor.indoor_co2"]);
  });

  test("an attribute-only change keeps the state", () => {
    const next = applyEntityEvent(initial, {
      c: { "sensor.indoor_co2": { "+": { a: { unit_of_measurement: "x" } } } },
    });
    expect(next["sensor.indoor_co2"]?.state).toBe("640");
  });

  test("a change to an unknown entity is skipped", () => {
    expect(applyEntityEvent(initial, { c: { "sensor.other": { "+": { s: "1" } } } })).toEqual(initial);
  });

  test("removed entities disappear", () => {
    expect(Object.keys(applyEntityEvent(initial, { r: ["sensor.indoor_co2"] }))).toEqual(["sensor.ambient_briefing"]);
  });

  test("never mutates its input", () => {
    const before = JSON.stringify(initial);
    applyEntityEvent(initial, { c: { "sensor.indoor_co2": { "+": { s: "9" } } }, r: ["sensor.ambient_briefing"] });
    expect(JSON.stringify(initial)).toBe(before);
  });

  test("junk events leave the entities as they were", () => {
    for (const ev of [null, 3, "x", [], { a: 5, c: [], r: "x" }])
      expect(applyEntityEvent(initial, ev)).toEqual(initial);
  });
});

/** A stand-in for the browser WebSocket that records what is sent, plus manual timers. */
function harness() {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  class FakeSocket implements SocketLike {
    onmessage: SocketLike["onmessage"] = null;
    onclose: SocketLike["onclose"] = null;
    onerror: SocketLike["onerror"] = null;
    sent: string[] = [];
    closed = false;
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.onclose?.();
    }
    receive(msg: unknown) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
  }
  const timers: { fn: () => void; ms: number }[] = [];
  const logs: string[] = [];
  const updates: Entities[] = [];
  const link = startHa({
    ...session,
    baseUrl: "http://ha.example:8123",
    connect: (url) => {
      urls.push(url);
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onEntities: (e) => updates.push(e),
    log: (m) => logs.push(m),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: () => {},
  });
  return { sockets, urls, timers, logs, updates, link };
}

describe("startHa", () => {
  test("authenticates, subscribes and reports entity states", () => {
    const h = harness();
    expect(h.urls).toEqual(["ws://ha.example:8123/api/websocket"]);
    const s = h.sockets[0];
    s?.receive({ type: "auth_required" });
    s?.receive({ type: "auth_ok" });
    expect(s?.sent.map((m) => JSON.parse(m).type)).toEqual(["auth", "subscribe_entities"]);
    s?.receive({ id: SUBSCRIBE_ID, type: "event", event: { a: { "sensor.indoor_co2": { s: "640" } } } });
    s?.receive({ id: SUBSCRIBE_ID, type: "event", event: { c: { "sensor.indoor_co2": { "+": { s: "700" } } } } });
    expect(h.updates.map((e) => e["sensor.indoor_co2"]?.state)).toEqual(["640", "700"]);
  });

  test("never logs the token", () => {
    const h = harness();
    const s = h.sockets[0];
    s?.receive({ type: "auth_required" });
    s?.receive({ type: "auth_ok" });
    s?.receive({ type: "auth_invalid", message: "bad" });
    expect(h.logs.join("\n")).not.toContain(session.token);
  });

  test("reconnects with backoff after a drop, and resets it after auth", () => {
    const h = harness();
    h.sockets[0]?.close();
    expect(h.timers.map((t) => t.ms)).toEqual([5_000]);
    h.timers[0]?.fn();
    h.sockets[1]?.close();
    expect(h.timers.map((t) => t.ms)).toEqual([5_000, 10_000]);
    h.timers[1]?.fn();
    h.sockets[2]?.receive({ type: "auth_ok" });
    h.sockets[2]?.close();
    expect(h.timers.at(-1)?.ms).toBe(5_000);
  });

  test("a rejected token stops for good", () => {
    const h = harness();
    h.sockets[0]?.receive({ type: "auth_invalid", message: "Invalid access token" });
    expect(h.sockets[0]?.closed).toBe(true);
    expect(h.timers).toEqual([]);
    expect(h.logs.some((m) => m.includes("not retrying"))).toBe(true);
  });

  test("a failed subscription closes and retries", () => {
    const h = harness();
    h.sockets[0]?.receive({ id: SUBSCRIBE_ID, type: "result", success: false, error: { message: "x" } });
    expect(h.sockets[0]?.closed).toBe(true);
    expect(h.timers.length).toBe(1);
  });

  test("a throwing connect is logged and retried, not thrown", () => {
    const timers: number[] = [];
    const logs: string[] = [];
    startHa({
      ...session,
      baseUrl: "http://ha.example:8123",
      connect: () => {
        throw new Error("blocked");
      },
      onEntities: () => {},
      log: (m) => logs.push(m),
      setTimer: (_fn, ms) => timers.push(ms),
    });
    expect(logs[0]).toContain("blocked");
    expect(timers).toEqual([5_000]);
  });

  test("stop closes the socket without scheduling a reconnect", () => {
    const h = harness();
    h.link.stop();
    expect(h.sockets[0]?.closed).toBe(true);
    expect(h.timers).toEqual([]);
  });
});
