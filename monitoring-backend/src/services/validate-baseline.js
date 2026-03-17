import fs from "fs";
import path from "path";

const baselinePath =
  "monitoring-backend/data/behaviour_baseline.json";

if (!fs.existsSync(baselinePath)) {
  console.log("No baseline found. Skipping validation.");
  process.exit(0);
}

const raw = fs.readFileSync(baselinePath, "utf8");
const baseline = JSON.parse(raw);

if (Object.keys(baseline).length === 0) {
  console.error("❌ Baseline is empty!");
  process.exit(1);
}

for (const actor in baseline) {
  if (!baseline[actor].roles || !baseline[actor].hours) {
    console.error("❌ Baseline malformed!");
    process.exit(1);
  }
}

console.log("✅ Baseline validation passed.");