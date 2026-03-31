// =========================================================
// security-events-poller.js — ALM Security Events poller
// Category: audit.security-events
// Extracts: time, user, client, ip, origin, eventType, message
//
// USER  = email only if available
// CLIENT = readable technical client label if available
//
// This version:
//   - keeps existing security_events.json
//   - repairs old rows where possible
//   - only maps NEW raw ALM events
//   - triggers Security UEBA pipeline automatically
// =========================================================

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs/promises";
import { spawn } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(rootPath, ".env") });

const {
  ALM_USERNAME,
  ALM_PASSWORD,
  ALM_OAUTH_URL,
  ALM_API_URL
} = process.env;

// ---------------------------------------------------------
// Files
// ---------------------------------------------------------
const STATE_DIR  = path.join(rootPath, "data");
const STATE_FILE = path.join(STATE_DIR, "security_events.json");

// ---------------------------------------------------------
// Config
// ---------------------------------------------------------
const POLL_TOP         = 2000;
const MAX_LOGS         = 7000;
const POLL_INTERVAL_MS = 15000;

// ---------------------------------------------------------
// Utils
// ---------------------------------------------------------
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
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveState(logs) {
  const tmp = STATE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(logs, null, 2), "utf8");
  await fs.rename(tmp, STATE_FILE);
}

function safeParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const EMAIL_ONE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function firstEmail(s) {
  if (!s) return null;
  const m = String(s).match(EMAIL_ONE);
  return m ? m[0] : null;
}

// ---------------------------------------------------------
// Token & fetch
// ---------------------------------------------------------
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

