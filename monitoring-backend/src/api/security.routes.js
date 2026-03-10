import { Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootPath = path.resolve(__dirname, "../..");
const SEC_STATE = path.join(rootPath, "data", "security_events.json");

router.get("/events", async (_req, res) => {
  try {
    const raw = await fs.readFile(SEC_STATE, "utf8");
    res.json({ logs: JSON.parse(raw || "[]") });
  } catch (err) {
    console.error("[/security/events] read error:", err);
    res.json({ logs: [] });
  }
});

export default router; // final path: GET /security/events