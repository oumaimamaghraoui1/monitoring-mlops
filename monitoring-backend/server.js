import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cfenv from "cfenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env")
});

import express from "express";
import cors from "cors";
import os from "os";
import fs from "fs";
import { Worker } from "worker_threads";
import axios from "axios";

import auditFullRoutes from "./src/api/audit.full.routes.js";
import auditRoutes from "./src/api/audit.routes.js";
import securityRoutes from "./src/api/security.routes.js";
import dataRoutes from "./src/api/data.routes.js";
import anomalyRoutes from "./src/api/anomaly.routes.js";
import metricsRoutes from "./src/api/metrics.routes.js";
import healthRoutes from "./src/api/health.routes.js";
import riskExportRoutes from "./src/api/risk.export.routes.js";
import securityExportRoutes from "./src/api/security.export.routes.js";
import logsExportRoutes from "./src/api/logs.export.routes.js";
import systemHealthExportRoutes from "./src/api/systemHealth.export.routes.js";

import {
  startSampling,
  startHeartbeatWatchdog,
  installCrashHooks
} from "./src/services/healthMonitor.js";

const app = express();
const isCI = process.env.CI === "true";
const appEnv = cfenv.getAppEnv();

const PYTHON_AI_URL =
  process.env.PYTHON_AI_URL || "http://127.0.0.1:9090";

console.log("PYTHON_AI_URL =", PYTHON_AI_URL);

app.enable("trust proxy");

app.use(cors({
  credentials: true,
  origin: true
}));

// IMPORTANT: body parsers must be BEFORE routes
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// REQUEST LATENCY TRACKING
app.use((req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    global.lastRequestLatency = Date.now() - start;
  });

  next();
});

// START MONITORING ENGINE
if (!isCI) {
  installCrashHooks();
  startSampling();
  startHeartbeatWatchdog();
}

// BUSINESS ROUTES
app.use("/audit", riskExportRoutes);
app.use("/", securityExportRoutes);
app.use(auditFullRoutes);
app.use("/health", healthRoutes);

// Put export route BEFORE normal metrics routes
app.use("/metrics", systemHealthExportRoutes);
app.use("/metrics", metricsRoutes);

app.use("/audit", auditRoutes);
app.use("/security", securityRoutes);
app.use("/data", dataRoutes);
app.use("/anomaly", anomalyRoutes);
app.use(logsExportRoutes);

app.get("/", (_req, res) => {
  res.send("Monitoring Backend is running");
});

// MOCK FAILURE ROUTES
app.get("/burn", (req, res) => {
  res.send("CPU saturation ✅");

  setTimeout(() => {
    const cores = os.cpus().length;
    for (let i = 0; i < cores; i++) {
      new Worker(`
        const end = Date.now() + 3000;
        while (Date.now() < end) {
          Math.sqrt(Math.random());
        }
      `, { eval: true });
    }
  }, 0);
});

app.get("/block", (req, res) => {
  for (let i = 0; i < 200; i++) {
    fs.readFileSync("package.json");
  }
  res.send("Blocking IO ✅");
});

app.get("/slow-api", async (req, res) => {
  await new Promise(r => setTimeout(r, 2000));
  res.send("Slow dependency ✅");
});

app.get("/trigger-runtime-alert", async (req, res) => {
  await new Promise(resolve => setTimeout(resolve, 2500));

  const start = Date.now();
  while (Date.now() - start < 350) {}

  res.send("Runtime alert trigger executed ✅");
});

app.get("/slow-api-random", async (req, res) => {
  const delay = Math.floor(Math.random() * 2500);
  await new Promise(resolve => setTimeout(resolve, delay));
  res.send(`Slow dependency ✅ ${delay} ms`);
});

app.get("/timer-flood", (req, res) => {
  res.send("Scheduler starvation simulated ✅");

  for (let i = 0; i < 50000; i++) {
    setTimeout(() => {}, 10000);
  }
});

// AI PROXY ROUTE
// AI PROXY ROUTE
app.post("/ai/recommend", async (req, res) => {
  console.log("➡ POST /ai/recommend");
  console.log("Payload:", req.body);
  console.log("Python target:", `${PYTHON_AI_URL}/recommend`);

  const payload = {
    query: req.body.query || req.body.tcode || "",
    mode: req.body.mode || "hybrid_engine"
  };

  try {
    const response = await axios.post(
      `${PYTHON_AI_URL}/recommend`,
      payload,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 60000
      }
    );

    console.log("✅ Python responded with:", response.status);
    res.status(response.status).json(response.data);
  } catch (err) {
    console.error("❌ Python AI ERROR");
    console.error("message:", err.message);

    if (err.response) {
      console.error("status:", err.response.status);
      console.error("data:", err.response.data);
    }

    res.status(500).json({
      error: "Node failed to reach Python AI",
      pythonUrl: PYTHON_AI_URL,
      details: err.message,
      responseStatus: err.response?.status,
      responseData: err.response?.data
    });
  }
});
const port = process.env.PORT || 8090;
const host = "0.0.0.0";

app.listen(port, host, () => {
  console.log(`Server running on http://${host}:${port}`);
});