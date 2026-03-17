import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { computeRisk } from "../utils/risk.js";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

// ✅ IMPORTANT: UI must read SCORED logs
const FULL_STATE = path.join(rootPath, "data", "scored_snapshot.json");

router.get("/full", async (_req, res) => {

  try {

    const raw = await fs.readFile(
      path.join(rootPath, "data", "scored_snapshot.json"),
      "utf8"
    );

    const logs = JSON.parse(raw || "[]");

    const enriched = logs.map(log => {

      if (log.anomalyScore === undefined || log.anomalyScore === null)
        return log;

      const risk = computeRisk(log.anomalyScore);

      return {
        ...log,
        risk: risk.label,
        riskState: risk.state
      };
    });

    enriched.sort((a,b) =>
      (a.anomalyScore ?? 0) - (b.anomalyScore ?? 0)
    );

    res.json({ logs: enriched });

  } catch {

    // ✅ ML not ready yet → send empty
    res.json({ logs: [] });

  }
});
// ✅ ML SCORED LOGS FOR AI RISK VIEW
router.get("/scored", async (_req, res) => {

  try {

    const raw = await fs.readFile(
      path.join(rootPath, "data", "scored_snapshot.json"),
      "utf8"
    );

    const logs = JSON.parse(raw || "[]");

    const enriched = logs.map(log => {

      if (log.anomalyScore === undefined || log.anomalyScore === null)
        return log;

      const risk = computeRisk(log.anomalyScore);

      return {
        ...log,
        risk: risk.label,
        riskState: risk.state
      };
    });

    enriched.sort((a,b) =>
      (a.anomalyScore ?? 0) - (b.anomalyScore ?? 0)
    );

    res.json({ logs: enriched });

  } catch (err) {

    console.log("Scored file not ready yet");
    res.json({ logs: [] });

  }
});

router.get("/health", (_req, res) => {
  res.json({ service: "audit", status: "ok" });
});

export default router;