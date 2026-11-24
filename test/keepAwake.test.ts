import { describe, expect, test } from "bun:test";
import {
  CLIENT_NAME,
  decideScreenSaverReply,
  REGISTER_URI,
  RESPONSE_URI,
  registerPayload,
  startKeepAwake,
} from "../src/keepAwake";

describe("luna request payloads", () => {
  test("registers by subscribing under the app's client name", () => {
    expect(JSON.parse(registerPayload("dev.ryanrs.ambient"))).toEqual({
      subscribe: true,
      clientName: "dev.ryanrs.ambient",
    });
  });

  test("talks to the tvpower service", () => {
    expect(REGISTER_URI).toBe("luna://com.webos.service.tvpower/power/registerScreenSaverRequest");
    expect(RESPONSE_URI).toBe("luna://com.webos.service.tvpower/power/responseScreenSaverRequest");
  });
});

describe("decideScreenSaverReply", () => {
  test("a request carrying a timestamp is vetoed with ack:false and the same timestamp", () => {
    const d = decideScreenSaverReply('{"returnValue":true,"state":"Active","timestamp":"1795600000123"}', "me");
    expect(d.action).toBe("veto");
    if (d.action === "veto") {
      expect(JSON.parse(d.payload)).toEqual({ clientName: "me", ack: false, timestamp: "1795600000123" });
    }
  });

  test("a numeric timestamp is echoed unchanged", () => {
    const d = decideScreenSaverReply('{"timestamp":42}', "me");
    expect(d.action === "veto" && JSON.parse(d.payload).timestamp).toBe(42);
  });

  test("webOS 4 sends no state; a timestamp alone is still a request", () => {
    expect(decideScreenSaverReply('{"returnValue":true,"timestamp":1,"instantBoot":false}', "me").action).toBe("veto");
  });

  test("the first answer, without a timestamp, only confirms the subscription", () => {
    expect(decideScreenSaverReply('{"returnValue":true,"subscribed":true}', "me").action).toBe("subscribed");
  });

  test("returnValue:false is an error carrying the service's message", () => {
    const d = decideScreenSaverReply('{"returnValue":false,"errorCode":-1,"errorText":"Denied method call"}', "me");
    expect(d).toEqual({ action: "error", message: "Denied method call" });
  });

  test("an error without text still says something", () => {
    const d = decideScreenSaverReply('{"returnValue":false}', "me");
    expect(d.action === "error" && d.message.length > 0).toBe(true);
  });

  test("malformed or non-object replies are ignored", () => {
    for (const raw of ["", "nope", "null", "42", "[]"]) {
      expect(decideScreenSaverReply(raw, "me").action).toBe("ignore");
    }
  });
});

/** A stand-in for the webOS service bridge that records what is asked of it. */
function fakeBridgeClass() {
  const instances: FakeBridge[] = [];
  class FakeBridge {
    onservicecallback: ((msg: string) => void) | null = null;
    calls: { uri: string; params: string }[] = [];
    cancelled = false;
    constructor() {
      instances.push(this);
    }
    call(uri: string, params: string) {
      this.calls.push({ uri, params });
    }
    cancel() {
      this.cancelled = true;
    }
  }
  return { Bridge: FakeBridge, instances };
}

describe("startKeepAwake", () => {
  test("is a no-op, returning null, when there is no bridge (desktop browser)", () => {
    const logs: string[] = [];
    expect(startKeepAwake({}, (m) => logs.push(m))).toBeNull();
    expect(logs.length).toBe(1);
    expect(logs[0]).toContain("no service bridge");
  });

  test("subscribes through the bridge on start", () => {
    const { Bridge, instances } = fakeBridgeClass();
    startKeepAwake({ PalmServiceBridge: Bridge }, () => {});
    expect(instances.length).toBe(1);
    expect(instances[0]?.calls).toEqual([{ uri: REGISTER_URI, params: registerPayload(CLIENT_NAME) }]);
  });

  test("prefers WebOSServiceBridge over the older PalmServiceBridge", () => {
    const fresh = fakeBridgeClass();
    const old = fakeBridgeClass();
    startKeepAwake({ WebOSServiceBridge: fresh.Bridge, PalmServiceBridge: old.Bridge }, () => {});
    expect(fresh.instances.length).toBe(1);
    expect(old.instances.length).toBe(0);
  });

  test("answers each screen saver request with ack:false on a bridge of its own", () => {
    const { Bridge, instances } = fakeBridgeClass();
    const logs: string[] = [];
    startKeepAwake({ PalmServiceBridge: Bridge }, (m) => logs.push(m));
    const sub = instances[0];
    sub?.onservicecallback?.('{"returnValue":true,"subscribed":true}');
    expect(instances.length).toBe(1);

    sub?.onservicecallback?.('{"returnValue":true,"state":"Active","timestamp":"111"}');
    sub?.onservicecallback?.('{"returnValue":true,"state":"Active","timestamp":"222"}');
    expect(instances.length).toBe(3);
    const replies = instances.slice(1).map((b) => b.calls[0]);
    expect(replies.map((c) => c?.uri)).toEqual([RESPONSE_URI, RESPONSE_URI]);
    expect(replies.map((c) => JSON.parse(c?.params ?? "{}"))).toEqual([
      { clientName: CLIENT_NAME, ack: false, timestamp: "111" },
      { clientName: CLIENT_NAME, ack: false, timestamp: "222" },
    ]);
    expect(logs.some((m) => m.includes("subscribed"))).toBe(true);
    expect(logs.filter((m) => m.includes("vetoed")).length).toBe(2);
  });

  test("logs a refused subscription so inspect:tv shows it, and answers nothing", () => {
    const { Bridge, instances } = fakeBridgeClass();
    const logs: string[] = [];
    startKeepAwake({ PalmServiceBridge: Bridge }, (m) => logs.push(m));
    instances[0]?.onservicecallback?.('{"returnValue":false,"errorText":"Denied method call"}');
    expect(instances.length).toBe(1);
    expect(logs.some((m) => m.includes("Denied method call"))).toBe(true);
  });

  test("never throws: a bridge that throws is logged", () => {
    const logs: string[] = [];
    class Broken {
      onservicecallback: ((msg: string) => void) | null = null;
      call() {}
      constructor() {
        throw new Error("boom");
      }
    }
    expect(startKeepAwake({ PalmServiceBridge: Broken }, (m) => logs.push(m))).toBeNull();
    expect(logs.some((m) => m.includes("boom"))).toBe(true);
  });

  test("a throwing reply bridge does not break the subscription handler", () => {
    const { Bridge, instances } = fakeBridgeClass();
    let n = 0;
    class Flaky extends Bridge {
      constructor() {
        super();
        if (n++ > 0) throw new Error("no more bridges");
      }
    }
    const logs: string[] = [];
    startKeepAwake({ PalmServiceBridge: Flaky }, (m) => logs.push(m));
    expect(() => instances[0]?.onservicecallback?.('{"timestamp":"9"}')).not.toThrow();
    expect(logs.some((m) => m.includes("no more bridges"))).toBe(true);
  });

  test("stop() cancels the subscription and ignores later callbacks", () => {
    const { Bridge, instances } = fakeBridgeClass();
    const handle = startKeepAwake({ PalmServiceBridge: Bridge }, () => {});
    handle?.stop();
    expect(instances[0]?.cancelled).toBe(true);
    instances[0]?.onservicecallback?.('{"timestamp":"1"}');
    expect(instances.length).toBe(1);
  });
});
