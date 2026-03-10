// src/api/alerts.routes.js
import { Router } from "express";
const router = Router();
router.get("/health", (req, res) => res.json({ service: "alerts", status: "ok" }));
export default router;