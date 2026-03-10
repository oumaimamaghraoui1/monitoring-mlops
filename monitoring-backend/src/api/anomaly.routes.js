import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

const FILE =
  path.join(rootPath, "data", "role_alert_state.json");

router.get("/anomalies", async (_req, res) => {

  try {
    const raw = await fs.readFile(FILE, "utf8");
    const state = JSON.parse(raw || "{}");

    res.json(state.events || []);

  } catch {
    res.json([]);
  }
});

export default router;