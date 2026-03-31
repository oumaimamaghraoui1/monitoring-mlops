import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const EVENTS_FILE = path.join(rootPath, "data", "security_events.json");
const SCORED_FILE = path.join(rootPath, "data", "security_scored_snapshot.json");

router.get("/events", async (_req, res) => {

  try {

    const rawEvents = await fs.readFile(EVENTS_FILE, "utf8");
    const rawScores = await fs.readFile(SCORED_FILE, "utf8");

    const events = JSON.parse(rawEvents || "[]");
    const scores = JSON.parse(rawScores || "[]");

    // ============================
    // Build score dictionary
    // ============================
    const scoreMap = {};
    scores.forEach(s => {
      scoreMap[s.uuid] = s;
    });

    // ============================
    // Merge events + scored
    // ============================
    const merged = events.map(ev => {

      const scored = scoreMap[ev.uuid] || {};

      return {
        ...ev,
        anomalyScore: scored.anomalyScore ?? 0,
        anomaly: scored.anomaly ?? 1,
        hour: scored.hour ?? null,
        day: scored.day ?? null,
        weekend: scored.weekend ?? null,
        is_night: scored.is_night ?? null,
        login_count_7d: scored.login_count_7d ?? null,
        token_count_7d: scored.token_count_7d ?? null,
        first_time_ip: scored.first_time_ip ?? null,
        first_time_client: scored.first_time_client ?? null,
        time_since_last_login: scored.time_since_last_login ?? null
      };

    });

    // ============================
    // Sort newest first
    // ============================
    merged.sort((a, b) => new Date(b.time) - new Date(a.time));

    // ============================
    // Extract newest audit time
    // ============================
    const lastAudit =
      merged.length
        ? merged[0].time
        : null;

    res.json({
      logs: merged,
      lastAuditDate: lastAudit
    });

  }
  catch(err){
    console.error("[SEC ROUTE]",err);
    res.status(500).json({
      logs:[],
      lastAuditDate:null
    });
  }

});

export default router;