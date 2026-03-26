import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env")
});

import express from "express";
import os from "os";
import cors from "cors";

import auditRoutes from "./src/api/audit.routes.js";
import securityRoutes from "./src/api/security.routes.js";
import dataRoutes from "./src/api/data.routes.js";
import anomalyRoutes from "./src/api/anomaly.routes.js";
import metricsRoutes from "./src/api/metrics.routes.js";
import healthRoutes from "./src/api/health.routes.js";

import {
  startSampling,
  startHeartbeatWatchdog,
  installCrashHooks,
  logIncident
} from "./src/services/healthMonitor.js";

const app = express();
const isCI = process.env.CI === "true";

app.enable("trust proxy");

/* --------------------------------------------
   ✅ CORS SAFE HANDLER
-------------------------------------------- */
app.use(cors({
  credentials: true,
  origin: true
}));

/* --------------------------------------------
   ✅ RESPONSE + REQUEST RATE TRACKING
-------------------------------------------- */
app.use((req, res, next) => {

  const start = Date.now();

  global.reqCount =
    (global.reqCount || 0) + 1;

  res.on("finish", () => {

    const latency = Date.now() - start;

    global.lastRequestLatency = latency;

    global.respCount =
      (global.respCount || 0) + 1;
  });

  next();
});

/* --------------------------------------------
   ✅ JSON Parser
-------------------------------------------- */
app.use(express.json());

/* --------------------------------------------
   ✅ MONITORING ENGINE (Disabled in CI)
-------------------------------------------- */
if (!isCI) {
  installCrashHooks();
  startSampling();
  startHeartbeatWatchdog();
}

/* --------------------------------------------
   ✅ ROUTES
-------------------------------------------- */

app.use("/health", healthRoutes);
app.use("/metrics", metricsRoutes);
app.use("/audit", auditRoutes);
app.use("/security", securityRoutes);
app.use("/data", dataRoutes);
app.use("/anomaly", anomalyRoutes);

app.get("/", (_req, res) =>
  res.send("Monitoring Backend is running")
);

/* --------------------------------------------
   ✅ GLOBAL ERROR HANDLER
-------------------------------------------- */
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500)
     .json({ error:
       err.message ||
       "Internal Server Error"
     });
});

/* --------------------------------------------
   ✅ START SERVER
-------------------------------------------- */

const port = process.env.PORT || 8090;
const host = "0.0.0.0";

app.listen(port, host, () =>
  console.log(
    `Server running on http://${host}:${port}`
  )
);
import { Worker } from "worker_threads";
import fs from "fs";
import crypto from "crypto";

let leak = [];

// =============================
// CPU SATURATION
// =============================
app.get("/burn",(req,res)=>{

  logIncident("CPU_SATURATION");

  res.send("CPU burn simulated ✅");

  setTimeout(()=>{
    const cores=os.cpus().length;
    for(let i=0;i<cores;i++){
      new Worker(`
        const end=Date.now()+2000;
        while(Date.now()<end){
          Math.sqrt(Math.random());
        }
      `,{eval:true});
    }
  },0);
});

// =============================
// MEMORY PRESSURE
// =============================
app.get("/leak",(req,res)=>{

  logIncident("MEMORY_PRESSURE");

  for(let i=0;i<80;i++){
    leak.push(Buffer.allocUnsafe(512*1024));
  }

  setTimeout(()=>{
    leak.length=0;
    global.gc?.();
  },2000);

  res.send("Memory pressure simulated ✅");
});

// =============================
app.get("/block",(req,res)=>{
  logIncident("BLOCKING_IO");
  for(let i=0;i<200;i++){
    fs.readFileSync("package.json");
  }
  res.send("Blocking IO ✅");
});

// =============================
app.get("/slow-api",async(req,res)=>{
  logIncident("DEPENDENCY_LATENCY");
  await new Promise(r=>setTimeout(r,2000));
  res.send("Slow dependency ✅");
});

