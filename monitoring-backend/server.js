import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cfenv from "cfenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env")
});

// =======================
// ✅ CORE
// =======================
import express from "express";
import cors from "cors";
import os from "os";
import fs from "fs";
import { Worker } from "worker_threads";

// =======================
// ✅ BUSINESS ROUTES (KEEP)
// =======================
import auditRoutes from "./src/api/audit.routes.js";
import securityRoutes from "./src/api/security.routes.js";
import dataRoutes from "./src/api/data.routes.js";
import anomalyRoutes from "./src/api/anomaly.routes.js";
import metricsRoutes from "./src/api/metrics.routes.js";
import healthRoutes from "./src/api/health.routes.js";
import riskExportRoutes from "./src/api/risk.export.routes.js";
import securityExportRoutes from "./src/api/security.export.routes.js";
import axios from "axios";

// =======================
// ✅ MONITORING ENGINE
// =======================
import {
  startSampling,
  startHeartbeatWatchdog,
  installCrashHooks
} from "./src/services/healthMonitor.js";

const app = express();
const isCI = process.env.CI === "true";
const appEnv = cfenv.getAppEnv();

app.enable("trust proxy");

app.use(cors({
  credentials: true,
  origin: true
}));

// ✅ REQUEST LATENCY TRACKING
app.use((req, res, next) => {

  const start = Date.now();

  res.on("finish", () => {
    global.lastRequestLatency = Date.now() - start;
  });

  next();
});

app.use(express.json());

// ✅ START MONITORING ENGINE
if (!isCI) {
  installCrashHooks();
  startSampling();
  startHeartbeatWatchdog();
}

// =======================
// ✅ BUSINESS ROUTES
// =======================
app.use("/audit", riskExportRoutes);
app.use("/", securityExportRoutes);

app.use("/health", healthRoutes);
app.use("/metrics", metricsRoutes);
app.use("/audit", auditRoutes);
app.use("/security", securityRoutes);
app.use("/data", dataRoutes);
app.use("/anomaly", anomalyRoutes);

app.get("/", (_req, res) =>
  res.send("Monitoring Backend is running")
);

// ======================================================
// ✅ MOCK FAILURE ROUTES
// ❌ DO NOT CALL logIncident HERE
// ======================================================

// ✅ TRUE CPU SATURATION
app.get("/burn",(req,res)=>{

  res.send("CPU saturation ✅");

  setTimeout(()=>{
    const cores=os.cpus().length;
    for(let i=0;i<cores;i++){
      new Worker(`
        const end=Date.now()+3000;
        while(Date.now()<end){
          Math.sqrt(Math.random());
        }
      `,{eval:true});
    }
  },0);
});

// ✅ BLOCKING IO
app.get("/block",(req,res)=>{
  for(let i=0;i<200;i++){
    fs.readFileSync("package.json");
  }
  res.send("Blocking IO ✅");
});

// ✅ DEPENDENCY LATENCY
app.get("/slow-api", async (req,res)=>{
  await new Promise(r => setTimeout(r,2000));
  res.send("Slow dependency ✅");
});
// =============================
// ✅ EVENT LOOP STARVATION TEST
// =============================
app.get("/timer-flood",(req,res)=>{

  res.send("Scheduler starvation simulated ✅");

  // flood Node's event loop timer queue
  for(let i=0;i<50000;i++){
    setTimeout(()=>{},10000);
  }

});

// ======================================================
// ✅ AI PROXY ROUTE (THE IMPORTANT PART)
// ======================================================
app.post("/ai/recommend", async (req, res) => {
  console.log("➡ POST /ai/recommend");
  console.log("Payload:", req.body);

  try {
    const response = await axios.post(
      "http://127.0.0.1:9090/recommend",   // ✅ CORRECT FOR BAS
      req.body,
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
      }
    );

    console.log("✅ Python responded with:", response.status);
    res.status(200).json(response.data);

  } catch (err) {
    console.error("❌ Python AI ERROR");
    console.error("message:", err.message);

    if (err.response) {
      console.error("status:", err.response.status);
      console.error("data:", err.response.data);
    }

    res.status(500).json({
      error: "Node failed to reach Python AI",
      details: err.message
    });
  }
});

// ======================================================

const port = process.env.PORT || 8090;
const host = "0.0.0.0";

app.listen(port, host, () =>
  console.log(`Server running on http://${host}:${port}`)
);



