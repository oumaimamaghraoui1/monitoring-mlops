import os from "os";
import { PerformanceObserver } from "perf_hooks";
import * as NotificationService from "../infrastructure/notifications/NotificationService.js";
import { PythonShell } from "python-shell";
import fs from "fs";
import path from "path";

const ONE_MB = 1024 * 1024;

// =============================
// Runtime State
// =============================
const state = {
  cpu: 0,
  heapUsed: 0,
  heapTotal: 0,
  elLagMs: 0,
  uptimeSec: 0,
  heartbeatTs: Date.now(),
  gcTimeMs: 0,
  healthScore: 100
};

// =============================
// GC Observer
// =============================
new PerformanceObserver((list) => {
  state.gcTimeMs = list.getEntries()
    .reduce((acc, e) => acc + e.duration, 0);
}).observe({ entryTypes: ["gc"] });

// =============================
const SAMPLE_INTERVAL_MS = 2000;
const HEARTBEAT_CHECK_MS = 5000;
const MAX_STALE_SEC = 20;
const HEALTH_ALERT_SCORE = 90;
const ALERT_COOLDOWN_MS = 10000;

let samplerTimer = null;
let heartbeatTimer = null;
let lastLoop = process.hrtime.bigint();

const alertWindow = {
  lastHealth: 0
};

// =============================
function computeEventLoopLag() {
  const now = process.hrtime.bigint();
  const diff = Number(now - lastLoop) / 1e6;
  lastLoop = now;
  return Math.max(diff - SAMPLE_INTERVAL_MS, 0);
}

function computeHealthScore() {
  let score = 100;
  if (state.cpu > 80) score -= 25;
  if (state.elLagMs > 200) score -= 25;
  if (state.gcTimeMs > 50) score -= 20;
  if ((global.lastRequestLatency || 0) > 300) score -= 30;
  return Math.max(score, 0);
}

// =============================
// ML RCA
// =============================
async function getSmartRecommendation() {

  try {
    const pyshell = new PythonShell(
      process.cwd() + "/mlops/inference/rca_predict.py",
      {
        pythonPath: process.cwd() + "/mlops/venv/bin/python",
        args: [
          JSON.stringify({
            cpu: state.cpu,
            latency: global.lastRequestLatency || 0,
            gc: state.gcTimeMs,
            lag: state.elLagMs
          })
        ]
      }
    );

    const result = await new Promise((resolve, reject) => {
      pyshell.on("message", resolve);
      pyshell.on("error", reject);
    });

    return JSON.parse(result);

  } catch {
    return null;
  }
}

// =============================
// INCIDENT LOGGER ✅ FIXED
// =============================
function logIncident(cause){

  const file = path.resolve(
    process.cwd(),
    "mlops/data/rca/incidents_log.csv"
  );

  const row = `${state.cpu},${global.lastRequestLatency || 0},0,${state.gcTimeMs},${state.elLagMs},${cause}\n`;

  fs.appendFile(file,row,()=>{});

}

// =============================
// ALERT ✅ NON‑BLOCKING + LOGGING
// =============================
async function raiseAlert(type, message, severity = "MEDIUM") {

  console.log(`⚠ Runtime alert triggered (score=${state.healthScore}%)`);

  NotificationService.notify({
    eventType: "runtime.degradation",
    severity,
    subject: `⚠ Runtime Health Degradation (${state.healthScore}%)`,
    body: buildEmailBody(type,message),
    tags: {
      alertType: type,
      service: "monitoring-backend",
      environment: process.env.NODE_ENV || "dev"
    },
    resource: {
      resourceName: "monitoring-backend",
      resourceType: "application"
    }
  }).catch(()=>{});

  getSmartRecommendation().then(ml => {

    if (!ml) return;

    // ✅ LOG ONLY VALID RCA
    if (ml.cause !== "UNKNOWN") {
      logIncident(ml.cause);
    }

    NotificationService.notify({
      eventType: "runtime.degradation",
      severity,
      subject: `🧠 RCA Suggestion (${state.healthScore}%)`,
      body: buildEmailBody(type,message,ml),
      tags: {
        alertType: type,
        service: "monitoring-backend",
        environment: process.env.NODE_ENV || "dev"
      },
      resource: {
        resourceName: "monitoring-backend",
        resourceType: "application"
      }
    }).catch(()=>{});

  });

}

// =============================
function buildEmailBody(type,message,ml=null){

  const smartCause = ml?.cause ?? "UNKNOWN";
  const smartAction = ml?.recommendation ?? "Investigate logs";

  return `
🚨 Runtime Degradation Detected

Health Score: ${state.healthScore}%
CPU Usage: ${state.cpu}%
Latency: ${Math.round(global.lastRequestLatency || 0)} ms
Event Loop Lag: ${state.elLagMs} ms
Heap: ${Math.round(state.heapUsed/ONE_MB)} MB

Likely Cause:
${smartCause}

Recommended Action:
${smartAction}
`;

}

// =============================
async function sample(){

  const now = Date.now();
  state.uptimeSec = Math.floor(process.uptime());
  state.heartbeatTs = now;

  state.elLagMs = Math.round(computeEventLoopLag());

  const mem = process.memoryUsage();
  state.heapUsed = mem.heapUsed;
  state.heapTotal = mem.heapTotal;

  const load = os.loadavg()[0];
  const cores = os.cpus()?.length || 1;
  state.cpu = Number(((load*100)/cores).toFixed(2));

  state.healthScore = computeHealthScore();

  if (!alertWindow.lastHealth) alertWindow.lastHealth = 0;

  if(state.healthScore < HEALTH_ALERT_SCORE &&
     (now - alertWindow.lastHealth) > ALERT_COOLDOWN_MS){

    await raiseAlert(
      "HEALTH_DEGRADATION",
      `Health score dropped to ${state.healthScore}%`
    );

    alertWindow.lastHealth = now;
  }

}

// =============================
export function startSampling(){
  if(samplerTimer) return;
  sample();
  samplerTimer=setInterval(sample,SAMPLE_INTERVAL_MS);
}

export function startHeartbeatWatchdog(){

  if(heartbeatTimer) return;

  heartbeatTimer=setInterval(async()=>{
    const delta=(Date.now()-state.heartbeatTs)/1000;
    if(delta>MAX_STALE_SEC){
      await raiseAlert(
        "PROCESS_STALL",
        `No heartbeat for ${Math.round(delta)}s`,
        "CRITICAL"
      );
    }
  },HEARTBEAT_CHECK_MS);

}

export function startMonitoringEngine(){
  startSampling();
  startHeartbeatWatchdog();
}

export function getRuntimeSnapshot(){
  return {...state};
}

export function getEnvSnapshot(){
  return {...process.env};
}

export function installCrashHooks(){

  process.on("unhandledRejection",(reason)=>{
    console.error("[SAFE UNHANDLED REJECTION]",reason);
  });

  process.on("uncaughtException",(err)=>{
    console.error("[SAFE UNCAUGHT EXCEPTION]",err);
  });

}