async function fetchSecurityLogs(tok, lastSeen) {
  let url =
`${ALM_API_URL}/auditlog/v2/auditlogrecords` +
`?category=audit.security-events`;

if(lastSeen){
  url +=
    `&$filter=time gt ${encodeURIComponent(lastSeen)}`;
}

url +=
  `&$orderby=time asc` +
  `&$top=${POLL_TOP}`;

if(lastSeen){
  url +=
    `&$filter=time ge ${encodeURIComponent(lastSeen)}`;
}

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${tok}` }
  });

  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------
function normalizeClientLabel(clientId) {
  if (!clientId) return "Unknown";

  const c = String(clientId).trim().replace(/\"/g, "");

  // If it looks like a technical XSUAA/service client id,
  // keep it readable rather than shrinking it to "it"
  if (c.includes("sb-") || c.includes("|")) {
    const shortPart = c.split("|")[1]?.split("!")[0] || c;
    return `${shortPart} (${c})`;
  }

  return c;
}

function parseSecurityMessage(raw) {
  const msg = safeParse(raw.message) || {};
  let dataObj = null;

  if (typeof msg.data === "string" && msg.data.trim().startsWith("{")) {
    dataObj = safeParse(msg.data);
  } else if (typeof msg.data === "object" && msg.data) {
    dataObj = msg.data;
  }

  const ip = msg.ip || raw.ip || "";
  const origin = (dataObj && dataObj.origin) || "";
  const dataMsg = (dataObj && dataObj.message) || "";

  // --------------------------------
  // Event type
  // --------------------------------
  let eventType = "";
  const typeMatch =
    /(IdentityProviderAuthenticationSuccess|UserAuthenticationSuccess|ClientAuthenticationSuccess|TokenIssuedEvent)/.exec(dataMsg);

  if (typeMatch) {
    eventType = typeMatch[1];
  }

  // --------------------------------
  // USER = EMAIL ONLY
  // If no email exists in this event, keep Unknown
  // --------------------------------
  let user =
    firstEmail(msg.user) ||
    firstEmail(raw.user);

  if (!user) {
    const paren = /\('([^']+@[^']+)'\)/.exec(dataMsg);
    if (paren && paren[1]) {
      user = paren[1];
    }
  }

  if (!user) {
    const claimsUser = /"user_name"\s*:\s*"([^"]+@[^"]+)"/.exec(dataMsg);
    if (claimsUser && claimsUser[1]) {
      user = claimsUser[1];
    }
  }

  user = user || "Unknown";

  // --------------------------------
  // CLIENT
  // Keep a useful technical client label if present
  // --------------------------------
  let client = "";

  const mCid =
    /"client_id"\s*:\s*"([^"]+)"/.exec(dataMsg) ||
    /"azp"\s*:\s*"([^"]+)"/.exec(dataMsg) ||
    /"cid"\s*:\s*"([^"]+)"/.exec(dataMsg) ||
    /clientId=([^,\]]+)/.exec(dataMsg);

  if (mCid && mCid[1]) {
    client = mCid[1];
  } else if (origin) {
    client = origin;
  } else if (raw.user && !firstEmail(raw.user)) {
    // technical principal fallback
    client = raw.user;
  } else if (msg.user && !firstEmail(msg.user)) {
    client = msg.user;
  }

  client = normalizeClientLabel(client);

  // --------------------------------
  // Message cleanup
  // --------------------------------
  const messageText = dataMsg
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

  return {
    ip,
    origin,
    eventType: eventType || "Security Event",
    user,
    client,
    message: messageText
  };
}

// ---------------------------------------------------------
// Mapping
// ---------------------------------------------------------
function mapSecurityEvent(raw) {
  const meta = parseSecurityMessage(raw);

  return {
    uuid: raw.message_uuid || `${raw.category}|${raw.time}`,
    time: raw.time,
    user: meta.user,
    eventType: meta.eventType,
    ip: meta.ip,
    origin: meta.origin,
    client: meta.client,
    message: meta.message,
    raw
  };
}

// ---------------------------------------------------------
// Repair previously saved rows if they were badly parsed
// ---------------------------------------------------------
function repairExistingRow(row) {
  if (!row || !row.raw) return row;

  const needsRepair =
    !row.eventType ||
    row.eventType === "Security Event" ||
    row.user === "Unknown" ||
    row.client === "Unknown";

  if (!needsRepair) return row;

  const repaired = mapSecurityEvent(row.raw);

  return {
    ...row,
    user: repaired.user || row.user,
    eventType: repaired.eventType || row.eventType,
    ip: repaired.ip || row.ip,
    origin: repaired.origin || row.origin,
    client: repaired.client || row.client,
    message: repaired.message || row.message
  };
}

// ---------------------------------------------------------
// Security UEBA pipeline trigger
// ---------------------------------------------------------
function runSecurityUEBA() {
  const py = path.join(rootPath, "mlops/venv/bin/python");

  spawn(py, ["mlops/security/02_build_security_features.py"], {
    cwd: rootPath,
    detached: true,
    stdio: "ignore"
  }).unref();

  spawn(py, ["mlops/training/security_train.py"], {
    cwd: rootPath,
    detached: true,
    stdio: "ignore"
  }).unref();

  spawn(py, ["mlops/inference/security_score.py"], {
    cwd: rootPath,
    detached: true,
    stdio: "ignore"
  }).unref();

  console.log("[SEC-ML] UEBA security pipeline triggered");
}

// ---------------------------------------------------------
// Poller
// ---------------------------------------------------------
async function pollOnce() {
  console.log("[SEC-POLL] Fetching audit.security-events…");

  let existing = await loadState();
  let lastSeen = null;

if(existing.length>0){
  lastSeen = existing[0].time;
}
  const tok = await getToken();
  const fresh = await fetchSecurityLogs(tok,lastSeen);

  console.log(`[SEC-POLL] fetched ${fresh.length} logs.`);

  // Repair old saved rows where possible
  existing = existing.map(repairExistingRow);

  // Keep already-normalized rows as-is
  const merged = [...existing];
  const seen = new Set(existing.map(e => e.uuid));

  // Only map NEW raw ALM events
  for (const raw of fresh) {
    const key = raw.message_uuid || `${raw.category}|${raw.time}|${raw.id || ""}`;
    if (!key) continue;
    if (seen.has(key)) continue;

    seen.add(key);

    const mapped = mapSecurityEvent(raw);
    merged.push(mapped);

    if (merged.length >= MAX_LOGS) break;
  }

  // newest → oldest
  merged.sort((a, b) => new Date(b.time) - new Date(a.time));

  const trimmed = merged.slice(0, MAX_LOGS);

  await saveState(trimmed);
  console.log(`[SEC-POLL] Saved ${trimmed.length} logs to ${STATE_FILE}.`);

  runSecurityUEBA();
}

async function main() {
  await pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

main().catch(err => console.error(err));