// Reads the personal config for the build and for `bun run setup`: config.local.json if present, else the example.
import { parseUserConfig, type UserConfig } from "../src/userConfig";

const ROOT = new URL("..", import.meta.url).pathname;
export const LOCAL_PATH = `${ROOT}config.local.json`;
export const EXAMPLE_PATH = `${ROOT}config.example.json`;

async function readJson(path: string, name: string): Promise<unknown> {
  try {
    return await Bun.file(path).json();
  } catch (e) {
    throw new Error(`${name} is not valid JSON: ${(e as Error).message}`);
  }
}

export interface Loaded {
  config: UserConfig;
  source: "local" | "example";
}

/** Throws with a message listing the bad keys when the file is invalid. */
export async function loadUserConfig(): Promise<Loaded> {
  if (await Bun.file(LOCAL_PATH).exists()) {
    return { config: parseUserConfig(await readJson(LOCAL_PATH, "config.local.json")), source: "local" };
  }
  return { config: parseUserConfig(await readJson(EXAMPLE_PATH, "config.example.json")), source: "example" };
}
