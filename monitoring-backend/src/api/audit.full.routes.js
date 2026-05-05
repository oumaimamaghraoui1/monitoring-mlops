import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/api -> project root
const rootPath = path.resolve(__dirname, "../..");

const DATA_DIR = path.join(rootPath, "data");
const ALL_CONFIG_LOGS_FILE = path.join(DATA_DIR, "all_config_logs.json");

router.get("/audit/full", async (req, res) => {
  try {
    const raw = await fs.readFile(ALL_CONFIG_LOGS_FILE, "utf8");
    const logs = JSON.parse(raw || "[]");

    const latest = logs
      .map((x) => x.time)
      .filter(Boolean)
      .sort()
      .at(-1);

    console.log("[AUDIT FULL] Reading:", ALL_CONFIG_LOGS_FILE);
    console.log("[AUDIT FULL] Count:", logs.length);
    console.log("[AUDIT FULL] Latest:", latest);

    res.json({
      count: logs.length,
      latest,
      logs
    });
  } catch (err) {
    console.error("[AUDIT FULL] Failed:", err);

    res.status(500).json({
      error: "Failed to read full audit logs",
      details: err.message,
      file: ALL_CONFIG_LOGS_FILE
    });
  }
});

export default router;