// =============================
app.get("/thread-starve",(req,res)=>{
  logIncident("THREAD_POOL_STARVATION");
  for(let i=0;i<100;i++){
    crypto.pbkdf2("p","s",100000,64,"sha512",()=>{});
  }
  res.send("Thread pool saturation ✅");
});

// =============================
app.get("/conn-flood",(req,res)=>{
  logIncident("CONNECTION_SATURATION");
  for(let i=0;i<500;i++){
    fetch("http://localhost:8090/");
  }
  res.send("Connection flood ✅");
});

// =============================
app.get("/promise-storm",(req,res)=>{
  logIncident("ASYNC_OVERFLOW");
  for(let i=0;i<5000;i++){
    Promise.resolve().then(()=>Math.random());
  }
  res.send("Async overflow ✅");
});

// =============================
app.get("/fs-saturate",(req,res)=>{
  logIncident("FS_LOCK_CONTENTION");
  for(let i=0;i<300;i++){
    fs.writeFileSync(`tmp${i}.txt`,"data");
  }
  res.send("FS contention ✅");
});

// =============================
app.get("/db-lock",async(req,res)=>{
  logIncident("QUERY_LATENCY");
  const start=Date.now();
  while(Date.now()-start<1500){
    await new Promise(r=>setTimeout(r,5));
  }
  res.send("Simulated DB lock ✅");
});

// =============================
app.get("/flood",(req,res)=>{
  logIncident("REQUEST_BACKLOG");
  for(let i=0;i<1000;i++){
    fetch("http://localhost:8090/health");
  }
  res.send("Backlog simulated ✅");
});

// =============================
app.get("/timer-flood",(req,res)=>{
  logIncident("SCHEDULER_STARVATION");
  for(let i=0;i<5000;i++){
    setTimeout(()=>{},10000);
  }
  res.send("Scheduler starvation ✅");
});

// =============================
app.get("/burn-io",(req,res)=>{
  logIncident("CPU_SATURATION");
  for(let i=0;i<200;i++){
    fs.readFileSync("package.json");
  }
  res.send("CPU+IO ✅");
});

// =============================
app.get("/mem-async",(req,res)=>{
  logIncident("MEMORY_PRESSURE");
  for(let i=0;i<80;i++){
    leak.push(Buffer.allocUnsafe(512*1024));
  }
  setTimeout(()=>{
    leak.length=0;
    global.gc?.();
  },2000);
  for(let i=0;i<3000;i++){
    Promise.resolve().then(()=>Math.random());
  }
  res.send("Mem+Async ✅");
});

// =============================
app.get("/tp-lat",(req,res)=>{
  logIncident("THREAD_POOL_STARVATION");
  for(let i=0;i<100;i++){
    crypto.pbkdf2("p","s",100000,64,"sha512",()=>{});
  }
  global.lastRequestLatency=1200;
  res.send("Threadpool latency ✅");
});
app.get("/real-conn-flood",(req,res)=>{

  logIncident("CONNECTION_SATURATION");

  for(let i=0;i<600;i++){
    fetch("http://localhost:8090/socket-wait");
  }

  res.send("conn saturated ✅");
});

app.get("/socket-stall",(req,res)=>{

  // Stall response WITHOUT CPU burn
  setTimeout(()=>{
    res.send("served");
  },200);

});
app.get("/socket-wait",(req,res)=>{

  setTimeout(()=>{
    res.send("ok");
  },200);

});

app.get("/slow-worker", async (req, res) => {

  // simulate slow async work
  await new Promise(resolve => setTimeout(resolve, 80));

  for(let i=0;i<20000;i++){
    Math.sqrt(Math.random());
  }

  res.send("slow work done");
});
/* ============================================
   MONITORING ENGINE START  ✅ VERY IMPORTANT
============================================ */

installCrashHooks();
startSampling();
startHeartbeatWatchdog();