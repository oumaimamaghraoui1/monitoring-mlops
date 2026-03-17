// ==============================================
// build-baseline.js
// Builds user behaviour baseline from logs
// CI-safe version
// ==============================================

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const LOG_FILE =
  path.join(rootPath, "data", "all_config_logs.json");

const BASELINE_FILE =
  path.join(rootPath, "data", "behaviour_baseline.json");

async function main() {

  // ✅ CI SAFETY CHECK
  if (!fsSync.existsSync(LOG_FILE)) {
    console.log("⚠️ Training logs not found.");
    console.log("ℹ️ CI environment detected — skipping baseline training.");
    return;
  }

  console.log("✅ Logs found. Building behaviour baseline...");

  const raw = await fs.readFile(LOG_FILE, "utf8");
  const logs = JSON.parse(raw || "[]");

  const baseline = {};

  for (const log of logs) {

    if (!log.actor || !log.objectType || !log.time) continue;

    const actor = log.actor;
    const role = log.objectType;
    const hour = new Date(log.time).getHours();

    if (!baseline[actor]) {
      baseline[actor] = {
        roles: {},
        hours: {}
      };
    }

    // count role usage
    baseline[actor].roles[role] =
      (baseline[actor].roles[role] || 0) + 1;

    // count hour activity
    baseline[actor].hours[hour] =
      (baseline[actor].hours[hour] || 0) + 1;
  }

  await fs.writeFile(
    BASELINE_FILE,
    JSON.stringify(baseline, null, 2)
  );

  console.log("✅ Behaviour baseline built.");
}

main().catch(err => {
  console.error("❌ Baseline build failed:", err);
  process.exit(1);
});