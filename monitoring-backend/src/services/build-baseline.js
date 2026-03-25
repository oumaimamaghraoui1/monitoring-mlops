// ==============================================
// build-baseline.js
// Builds user behaviour baseline from logs
// CI-compatible version
// ==============================================

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const DATA_DIR = path.join(rootPath, "data");

const LOG_FILE =
  path.join(DATA_DIR, "all_config_logs.json");

const BASELINE_FILE =
  path.join(DATA_DIR, "behaviour_baseline.json");


// ✅ Generate synthetic logs for CI
function generateSyntheticLogs() {

  console.log("⚠️ No training logs found. Generating synthetic CI logs...");

  const users = ["userA", "userB", "admin"];
  const roles = ["CONFIG", "SECURITY", "AUDIT"];

  const fakeLogs = [];

  for (let i = 0; i < 300; i++) {

    fakeLogs.push({
      actor: users[Math.floor(Math.random() * users.length)],
      objectType: roles[Math.floor(Math.random() * roles.length)],
      time: new Date(
        Date.now() - Math.random() * 86400000
      ).toISOString()
    });
  }

  return fakeLogs;
}


async function main() {

  await fs.mkdir(DATA_DIR, { recursive: true });

  let logs = [];

  if (!fsSync.existsSync(LOG_FILE)) {

    logs = generateSyntheticLogs();

  } else {

    console.log("✅ Real logs found. Training baseline...");

    const raw = await fs.readFile(LOG_FILE, "utf8");
    logs = JSON.parse(raw || "[]");
  }

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

    baseline[actor].roles[role] =
      (baseline[actor].roles[role] || 0) + 1;

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