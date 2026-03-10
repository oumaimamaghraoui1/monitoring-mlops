import { Router } from "express";
import {
  getEnvSnapshot,
  getRuntimeSnapshot
} from "../services/healthMonitor.js";

const router = Router();

router.get("/env", (_req, res) => {
  res.json(getEnvSnapshot());
});

router.get("/runtime", (_req, res) => {
  res.json(getRuntimeSnapshot());
});

/* Test route: freeze event loop 5s */
router.get("/test-lag", (_req, res) => {
  const stop = Date.now() + 5000;
  while (Date.now() < stop) {}
  res.json({ ok: true });
});

/* Test route: crash app */
router.get("/test-crash", () => {
  setTimeout(() => { throw new Error("boom"); }, 50);
});

export default router;