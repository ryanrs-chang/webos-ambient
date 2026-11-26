import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { findLeaks, scanRepo, secretsFromConfig } from "../scripts/leakGuard";

const example = { place: "Greenwich", latitude: 51.48, longitude: 0.01 };
const local = { place: "Testville", latitude: 12.34567, longitude: -67.89123 };

describe("secretsFromConfig", () => {
  test("lists latitude, longitude and place", () => {
    expect(secretsFromConfig(local, example).map((s) => s.key)).toEqual(["latitude", "longitude", "place"]);
  });

  test("skips values equal to the example's", () => {
    expect(secretsFromConfig({ ...local, place: "Greenwich" }, example).map((s) => s.key)).toEqual([
      "latitude",
      "longitude",
    ]);
  });

  test("skips whole-number coordinates, too common to match meaningfully", () => {
    expect(secretsFromConfig({ ...local, latitude: 25, longitude: 121 }, example).map((s) => s.key)).toEqual(["place"]);
  });
});

describe("secretsFromConfig: Home Assistant", () => {
  test("lists a set token and base url", () => {
    const keys = secretsFromConfig({ ...local, haBaseUrl: "http://10.9.8.7:8123", haToken: "tok.abc" }, example).map(
      (s) => s.key,
    );
    expect(keys).toEqual(["latitude", "longitude", "place", "haBaseUrl", "haToken"]);
  });

  test("skips them when empty or equal to the example's", () => {
    const keys = secretsFromConfig({ ...local, haBaseUrl: "", haToken: "" }, { ...example, haToken: "" });
    expect(keys.map((s) => s.key)).toEqual(["latitude", "longitude", "place"]);
  });

  test("finds a token as a substring, without its value in the finding", () => {
    const secrets = secretsFromConfig({ ...local, haToken: "eyJ.tok-1" }, example);
    const found = findLeaks([{ path: "x.ts", content: 'const t = "eyJ.tok-1";' }], secrets);
    expect(found).toEqual([{ path: "x.ts", line: 1, key: "haToken" }]);
    expect(JSON.stringify(found)).not.toContain("eyJ.tok-1");
  });
});

describe("findLeaks", () => {
  const secrets = secretsFromConfig(local, example);

  test("no findings in clean files", () => {
    expect(findLeaks([{ path: "a.ts", content: "const x = 1;\nconst y = 51.48;" }], secrets)).toEqual([]);
  });

  test("finds a latitude with its path and 1-based line", () => {
    expect(findLeaks([{ path: "a.ts", content: "a\nconst lat = 12.34567;\n" }], secrets)).toEqual([
      { path: "a.ts", line: 2, key: "latitude" },
    ]);
  });

  test("finds a negative longitude", () => {
    expect(findLeaks([{ path: "b.json", content: '{"lon":-67.89123}' }], secrets)).toEqual([
      { path: "b.json", line: 1, key: "longitude" },
    ]);
  });

  test("a longer number that merely contains the value is not a finding", () => {
    const content = "112.34567 12.345679 9912.34567 id=12.3456799";
    expect(findLeaks([{ path: "a.ts", content }], secrets)).toEqual([]);
  });

  test("a value followed by a sentence period is a finding", () => {
    expect(findLeaks([{ path: "r.md", content: "at 12.34567." }], secrets)).toHaveLength(1);
  });

  test("finds the place as a substring", () => {
    expect(findLeaks([{ path: "c.md", content: "Weather in Testville today" }], secrets)).toEqual([
      { path: "c.md", line: 1, key: "place" },
    ]);
  });

  test("reports each key once per line, across files", () => {
    const files = [
      { path: "a", content: "12.34567 12.34567 Testville" },
      { path: "b", content: "x\n-67.89123" },
    ];
    expect(findLeaks(files, secrets)).toEqual([
      { path: "a", line: 1, key: "latitude" },
      { path: "a", line: 1, key: "place" },
      { path: "b", line: 2, key: "longitude" },
    ]);
  });

  test("never carries the secret value in a finding", () => {
    const out = JSON.stringify(findLeaks([{ path: "a", content: "12.34567 Testville -67.89123" }], secrets));
    for (const v of ["12.34567", "Testville", "67.89123"]) expect(out).not.toContain(v);
  });
});

// Real check: when this machine has a config.local.json, none of its values may sit in a file that would be committed.
describe("repository", () => {
  test.skipIf(!existsSync(new URL("../config.local.json", import.meta.url)))(
    "config.local.json values appear in no committable file",
    async () => {
      const findings = await scanRepo();
      expect(findings).toEqual([]);
    },
  );
});
