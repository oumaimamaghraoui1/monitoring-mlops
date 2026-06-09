import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const SCORED_FILE = path.join(rootPath, "data", "security_scored_snapshot.json");

router.get("/events", async (_req, res) => {
  try {
    const rawScores = await fs.readFile(SCORED_FILE, "utf8");
    const scored = JSON.parse(rawScores || "[]");

    const logs = scored.sort((a, b) => new Date(b.time) - new Date(a.time));
    const lastAuditDate = logs.length ? logs[0].time : null;

    res.json({
      logs,
      lastAuditDate
    });
  } catch (err) {
    console.error("[SEC ROUTE]", err);
    res.status(500).json({
      logs: [],
      lastAuditDate: null
    });
  }
});

export default router;