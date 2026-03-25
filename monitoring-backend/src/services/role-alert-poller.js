// ==============================================
// role-alert-poller.js — OBSERVABILITY FIXED
// ==============================================

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";
import fs from "fs/promises";
import { computeAnomaly } from "./anomaly-score.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(rootPath, ".env") });

const {
  ALM_USERNAME,
  ALM_PASSWORD,
  ALM_OAUTH_URL,
  ALM_API_URL,
  ANS_USERNAME,
  ANS_PASSWORD,
  ANS_API_URL
} = process.env;

// ----------------------------------------------
const POLL_TOP = 500;
const POLL_INTERVAL_MS = 2 * 60 * 1000;

const RETENTION_DAYS = 30;
const RETENTION_MS =
  RETENTION_DAYS * 24 * 60 * 60 * 1000;

// ----------------------------------------------
const STATE_DIR = path.join(rootPath, "data");
const STATE_FILE = path.join(STATE_DIR, "role_alert_state.json");

const b64 = (str) => Buffer.from(str).toString("base64");

// ----------------------------------------------
async function ensureStateFile() {
  await fs.mkdir(STATE_DIR, { recursive: true });
  try { await fs.access(STATE_FILE); }
  catch {
    await fs.writeFile(
      STATE_FILE,
      JSON.stringify({ seenIds: {}, events: [] }, null, 2),
      "utf8"
    );
  }
}

async function loadState() {
  await ensureStateFile();
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const s = JSON.parse(raw || "{}");
    return {
      seenIds: s.seenIds || {},
      events: Array.isArray(s.events) ? s.events : []
    };
  } catch {
    return { seenIds: {}, events: [] };
  }
}

async function saveState(state) {
  const tmp = STATE_FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(tmp, STATE_FILE);
}

// ----------------------------------------------
async function getAuditToken() {

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", ALM_USERNAME);
  params.append("client_secret", ALM_PASSWORD);

  const { data } = await axios.post(ALM_OAUTH_URL, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  return data.access_token;
}

// ✅ FETCH REAL LATEST LOGS
async function fetchConfigLogs(token) {

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

// ----------------------------------------------
async function sendAnsAlert({ subject, body, tags }) {

  const event = {
    eventType: "custom.security.adminRoleCollectionChanged",
    severity: "WARNING",
    category: "ALERT",
    subject,
    body,
    resource: {
      resourceName: "monitoring-backend",
      resourceType: "application"
    },
    tags
  };

  await axios.post(`${ANS_API_URL}/cf/producer/v1/resource-events`, event, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${b64(`${ANS_USERNAME}:${ANS_PASSWORD}`)}`
    }
  });

  console.log("ANS alert sent:", subject);
}

// ----------------------------------------------
async function pollOnce() {

  const state = await loadState();

  const now = Date.now();
  const cutoff = now - RETENTION_MS;

  state.events = state.events.filter(e =>
    new Date(e.when).getTime() >= cutoff
  );

  const newSeen = {};

  const token = await getAuditToken();
  const logs = await fetchConfigLogs(token);

  for (const raw of logs) {

    const logTime = new Date(raw.time).getTime();
    if (isNaN(logTime) || logTime < cutoff) continue;

    const key =
      raw.message_uuid ||
      `${raw.category}|${raw.time}|${raw.id || ""}`;

    if (state.seenIds[key]) {
      newSeen[key] = true;
      continue;
    }

    const msg = JSON.parse(raw.message || "{}");
    const obj = msg?.object?.id || {};
    const objectType = msg?.object?.type;

    const collection = obj.rolecollection_name;
    const crud = obj.crudType;

    if (!collection || !crud || !objectType) continue;

    const actor = msg?.user || raw?.user || "Unknown";

    // ✅ OBSERVABILITY PART
    const anomaly = await computeAnomaly({
      actor,
      objectType,
      time: raw.time
    });

    if (anomaly < 0.2) {
      console.log("Normal behaviour → skip alert");
      newSeen[key] = true;
      continue;
    }

    const subject =
      `⚠️ Anomalous Admin Role Activity`;

    const body =
      `Actor: ${actor}
Time: ${raw.time}
Collection: ${collection}
Change: ${crud}
SAP Object: ${objectType}
Anomaly Score: ${anomaly}`;

  

    // ✅ Avoid duplicate anomalies
const alreadyStored =
  state.events.find(e => e.id === key);

if (!alreadyStored) {

  state.events.unshift({
    id: key,
    when: raw.time,
    collection,
    crud,
    actor,
    anomaly,
    ansSentAt: new Date().toISOString()
  });

}

    newSeen[key] = true;
  }

  state.seenIds = newSeen;
  await saveState(state);
}

// ----------------------------------------------
async function main() {
  console.log("Role alert poller started.");
  await pollOnce();
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

main().catch(err => console.error(err));