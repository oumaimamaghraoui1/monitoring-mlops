import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const FULL_STATE = path.join(rootPath, "data", "all_config_logs.json");

router.get("/full", async (_req, res) => {
  try {
    const raw = await fs.readFile(FULL_STATE, "utf8");
    const logs = JSON.parse(raw || "[]");
    res.json({ logs });
  } catch (err) {
    console.error("[/audit/full] read error:", err);
    res.json({ logs: [] });
  }
});

router.get("/health", (_req, res) => {
  res.json({ service: "audit", status: "ok" });
});

export default router;