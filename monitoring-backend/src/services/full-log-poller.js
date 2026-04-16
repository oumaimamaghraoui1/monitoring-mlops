// =========================================================
// full-log-poller.js — RAW INGESTION + SAFE IAM CLASSIFIER
// =========================================================

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs/promises";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const rootPath   = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(rootPath, ".env") });

const {
  ALM_USERNAME,
  ALM_PASSWORD,
  ALM_OAUTH_URL,
  ALM_API_URL
} = process.env;

const STATE_DIR  = path.join(rootPath, "data");
const STATE_FILE = path.join(rootPath, "data", "all_config_logs.json");

const POLL_TOP = 500;
const POLL_INTERVAL_MS = 2 * 60 * 1000;

// =========================================================
// FILE HELPERS
// =========================================================

async function ensureStateFile() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try {
    await fs.access(STATE_FILE);
  } catch {
    await fs.writeFile(STATE_FILE, "[]", "utf8");
  }
}

async function loadState() {
  await ensureStateFile();
  const raw = await fs.readFile(STATE_FILE, "utf8");
  const logs = JSON.parse(raw || "[]");
  return Array.isArray(logs) ? logs : [];
}

async function saveState(logs) {
  const tmp = STATE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(logs, null, 2), "utf8");
  await fs.rename(tmp, STATE_FILE);
}

// =========================================================
// TOKEN
// =========================================================

async function getToken() {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: ALM_USERNAME,
    client_secret: ALM_PASSWORD
  });

  const { data } = await axios.post(ALM_OAUTH_URL, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  return data.access_token;
}

// =========================================================
// FETCH
// =========================================================

async function fetchLogs(token) {
  const url =
    `${ALM_API_URL}/auditlog/v2/auditlogrecords` +
    `?category=audit.configuration` +
    `&$orderby=time%20desc` +
    `&$top=${POLL_TOP}`;

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  return Array.isArray(data) ? data : [];
}

// =========================================================
// HELPERS
// =========================================================

function safeParseJson(input) {
  try {
    return JSON.parse(input);
  } catch (e) {
    return null;
  }
}

function getParsedInfo(raw) {
  const parsed = safeParseJson(raw && raw.message ? raw.message : "{}") || {};
  const objectNode = parsed.object || {};
  const objectId = objectNode.id || {};

  return {
    parsed,
    objectTypeRaw: objectNode.type || "",
    objectId,
    tableName: objectId.tableName || "",
    crudType: objectId.crudType || objectId.operationType || "",      // ✅ DELETE / CREATE parsed.crudType 
    roleName: objectId.rolecollection_name || "",
    category: parsed.category || raw.category || ""
  };
}

function normalizeCrud(value, fallback) {
  const v = String(value || fallback || "UPDATE").trim().toUpperCase();
  if (v === "CREATE" || v === "UPDATE" || v === "DELETE") {
    return v;
  }
  return "OTHER";
}
function extractCrudFromAttributes(attrs) {
  if (!Array.isArray(attrs)) return "";
  for (const a of attrs) {
    if (a && a.name === "operation") {
      return a.new || a.old || "";
    }
  }
  return "";
}

function buildHumanConfigDetails(info) {
  if (info.roleName) {
    return `Assigned role: ${info.roleName}`;
  }

  if (info.tableName) {
    return `Configuration updated (${info.tableName})`;
  }

  if (info.objectTypeRaw) {
    return `Configuration updated (${info.objectTypeRaw})`;
  }

  return "Configuration updated";
}

function classifyAuditEvent(raw) {
  const actor = raw && raw.user ? raw.user : "";
  const info = getParsedInfo(raw);

  const crud =
    info.crudType ||
    extractCrudFromAttributes(info.parsed.attributes) ||
    raw.action ||
    "";

  const normalizedCrud = normalizeCrud(crud, "OTHER");

  const isRoleAssignment =
    info.objectTypeRaw === "xs_rolecollection2user" ||
    info.tableName === "xs_rolecollection2user" ||
    !!info.roleName;

  if (isRoleAssignment) {
    const role = info.roleName || "Role";

    return {
      objectType: "Role Assignment",
      action: normalizedCrud,
      details: `Assigned role: ${role}`,
      target: role,
      isHuman: true
    };
  }

  const isScimUserUpdate =
    String(info.objectTypeRaw).toLowerCase() === "scim user";

  if (isScimUserUpdate) {
    return {
      objectType: "User Profile Update",
      action: normalizedCrud,
      details: "User identity updated",
      target: "[Identity]",
      isHuman: true
    };
  }

  const isUserActor =
    actor.indexOf("user/") === 0 || actor.indexOf("@") > -1;

  if (isUserActor) {
    return {
      objectType: "Configuration Change",
      action: normalizedCrud,
      details: buildHumanConfigDetails(info),
      target: info.tableName || info.objectTypeRaw || "Configuration",
      isHuman: true
    };
  }

  return {
    objectType: "Configuration Change",
    action: normalizedCrud,
    details: info.tableName || info.objectTypeRaw || "Technical configuration",
    target: info.tableName || info.objectTypeRaw || "TechnicalResource",
    isHuman: false
  };
}


// =========================================================
// ML PIPELINE (UNCHANGED)
// =========================================================

function runMLPipeline() {
  const python = path.join(rootPath, "mlops/venv/bin/python");

  spawn(python, ["mlops/pipelines/01_normalize_logs.py"], {
    cwd: rootPath,
    detached: true,
    stdio: "ignore"
  }).unref();

  spawn(python, ["mlops/pipelines/02_build_features.py"], {
    cwd: rootPath,
    detached: true,
    stdio: "ignore"
  }).unref();

  spawn(python, ["mlops/inference/score_event.py"], {
    cwd: rootPath,
    detached: true,
    stdio: "ignore"
  }).unref();

  console.log("[ML] FULL RETRAIN PIPELINE TRIGGERED");
}

// =========================================================
// POLLER
// =========================================================

async function pollOnce() {
  console.log("[POLL] Monitoring audit.configuration…");

  const existing = await loadState();
  const token = await getToken();
  const fresh = await fetchLogs(token);

  console.log(`[POLL] Pulled ${fresh.length} fresh logs`);

  const merged = existing.slice();
  const seen = new Set(existing.map(function (l) { return l.uuid; }));

  for (const raw of fresh) {
    if (!raw.message_uuid) {
      continue;
    }

    if (seen.has(raw.message_uuid)) {
      continue;
    }

    seen.add(raw.message_uuid);

    const iam = classifyAuditEvent(raw);

    merged.push({
      uuid: raw.message_uuid,
      time: raw.time,
      actor: raw.user || "Unknown",
      objectType: iam.objectType,
      action: iam.action,
      details: iam.details,
      target: iam.target,
      isHuman: iam.isHuman,
      raw: raw
    });
  }

  merged.sort(function (a, b) {
    return new Date(b.time) - new Date(a.time);
  });

  await saveState(merged);

  console.log(`[POLL] Saved ${merged.length} logs`);

  runMLPipeline();
}

async function main() {
  await pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

main().catch(console.error);
