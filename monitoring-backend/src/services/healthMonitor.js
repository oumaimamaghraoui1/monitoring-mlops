// src/services/healthMonitor.js
import os from "os";
import * as NotificationService from "../infrastructure/notifications/NotificationService.js";
const IS_PROD = process.env.NODE_ENV === "production";
// Optional modules
let pidusage = null;
try { pidusage = (await import("pidusage")).default; } catch (_) {}

let eventLoopLag = null;
try {
  const lag = await import("event-loop-lag");
  eventLoopLag = lag.default(1000);
} catch (_) {}

// ===== Helpers =====
function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

// ===== Config from .env =====
const SAMPLE_INTERVAL_MS = num(process.env.SAMPLE_INTERVAL_MS, 3000);
const HEARTBEAT_CHECK_MS = num(process.env.HEARTBEAT_CHECK_MS, 5000);
const MAX_STALE_SEC      = num(process.env.MAX_STALE_SEC, 20);

const CPU_HIGH_PCT   = num(process.env.CPU_HIGH_PCT, 85);
const CPU_SUSTAIN_MS = num(process.env.CPU_SUSTAIN_MS, 15000);

const HEAP_LEAK_MB    = num(process.env.HEAP_LEAK_MB, 30);
const HEAP_WINDOW_SEC = num(process.env.HEAP_WINDOW_SEC, 300);

const LAG_THRESHOLD_MS = num(process.env.LAG_THRESHOLD_MS, 250);

const ONE_MB = 1024 * 1024;

// ===== Internal State =====
const state = {
  startedAt: new Date().toISOString(),
  lastSampleAt: null,
  cpu: null,
  rss: null,
  heapUsed: null,
  heapTotal: null,
  elLagMs: null,
  uptimeSec: 0,
  heartbeatTs: Date.now(),
  pid: process.pid
};

// Timers
let samplerTimer = null;
let heartbeatTimer = null;

// Windows
const cpuWindow = {
  highSince: null,
  lastAlertAt: 0
};

const heapWindow = {
  points: [],
  lastAlertAt: 0
};

const lastByKey = new Map();

// ===== Sampling (runs every SAMPLE_INTERVAL_MS) =====
function sample() {
  const now = Date.now();
  state.lastSampleAt = new Date(now).toISOString();
  state.uptimeSec = Math.floor(process.uptime());
  state.heartbeatTs = now;

  // --- Memory ---
  const mem = process.memoryUsage();
  state.rss = mem.rss;
  state.heapUsed = mem.heapUsed;
  state.heapTotal = mem.heapTotal;

  const heapMB = state.heapUsed / ONE_MB;
  heapWindow.points.push({ t: now, heap: heapMB });

  const cutoff = now - HEAP_WINDOW_SEC * 1000;
  while (heapWindow.points.length && heapWindow.points[0].t < cutoff) {
    heapWindow.points.shift();
  }

  // --- CPU ---
  if (pidusage) {
    pidusage(process.pid)
      .then(stats => {
        state.cpu = Number(stats.cpu.toFixed(2));
        checkCpu(now);
      })
      .catch(() => fallbackCpu(now));
  } else {
    fallbackCpu(now);
  }

  // --- Event Loop Lag ---
  if (eventLoopLag) {
    state.elLagMs = Math.round(eventLoopLag());
    if (state.elLagMs > LAG_THRESHOLD_MS) {
      raiseOncePerKey(
        "PERF_DEGRADATION",
        `Event loop lag ${state.elLagMs}ms > ${LAG_THRESHOLD_MS}ms`,
        "HIGH",
        "lag"
      );
    }
  }

  // --- Heap Trend ---
  checkHeapTrend(now);
}

function fallbackCpu(now) {
  const load = os.loadavg()[0];
  const cores = os.cpus()?.length || 1;
  state.cpu = Number(((load * 100) / cores).toFixed(2));
  checkCpu(now);
}

