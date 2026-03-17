// =========================================================
// full-log-poller.js — RAW INGESTION ONLY
// Pulls SAP logs → writes all_config_logs.json
// DOES NOT TOUCH ML
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

// =========================================================
// FILE PATHS
// =========================================================

const STATE_DIR = path.join(rootPath, "data");
const STATE_FILE = path.join(rootPath, "data", "all_config_logs.json");

// =========================================================
// CONFIG
// =========================================================

const POLL_TOP = 4000;
const POLL_INTERVAL_MS = 2 * 60 * 1000;

const RETENTION_DAYS = 30;
const RETENTION_MS =
  RETENTION_DAYS * 24 * 60 * 60 * 1000;

// =========================================================
// FILE HELPERS
// =========================================================

async function ensureStateFile() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try { await fs.access(STATE_FILE); }
  catch { await fs.writeFile(STATE_FILE, "[]", "utf8"); }
}

async function loadState() {
  try {
    await ensureStateFile();
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const logs = JSON.parse(raw || "[]");
    return Array.isArray(logs) ? logs : [];
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

// =========================================================
// EMAIL HELPERS
// =========================================================

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function firstEmail(s) {
  if (!s) return null;
  const m = String(s).match(EMAIL_RE);
  return m ? m[0] : null;
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

async function fetchLogs(tok) {

  const url =
    `${ALM_API_URL}/auditlog/v2/auditlogrecords` +
    `?category=audit.configuration` +
    `&$orderby=time%20desc` +
    `&$top=${POLL_TOP}`;

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${tok}` }
  });

  return Array.isArray(data) ? data : [];
}

// =========================================================
// ACTOR / TARGET
// =========================================================

function extractActor(raw) {
  const msg = safeParse(raw.message) || {};
  const attrs = msg.attributes || [];

  for (const a of attrs) {
    const e = firstEmail(a.new) || firstEmail(a.old);
    if (e) return e;
  }

  const e2 = firstEmail(msg.user);
  if (e2) return e2;

  const e3 = firstEmail(raw.user);
  if (e3) return e3;

  return "Unknown";
}

function extractTarget(raw, actor) {
  const msg = safeParse(raw.message) || {};
  const id = msg.object?.id || {};

  const e =
    firstEmail(JSON.stringify(msg)) ||
    firstEmail(JSON.stringify(id));

  if (e && e !== actor) return e;

  return "Unknown";
}

// =========================================================
// EVENT MAP
// =========================================================

function mapEvent(raw, actor, target) {

  const msg = safeParse(raw.message) || {};
  const id = msg.object?.id || {};

  let objectType = "Configuration Change";
  let action = id.crudType || "UPDATE";
  let details =
    id.description ||
    id.rolecollection_name ||
    id.role_name ||
    id.scope_name ||
    id.object_id ||
    JSON.stringify(id, null, 2);

  const isHuman =
    actor.includes("@") ||
    target.includes("@");

  return {
    objectType,
    action,
    details,
    isHuman,
    actor,
    target
  };
}

// =========================================================
// POLL RAW ONLY
// =========================================================

async function pollOnce() {

  console.log("[POLL] Monitoring audit.configuration…");

  const now = Date.now();
  const cutoff = now - RETENTION_MS;

  let existing = await loadState();

  existing = existing.filter(log => {
    const t = new Date(log.time).getTime();
    return !isNaN(t) && t >= cutoff;
  });

  const token = await getToken();
  const fresh = await fetchLogs(token);

  const merged = [...existing];
  const seen = new Set(existing.map(l => l.uuid));

  for (const raw of fresh) {

    const key = raw.message_uuid;

if (!key) continue;

    if (seen.has(key)) continue;
    seen.add(key);

    let actor = extractActor(raw);
    let target = extractTarget(raw, actor);
    const mapped = mapEvent(raw, actor, target);

    const logTime =
      new Date(raw.time).getTime();

    if (isNaN(logTime) || logTime < cutoff) continue;

    const logEvent = {
      uuid: key,
      time: raw.time,
      actor: mapped.actor,
      target: mapped.target,
      objectType: mapped.objectType,
      action: mapped.action,
      details: mapped.details,
      isHuman: mapped.isHuman,
      raw
    };

    merged.push(logEvent);
  }

  merged.sort(
    (a, b) =>
      new Date(b.time) - new Date(a.time)
  );

  await saveState(merged);

  console.log(`[POLL] Saved ${merged.length} RAW logs`);
}

// =========================================================
// RUN
// =========================================================

async function main() {
  await pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

main().catch(err => console.error(err));