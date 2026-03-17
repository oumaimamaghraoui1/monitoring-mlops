import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { scoreEvent } from "./anomaly-score.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const SNAP = path.join(rootPath, "data", "ml_snapshot.json");
const OUT  = path.join(rootPath, "data", "scored_snapshot.json");

async function score() {

  const raw = await fs.readFile(SNAP, "utf8");
  const logs = JSON.parse(raw || "[]");

  for (const log of logs) {

    const d = new Date(log.time);

    const features = {
      hour: d.getHours(),
      day: d.getDay(),
      weekend: [0,6].includes(d.getDay()) ? 1 : 0,
      actor_count_7d: 1,
      actor_object_7d: 1,
      time_since_last_actor: 0,
      first_time_role: 0
    };

    const anomaly = await scoreEvent(features);

    log.anomalyScore = anomaly.score;
    log.isAnomaly = anomaly.anomaly;
  }

  await fs.writeFile(
    OUT,
    JSON.stringify(logs,null,2)
  );

  console.log("✅ Snapshot scored");

}

score();