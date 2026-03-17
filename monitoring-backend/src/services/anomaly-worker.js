import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { scoreEvent } from "./anomaly-score.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const RAW_FILE = path.join(rootPath, "data", "all_config_logs.json");
const SCORED_FILE = path.join(rootPath, "data", "scored_snapshot.json");

let isRunning = false;

async function runWorker() {

  if (isRunning) return;
  isRunning = true;

  try {

    const rawData = await fs.readFile(RAW_FILE, "utf8");
    const rawLogs = JSON.parse(rawData || "[]");

    let scoredLogs = [];

    try {
      const scoredData = await fs.readFile(SCORED_FILE, "utf8");
      scoredLogs = JSON.parse(scoredData || "[]");
    } catch {}

    const scoredUUIDs = new Set(scoredLogs.map(l => l.uuid));

    const newLogs = rawLogs.filter(
      log => log.uuid && !scoredUUIDs.has(log.uuid)
    );

    if (newLogs.length === 0) {
      isRunning = false;
      return;
    }

    console.log(`🧠 Scoring ${newLogs.length} new logs...`);

    for (const log of newLogs) {

      const actorLogs = rawLogs.filter(l =>
        l.actor === log.actor
      );

      const now = new Date(log.time).getTime();

      // ✅ last 7 day activity
      const last7d = actorLogs.filter(l => {
        const t = new Date(l.time).getTime();
        return now - t <= 7 * 24 * 60 * 60 * 1000;
      });

      // ✅ same role usage
      const sameRole = actorLogs.filter(l =>
        l.details === log.details
      );

      // ✅ previous action
      const previous = actorLogs
        .filter(l => new Date(l.time) < new Date(log.time))
        .sort((a,b)=> new Date(b.time)-new Date(a.time))[0];

      const timeSinceLast = previous
        ? (now - new Date(previous.time).getTime()) / 1000
        : 0;

      const d = new Date(log.time);

      const features = {
        hour: d.getHours(),
        day: d.getDay(),
        weekend: [0,6].includes(d.getDay()) ? 1 : 0,
        actor_count_7d: last7d.length,
        actor_object_7d: sameRole.length,
        time_since_last_actor: timeSinceLast,
        first_time_role: sameRole.length === 0 ? 1 : 0
      };

      let anomaly;

      try {
        anomaly = await scoreEvent(features);
      } catch(e) {
        console.log("⚠️ Python failed — skipping");
        continue;
      }

      scoredLogs.push({
        ...log,
        anomalyScore: anomaly.score,
        isAnomaly: anomaly.anomaly
      });

      scoredUUIDs.add(log.uuid);

      // ✅ progressive write
      await fs.writeFile(
        SCORED_FILE,
        JSON.stringify(scoredLogs,null,2)
      );

      await new Promise(r => setTimeout(r, 50));
    }

    console.log(`✅ Scored file updated`);

  } catch(e) {
    console.log("Worker error:", e);
  }

  isRunning = false;
}

setInterval(runWorker, 15000);