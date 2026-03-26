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
  rss: 0,
  elLagMs: 0,
  uptimeSec: 0,
  heartbeatTs: Date.now(),
  gcTimeMs: 0,
  healthScore: 100,

  cpu_delta: 0,
  lag_delta: 0,
  heap_ratio: 0,
  handle_count: 0,
  handle_delta: 0,
  req_rate: 0,
  resp_rate: 0
};

let previous = {
  cpu: 0,
  lag: 0,
  heapUsed: 0,
  handles: 0
};

// =============================
if(process.env.NODE_ENV!=="production"){
  new PerformanceObserver(list=>{
    state.gcTimeMs=list.getEntries()
      .reduce((a,e)=>a+e.duration,0);
  }).observe({entryTypes:["gc"]});
}

const SAMPLE_INTERVAL_MS=2000;
const HEARTBEAT_CHECK_MS=5000;
const MAX_STALE_SEC=20;
const HEALTH_ALERT_SCORE=90;
const ALERT_COOLDOWN_MS=10000;

let samplerTimer=null;
let heartbeatTimer=null;
let lastLoop=process.hrtime.bigint();
const alertWindow={lastHealth:0};

// =============================
function computeEventLoopLag(){
  const now=process.hrtime.bigint();
  const diff=Number(now-lastLoop)/1e6;
  lastLoop=now;
  return Math.max(diff-SAMPLE_INTERVAL_MS,0);
}

function computeHealthScore(){
  let score=100;
  if(state.cpu>80) score-=25;
  if(state.elLagMs>200) score-=25;
  if(state.gcTimeMs>50) score-=20;
  if((global.lastRequestLatency||0)>300) score-=30;
  return Math.max(score,0);
}

// =============================
// 🔥 HUMAN SMART RCA PHRASES
// =============================
function interpretCauseSmart(cause){

  const map = {

CPU_SATURATION:
`Runtime CPU has reached saturation.
Threads are fully occupied delaying request execution.

Immediate Action:
Scale compute resources or investigate CPU‑intensive workloads.`,

MEMORY_PRESSURE:
`Memory allocation is growing faster than it can be reclaimed.
Garbage collection may not be keeping up with allocation rate.

Immediate Action:
Inspect memory leaks or restart service instance.`,

DEPENDENCY_LATENCY:
`External service dependency is responding slower than normal.

Immediate Action:
Check upstream APIs or downstream dependencies.`,

QUERY_LATENCY:
`Database queries are taking longer than expected.

Immediate Action:
Inspect slow queries or DB locking.`,

REQUEST_BACKLOG:
`Incoming request rate exceeds system processing capacity.
Requests are accumulating internally faster than they are served.

Immediate Action:
Scale backend processing or inspect async bottlenecks.`,

CONNECTION_SATURATION:
`Network connection throughput is saturated under current load.

Immediate Action:
Enable connection pooling or scale service instances.`,

THREAD_POOL_STARVATION:
`Worker thread pool is saturated with pending background tasks.

Immediate Action:
Reduce heavy async tasks or increase threadpool size.`,

ASYNC_OVERFLOW:
`Internal asynchronous job queue is overloaded.

Immediate Action:
Investigate promise storms or excessive background jobs.`,

FS_LOCK_CONTENTION:
`Concurrent disk/file operations are blocking each other.

Immediate Action:
Review filesystem operations.`,

SCHEDULER_STARVATION:
`Event loop scheduling delay detected due to timer backlog.

Immediate Action:
Check long‑running timers or callbacks.`
  };

  return map[cause] || "Runtime anomaly detected.";
}

// =============================
// ✅ USE ALL TRAINED FEATURES
// =============================
async function getSmartRecommendation(){

  try{
    const pyshell=new PythonShell(
      process.cwd()+"/mlops/inference/rca_predict.py",
      {
        args:[
JSON.stringify({
cpu:state.cpu,
latency:global.lastRequestLatency||0,
heap_ratio:state.heap_ratio||0,
gc:state.gcTimeMs,
lag:state.elLagMs,
cpu_delta:state.cpu_delta||0,
lag_delta:state.lag_delta||0,
handle_count:state.handle_count||0,
handle_delta:state.handle_delta||0,
req_rate:state.req_rate||0,
resp_rate:state.resp_rate||0
})
        ]
      }
    );
    const result=await new Promise((r,j)=>{
      pyshell.on("message",r);
      pyshell.on("error",j);
    });

    return JSON.parse(result);

  }catch(e){
    console.error("RCA inference error:",e);
    return null;
  }
}

