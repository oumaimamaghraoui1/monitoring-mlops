import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename =
fileURLToPath(import.meta.url);

const __dirname =
path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname,".env")
});
import express from "express";
import os from "os";
import cors from "cors";
import auditRoutes from "./src/api/audit.routes.js";
import securityRoutes from "./src/api/security.routes.js";
import dataRoutes from "./src/api/data.routes.js";
import anomalyRoutes from "./src/api/anomaly.routes.js";
import metricsRoutes from "./src/api/metrics.routes.js";
import {
  startSampling,
  startHeartbeatWatchdog,
  installCrashHooks
} from "./src/services/healthMonitor.js";
import healthRoutes from "./src/api/health.routes.js";

const app = express();
const isCI = process.env.CI === "true";
app.use("/health", healthRoutes);
/* --------------------------------------------
 * BAS ORIGIN (Workspace aware)
 * -------------------------------------------- */
const BAS_ORIGIN_REGEX =
  /^https:\/\/port\d+-workspaces-[a-zA-Z0-9-]+\.eu10\.applicationstudio\.cloud\.sap$/;

app.enable("trust proxy");

/* --------------------------------------------
 * FULL EXPRESS v5 SAFE CORS HANDLER
 * (Replaces app.options("*"), which causes crash)
 * -------------------------------------------- */
app.use((req, res, next) => {
  const origin = req.headers.origin || "";

  // Allow UI5 app origin
  if (BAS_ORIGIN_REGEX.test(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");

  // Preflight response
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

/* --------------------------------------------
 * JSON Body Parser
 * -------------------------------------------- */
app.use(express.json());

/* --------------------------------------------
 * Monitoring Engine Activation
 * -------------------------------------------- */

// Disable monitoring engine in CI
if (!isCI) {
  installCrashHooks();
  startSampling();
  startHeartbeatWatchdog();
}

/* --------------------------------------------
 * Monitoring API
 * -------------------------------------------- */
app.use("/metrics", metricsRoutes);

/* --------------------------------------------
 * Business Routes
 * -------------------------------------------- */
app.get("/", (_req, res) => res.send("Monitoring Backend is running"));

app.use("/audit", auditRoutes);
app.use("/security", securityRoutes);
app.use("/data", dataRoutes);

app.use((req, res, next) => {

  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const latency = Number(end - start) / 1e6;
    global.lastRequestLatency = latency;
  });

  next();
});
/* --------------------------------------------
 * Global Error Handler
 * -------------------------------------------- */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
});
app.use("/anomaly", anomalyRoutes);
/* --------------------------------------------
 * Start Server
 * -------------------------------------------- */
const port = process.env.PORT || 8090;
const host = "0.0.0.0";

app.listen(port, host, () =>
  console.log(`Server running on http://${host}:${port}`)
);
/*app.get("/slow", async (req, res) => {

  await new Promise(r => setTimeout(r, 2000));

  res.send("Simulated slow dependency");

}); */
// =============================
// 🔥 CPU SATURATION MOCK ROUTE
// =============================
import { Worker } from "worker_threads";


// =============================
// ✅ TRUE NON‑BLOCKING CPU SATURATION
// =============================
app.get("/burn", (req, res) => {

  res.send("CPU saturation started ✅");

  setTimeout(() => {

    console.log("🔥 Background CPU saturation...");

    const cores = os.cpus().length;

    for (let i = 0; i < cores; i++) {

      new Worker(`
        const end = Date.now() + 5000;
        while(Date.now() < end){
          Math.sqrt(Math.random());
        }
      `, { eval: true });

    }

  }, 0);

});