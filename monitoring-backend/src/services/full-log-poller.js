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

const STATE_DIR  = path.join(rootPath,"data");
const STATE_FILE = path.join(rootPath,"data","all_config_logs.json");

const POLL_TOP         = 500;
const POLL_INTERVAL_MS = 2 * 60 * 1000;

// =========================================================
// FILE HELPERS
// =========================================================

async function ensureStateFile(){
  await fs.mkdir(STATE_DIR,{recursive:true});
  try{ await fs.access(STATE_FILE); }
  catch{ await fs.writeFile(STATE_FILE,"[]","utf8"); }
}

async function loadState(){
  await ensureStateFile();
  const raw = await fs.readFile(STATE_FILE,"utf8");
  const logs = JSON.parse(raw||"[]");
  return Array.isArray(logs)?logs:[];
}

async function saveState(logs){
  const tmp = STATE_FILE+".tmp";
  await fs.writeFile(tmp,JSON.stringify(logs,null,2));
  await fs.rename(tmp,STATE_FILE);
}

// =========================================================
// TOKEN
// =========================================================

async function getToken(){

  const params = new URLSearchParams({
    grant_type:"client_credentials",
    client_id:ALM_USERNAME,
    client_secret:ALM_PASSWORD
  });

  const {data} = await axios.post(ALM_OAUTH_URL,params,{
    headers:{ "Content-Type":"application/x-www-form-urlencoded" }
  });

  return data.access_token;
}

// =========================================================
// ✅ IAS FETCH (REAL FIX HERE)
// =========================================================

async function fetchLogs(tok){

  const url =
  `${ALM_API_URL}/auditlog/v2/auditlogrecords` +
  `?category=audit.configuration` +
  `&$orderby=time%20desc` +
  `&$top=${POLL_TOP}`;

  const {data} = await axios.get(url,{
    headers:{ Authorization:`Bearer ${tok}` }
  });

  return Array.isArray(data)?data:[];
}

// =========================================================
// ✅ IAS SAFE CLASSIFIER (UI ONLY)
// DOES NOT TOUCH RAW → ML SAFE
// =========================================================

function classifyAuditEvent(raw){

  const actor = raw.user || "";

  let parsed;
  try{
    parsed = JSON.parse(raw.message);
  }catch(e){
    return {
      objectType:"Configuration Change",
      action:"UPDATE",
      details:"Technical event",
      target:"TechnicalResource",
      isHuman:false
    };
  }

  const typeFromObject = parsed?.object?.type;
  const tableName      = parsed?.object?.id?.tableName;
  const crud           = parsed?.object?.id?.crudType;

  // ✅ ROLE ASSIGNMENT (THIS WAS MISSING)
  if(
  typeFromObject === "xs_rolecollection2user" ||
  tableName === "xs_rolecollection2user"
){

  const role =
    parsed?.object?.id?.rolecollection_name || "Role";

  return {
    objectType:"Role Assignment",
    action:crud || "CREATE",
    details:`Assigned role: ${role}`,
    target:role,
    isHuman:true
  };
}

  // ✅ HUMAN USER UPDATE
  if(actor.startsWith("user/") || actor.includes("@")){
    return {
      objectType:"User Profile Update",
      action:crud || "UPDATE",
      details:"User identity updated",
      target:"[Identity]",
      isHuman:true
    };
  }

  // ✅ SYSTEM EVENT
  return {
    objectType:"Configuration Change",
    action:crud || "UPDATE",
    details:"Technical configuration",
    target:"TechnicalResource",
    isHuman:false
  };
}

// =========================================================
// ML PIPELINE (UNCHANGED)
// =========================================================

function runMLPipeline(){

  const python = path.join(rootPath,"mlops/venv/bin/python");

  spawn(python,["mlops/pipelines/01_normalize_logs.py"],{cwd:rootPath,detached:true,stdio:"ignore"}).unref();
  spawn(python,["mlops/pipelines/02_build_features.py"],{cwd:rootPath,detached:true,stdio:"ignore"}).unref();
  spawn(python,["mlops/inference/score_event.py"],{cwd:rootPath,detached:true,stdio:"ignore"}).unref();

  console.log("[ML] FULL RETRAIN PIPELINE TRIGGERED");
}

// =========================================================
// POLLER
// =========================================================

async function pollOnce(){

  console.log("[POLL] Monitoring audit.configuration…");

  let existing = await loadState();
  const token = await getToken();
  const fresh = await fetchLogs(token);

  console.log(`[POLL] Pulled ${fresh.length} fresh logs`);

  const merged = [...existing];
  const seen = new Set(existing.map(l=>l.uuid));

  for(const raw of fresh){

    if(!raw.message_uuid) continue;
    if(seen.has(raw.message_uuid)) continue;

    seen.add(raw.message_uuid);

    const iam = classifyAuditEvent(raw);

    merged.push({
      uuid:raw.message_uuid,
      time:raw.time,
      actor:raw.user,
      objectType:iam.objectType,
      action:iam.action,
      details:iam.details,
      target:iam.target,
      isHuman:iam.isHuman,
      raw
    });
  }

  merged.sort((a,b)=>new Date(b.time)-new Date(a.time));

  await saveState(merged);

  console.log(`[POLL] Saved ${merged.length} logs`);

  runMLPipeline();
}

async function main(){
  await pollOnce();
  setInterval(pollOnce,POLL_INTERVAL_MS);
}

main().catch(console.error);