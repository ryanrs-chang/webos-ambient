// `bun run check:secrets`: fails when a value from config.local.json appears in a committable file.
import { scanRepo } from "./leakGuard";

const findings = await scanRepo();
if (findings.length > 0) {
  console.error("Your config.local.json values appear in committable files (values not shown):");
  for (const f of findings) console.error(`  ${f.path}:${f.line}  your ${f.key}`);
  process.exit(1);
}
console.log("check:secrets: ok (or no config.local.json to check)");