// ===== High CPU sustained =====
function checkCpu(now) {
  if (state.cpu == null) return;

  const high = state.cpu >= CPU_HIGH_PCT;
  if (high) {
    if (cpuWindow.highSince == null) cpuWindow.highSince = now;

    const span = now - cpuWindow.highSince;
    if (span >= CPU_SUSTAIN_MS) {
      if (now - cpuWindow.lastAlertAt >= 60000) {
        raiseAlert(
          "CPU_SUSTAINED_HIGH",
          `CPU >= ${CPU_HIGH_PCT}% for ${(span / 1000).toFixed(0)}s (now=${state.cpu}%)`,
          "HIGH"
        );
        cpuWindow.lastAlertAt = now;
      }
    }
  } else {
    cpuWindow.highSince = null;
  }
}

// ===== Memory leak trend =====
function checkHeapTrend(now) {
  if (heapWindow.points.length < 2) return;

  const first = heapWindow.points[0];
  const last  = heapWindow.points[heapWindow.points.length - 1];
  const delta = last.heap - first.heap;

  if (delta >= HEAP_LEAK_MB) {
    if (now - heapWindow.lastAlertAt >= 10 * 60000) {
      raiseAlert(
        "MEMORY_LEAK_SUSPECTED",
        `Heap grew +${delta.toFixed(1)}MB in ${(HEAP_WINDOW_SEC/60).toFixed(1)}min`,
        "HIGH",
        { heapWindow: heapWindow.points }
      );
      heapWindow.lastAlertAt = now;
    }
  }
}

// ===== Crash Hooks =====
export function installCrashHooks() {
  process.on("uncaughtException", (err) => {
    raiseAlert("UNCAUGHT_EXCEPTION", err?.stack || String(err), "CRITICAL");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    raiseAlert("UNHANDLED_REJECTION", String(reason), "CRITICAL");
    process.exit(1);
  });

  process.on("exit", (code) => {
    raiseAlert(
      "PROCESS_EXIT",
      `Process exiting with code ${code}`,
      code === 0 ? "LOW" : "CRITICAL"
    );
  });
}

// ===== Start monitoring =====
export function startSampling() {
  if (samplerTimer) return;
  sample();
  samplerTimer = setInterval(sample, SAMPLE_INTERVAL_MS);
}

export function startHeartbeatWatchdog() {
  if (heartbeatTimer) return;

  heartbeatTimer = setInterval(() => {
    const delta = (Date.now() - state.heartbeatTs) / 1000;
    if (delta > MAX_STALE_SEC) {
      raiseAlert(
        "PROCESS_STALL",
        `No heartbeat for ${Math.round(delta)} seconds`,
        "CRITICAL"
      );
    }
  }, HEARTBEAT_CHECK_MS);
}

// ===== Alert helpers =====
function raiseAlert(type, message, severity = "MEDIUM", extras = {}) {
  try {
    if (typeof NotificationService.notify === "function") {
      NotificationService.notify({
        type,
        message,
        severity,
        time: new Date().toISOString(),
        source: "monitoring-backend",
        context: { ...state, ...extras }
      });
    } else {

  // ✅ Only warn in production
  if (IS_PROD) {
    console.error("[healthMonitor] NotificationService.notify NOT found");
  }

}
  } catch (e) {
    console.error("[healthMonitor] alert error:", e.message);
  }
}

// once/min de-noising
function raiseOncePerKey(type, message, severity, key) {
  const now = Date.now();
  const last = lastByKey.get(key) || 0;
  if (now - last >= 60000) {
    raiseAlert(type, message, severity);
    lastByKey.set(key, now);
  }
}

// ===== Expose ENV & runtime snapshots =====
const SECRET_KEYS = (process.env.SECRET_KEYS_MASK || "")
  .split(",")
  .map(s => s.trim().toUpperCase())
  .filter(Boolean);

function isSecret(k) {
  const up = k.toUpperCase();
  return SECRET_KEYS.some(mask => up.includes(mask));
}

export function getEnvSnapshot() {
  const out = {};
  for (const k of Object.keys(process.env))
    out[k] = isSecret(k) ? "***" : process.env[k];
  return out;
}

export function getRuntimeSnapshot() {
  return { ...state };
}