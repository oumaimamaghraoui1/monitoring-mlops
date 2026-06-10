import { Router } from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/api -> monitoring-backend
const rootPath = path.resolve(__dirname, "../..");

function requireStateToken(req, res, next) {
  const expected = String(process.env.STATE_EXPORT_TOKEN || "").trim();
  const received = String(req.get("X-State-Token") || "").trim();

  if (!expected) {
    console.error("[STATE EXPORT] STATE_EXPORT_TOKEN is not configured", {
      expectedLength: expected.length,
      receivedLength: received.length,
      hasReceived: Boolean(received)
    });

    return res.status(500).json({
      error: "STATE_EXPORT_TOKEN is not configured",
      expectedLength: expected.length,
      receivedLength: received.length,
      hasReceived: Boolean(received)
    });
  }

  if (!received || received !== expected) {
    console.warn("[STATE EXPORT] Unauthorized request", {
      expectedLength: expected.length,
      receivedLength: received.length,
      hasExpected: Boolean(expected),
      hasReceived: Boolean(received),
      receivedPreview: received ? received.slice(0, 1) + "***" : ""
    });

    return res.status(401).json({
      error: "Unauthorized",
      expectedLength: expected.length,
      receivedLength: received.length,
      hasExpected: Boolean(expected),
      hasReceived: Boolean(received)
    });
  }

  return next();
}

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getFileInfo(filePath) {
  try {
    const stat = await fsp.stat(filePath);

    return {
      exists: true,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  } catch {
    return {
      exists: false,
      sizeBytes: 0,
      modifiedAt: null
    };
  }
}

async function streamJsonFile(res, filePath, sourceName) {
  const exists = await fileExists(filePath);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-State-Source", sourceName);

  if (!exists) {
    console.warn("[STATE EXPORT] File not found, returning empty array:", filePath);
    return res.status(200).send("[]");
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });

  stream.on("error", function (err) {
    console.error("[STATE EXPORT] Failed to stream file:", filePath);
    console.error("[STATE EXPORT] Reason:", err.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to stream state file",
        source: sourceName,
        details: err.message
      });
    } else {
      res.end();
    }
  });

  return stream.pipe(res);
}

// Lightweight health route.
// Important: do not parse/count large JSON files here.
router.get("/health", requireStateToken, async function (_req, res) {
  const securityPath = path.join(rootPath, "data", "security_events.json");
  const configPath = path.join(rootPath, "data", "all_config_logs.json");

  const securityInfo = await getFileInfo(securityPath);
  const configInfo = await getFileInfo(configPath);

  return res.json({
    status: "ok",
    service: "state-export",
    securityEventsFile: {
      path: "data/security_events.json",
      ...securityInfo
    },
    configLogsFile: {
      path: "data/all_config_logs.json",
      ...configInfo
    }
  });
});

// Raw streamed JSON state.
// GitHub Actions should download these files directly before running pollers.
router.get("/security-events", requireStateToken, async function (_req, res) {
  const filePath = path.join(rootPath, "data", "security_events.json");
  return streamJsonFile(res, filePath, "security_events.json");
});

router.get("/config-logs", requireStateToken, async function (_req, res) {
  const filePath = path.join(rootPath, "data", "all_config_logs.json");
  return streamJsonFile(res, filePath, "all_config_logs.json");
});

// Optional aliases.
router.get("/security-events-file", requireStateToken, async function (_req, res) {
  const filePath = path.join(rootPath, "data", "security_events.json");
  return streamJsonFile(res, filePath, "security_events.json");
});

router.get("/config-logs-file", requireStateToken, async function (_req, res) {
  const filePath = path.join(rootPath, "data", "all_config_logs.json");
  return streamJsonFile(res, filePath, "all_config_logs.json");
});

export default router;