// =============================
export function logIncident(cause){

if(process.env.NODE_ENV==="production" &&
   process.env.ALLOW_INCIDENT_LOGGING!=="true")
  return;
const file=path.resolve(
process.cwd(),
"mlops/data/rca/incidents_log.csv"
);

const row=
`${state.cpu},${global.lastRequestLatency||0},${state.heap_ratio||0},${state.gcTimeMs},${state.elLagMs},${state.cpu_delta||0},${state.lag_delta||0},${state.handle_count||0},${state.handle_delta||0},${state.req_rate||0},${state.resp_rate||0},${cause}\n`;

fs.appendFileSync(file,row);
}

// =============================
async function raiseAlert(type,message,severity="MEDIUM"){
  console.log("🚧 BEFORE RCA CALL");

const ml=await getSmartRecommendation();
console.log("✅ AFTER RCA CALL");

// ✅ always log real incidents if RCA identifies cause
if(ml && ml.cause !== "UNKNOWN"){
  logIncident(ml.cause);
}


NotificationService.notify({
eventType:"runtime.degradation",
severity,
subject:`⚠ Runtime Health Degradation (${state.healthScore}%)`,
body:`
🚨 Runtime Degradation Detected

Health Score: ${state.healthScore}%
CPU Usage: ${state.cpu}%
Latency: ${Math.round(global.lastRequestLatency||0)} ms
Event Loop Lag: ${state.elLagMs} ms
Heap RSS: ${Math.round(state.rss/ONE_MB)} MB

Root Cause Analysis:

${interpretCauseSmart(ml?.cause)}
`,
tags:{
alertType:type
},
resource:{
resourceName:"monitoring-backend",
resourceType:"application"
}
}).catch(()=>{});
}

// =============================
async function sample(){

global.reqCount=(global.reqCount||0)+1;
state.req_rate=global.reqCount/SAMPLE_INTERVAL_MS;
state.resp_rate=(global.respCount||0)/SAMPLE_INTERVAL_MS;

const handles=process._getActiveHandles().length;
state.handle_count=handles;
state.handle_delta=handles-(previous.handles||0);
previous.handles=handles;

const now=Date.now();
state.uptimeSec=Math.floor(process.uptime());
state.heartbeatTs=now;

state.elLagMs=Math.round(computeEventLoopLag());
const mem=process.memoryUsage();
state.heapUsed=mem.heapUsed;
state.heapTotal=mem.heapTotal;
state.rss=mem.rss;

const load=os.loadavg()[0];
const cores=os.cpus()?.length||1;

state.cpu=Math.min(
100,
Number(((load*100)/cores).toFixed(2))
);

state.cpu_delta=state.cpu-previous.cpu;
state.lag_delta=state.elLagMs-previous.lag;
state.heap_ratio=
state.heapTotal>0
?state.heapUsed/state.heapTotal
:0;

previous.cpu=state.cpu;
previous.lag=state.elLagMs;
previous.heapUsed=state.heapUsed;

state.healthScore=computeHealthScore();

if(state.healthScore < HEALTH_ALERT_SCORE){

  if((now - alertWindow.lastHealth) >
     ALERT_COOLDOWN_MS){

    await raiseAlert(
      "HEALTH_DEGRADATION",
      `Health score dropped to ${state.healthScore}%`
    );

    alertWindow.lastHealth = now;
  }
}
else{
  // ✅ health recovered → allow future alerts
  alertWindow.lastHealth = 0;
}
}

export function startSampling(){
if(samplerTimer)return;
sample();
samplerTimer=
setInterval(sample,SAMPLE_INTERVAL_MS);
}

export function startHeartbeatWatchdog(){
if(heartbeatTimer)return;

heartbeatTimer=setInterval(async()=>{
const delta=
(Date.now()-state.heartbeatTs)/1000;

if(delta>MAX_STALE_SEC){
await raiseAlert(
"PROCESS_STALL",
`No heartbeat for ${Math.round(delta)}s`
);
}
},HEARTBEAT_CHECK_MS);
}

export function startMonitoringEngine(){
startSampling();
startHeartbeatWatchdog();
}
// =============================
// METRICS EXPORTS (needed by dashboard)
// =============================
export function getRuntimeSnapshot(){
  return {...state};
}

export function getEnvSnapshot(){
  return {...process.env};
}
// =============================
// CRASH HOOKS (needed by server.js)
// =============================
export function installCrashHooks(){

  process.on("unhandledRejection",(reason)=>{
    console.error("[SAFE UNHANDLED REJECTION]",reason);
  });

  process.on("uncaughtException",(err)=>{
    console.error("[SAFE UNCAUGHT EXCEPTION]",err);
  });

}