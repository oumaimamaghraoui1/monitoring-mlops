import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const BASELINE_FILE =
  path.join(rootPath, "data", "behaviour_baseline.json");

export async function computeAnomaly(log) {

  const raw =
    await fs.readFile(BASELINE_FILE, "utf8");

  const baseline = JSON.parse(raw);

  const actor = log.actor;
  const role = log.objectType;
  const hour =
    new Date(log.time).getHours();

  if (!baseline[actor]) return 1;

  const roleFreq =
    baseline[actor].roles[role] || 0;

  const hourFreq =
    baseline[actor].hours[hour] || 0;

  const roleScore =
    roleFreq === 0 ? 1 : 0;

  const timeScore =
    hourFreq === 0 ? 1 : 0;

  return (roleScore + timeScore) / 2;
}