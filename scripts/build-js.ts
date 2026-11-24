// `bun run build:js`: bundles src/main.ts into app/main.js with the validated personal config inlined as
// __USER_CONFIG__ (see src/config.ts). An invalid config.local.json fails the build here.
import { loadUserConfig } from "./userConfigFile";

let loaded: Awaited<ReturnType<typeof loadUserConfig>>;
try {
  loaded = await loadUserConfig();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

if (loaded.source === "example") {
  console.warn("warning: config.local.json not found — using example values; run `bun run setup`");
}

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: "app",
  naming: "main.js",
  target: "browser",
  format: "iife",
  minify: true,
  define: { __USER_CONFIG__: JSON.stringify(loaded.config) },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
