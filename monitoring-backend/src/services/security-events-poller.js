// =========================================================
// security-events-poller.js — ALM Security Events poller
// Category: audit.security-events
// Extracts: time, user, client, ip, origin, eventType, message
// =========================================================

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs/promises";

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

const STATE_DIR  = path.join(rootPath, "data");
const STATE_FILE = path.join(STATE_DIR, "security_events.json");

const POLL_TOP         = 2000;
const MAX_LOGS         = 7000;
const POLL_INTERVAL_MS = 90 * 1000; // security events are useful to see quicker

// ---------------------------------------------------------
// Utils
// ---------------------------------------------------------
async function ensureStateFile() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try { await fs.access(STATE_FILE); }
  catch { await fs.writeFile(STATE_FILE, "[]", "utf8"); }
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
  try { return JSON.parse(s); } catch { return null; }
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

async function fetchSecurityLogs(tok) {
  const url = `${ALM_API_URL}/auditlog/v2/auditlogrecords?category=audit.security-events&$orderby=time%20desc&top=${POLL_TOP}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${tok}` }
  });
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------
// Extraction
// ---------------------------------------------------------

// The ALM security message looks like:
// message = { uuid, user, time, ip, data: "{\"level\":\"INFO\",\"origin\":\"...\",\"message\":\"IdentityProviderAuthenticationSuccess ('user@x'): ... \" ...}" }
// We need to parse message, and then parse message.data (often stringified JSON)
function parseSecurityMessage(raw) {
  const msg = safeParse(raw.message) || {};
  let dataObj = null;

  if (typeof msg.data === "string" && msg.data.trim().startsWith("{")) {
    dataObj = safeParse(msg.data);
  } else if (typeof msg.data === "object" && msg.data) {
    dataObj = msg.data;
  }

  const ip     = msg.ip || raw.ip || "";
  const origin = (dataObj && dataObj.origin) || "";

  // EventType from dataObj.message prefix
  let eventType = "";
  const dataMsg = (dataObj && dataObj.message) || "";
  const typeMatch = /(IdentityProviderAuthenticationSuccess|UserAuthenticationSuccess|ClientAuthenticationSuccess|TokenIssuedEvent)/.exec(dataMsg);
  if (typeMatch) eventType = typeMatch[1];

  // User email: try in msg.user; else in the parentheses of the message; else inside claims "user_name"
  let user = firstEmail(msg.user);
  if (!user) {
    const paren = /\('([^']+@[^']+)'\)/.exec(dataMsg);
    if (paren && paren[1]) user = paren[1];
  }
  if (!user) {
    const claimsUser = /"user_name"\s*:\s*"([^"]+@[^"]+)"/.exec(dataMsg);
    if (claimsUser && claimsUser[1]) user = claimsUser[1];
  }
  user = user || "Unknown";

  // Client id: from origin or from claims (client_id / azp / cid)
  let client =
    (origin && (firstEmail(origin) ? origin : origin)) || // origin often equals technical client id
    "";
  // Prefer claims
  const mCid = /"client_id"\s*:\s*"([^"]+)"/.exec(dataMsg) ||
               /"azp"\s*:\s*"([^"]+)"/.exec(dataMsg)     ||
               /"cid"\s*:\s*"([^"]+)"/.exec(dataMsg);
  if (mCid && mCid[1]) client = mCid[1];

  // Message: compact, normalize some HTML entities
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
    client: client || "Unknown",
    message: messageText
  };
}

// ---------------------------------------------------------
// Map & merge
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
// Poller
// ---------------------------------------------------------
async function pollOnce() {
  console.log("[SEC-POLL] Fetching audit.security-events…");
  const existing = await loadState();
  const tok = await getToken();
  const fresh = await fetchSecurityLogs(tok);
  console.log(`[SEC-POLL] fetched ${fresh.length} logs.`);

  const seen = new Set();
  const merged = [];

  for (const raw of [...fresh, ...existing]) {
    const key = raw.message_uuid || `${raw.category}|${raw.time}|${raw.id || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const mapped = mapSecurityEvent(raw);
    merged.push(mapped);
    if (merged.length >= MAX_LOGS) break;
  }

  // newest → oldest
  merged.sort((a, b) => new Date(b.time) - new Date(a.time));

  await saveState(merged);
  console.log(`[SEC-POLL] Saved ${merged.length} logs to ${STATE_FILE}.`);
}

async function main() {
  await pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

main().catch(err => console.error(err));