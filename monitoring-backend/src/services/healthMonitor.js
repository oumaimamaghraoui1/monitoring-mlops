import os from "os";
import { PerformanceObserver } from "perf_hooks";
import * as NotificationService from "../infrastructure/notifications/NotificationService.js";
import { PythonShell } from "python-shell";

const ONE_MB = 1024 * 1024;

const state = {
 cpu: 0,
 rss:0,
 heapUsed: 0,
 heapTotal: 0,
 elLagMs: 0,
 heartbeatTs: Date.now(),
 gcTimeMs: 0,
 healthScore: 100
};

new PerformanceObserver(list=>{
 state.gcTimeMs=list.getEntries()
   .reduce((a,e)=>a+e.duration,0);
}).observe({entryTypes:["gc"]});

const SAMPLE_INTERVAL_MS=2000;
const HEALTH_ALERT_SCORE=90;
const ALERT_COOLDOWN_MS=10000;

let samplerTimer=null;
let lastLoop=process.hrtime.bigint();
let lastAlert=0;

function computeEventLoopLag(){
 const now=process.hrtime.bigint();
 const diff=Number(now-lastLoop)/1e6;
 lastLoop=now;
 return Math.max(diff-SAMPLE_INTERVAL_MS,0);
}

function computeHealthScore(){
 let score=100;
 if(state.cpu>80)score-=25;
 if(state.elLagMs>200)score-=25;
 if(state.gcTimeMs>50)score-=20;
 if((global.lastRequestLatency||0)>300)score-=30;
 return Math.max(score,0);
}

//==============================
// ✅ SMART RCA INTERPRETATION
//==============================
function interpretCauseSmart(cause){

 const map={

CPU_SATURATION:
`Runtime CPU has reached saturation.
Threads are fully occupied delaying request execution.

Immediate Action:
Scale compute resources or inspect CPU‑intensive workloads.`,

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

Immediate Action:
Scale backend processing or inspect async bottlenecks.`,

CONNECTION_SATURATION:
`Network connection throughput is saturated under current load.

Immediate Action:
Enable connection pooling or scale service instances.`,

THREAD_POOL_STARVATION:
`Worker thread pool is saturated with pending background tasks.

Immediate Action:
Reduce heavy async tasks or increase threadpool size.`

 };

 return map[cause]||"Runtime anomaly detected.";
}

//==============================
// ✅ ML RCA (ONCE)
//==============================
async function getSmartRecommendation(){

  try{

    const result = await PythonShell.run(
      process.cwd() + "/mlops/inference/rca_predict.py",
      {
        pythonPath: process.cwd() + "/mlops/venv/bin/python",
        args: [JSON.stringify({
          cpu: state.cpu,
          latency: global.lastRequestLatency || 0,
          heap_ratio: state.heapTotal > 0 ? state.heapUsed/state.heapTotal : 0,
          gc: state.gcTimeMs,
          lag: state.elLagMs,
          cpu_delta: state.cpu_delta || 0,
          lag_delta: state.lag_delta || 0,
          handle_count: state.handle_count || 0,
          handle_delta: state.handle_delta || 0,
          req_rate: state.req_rate || 0,
          resp_rate: state.resp_rate || 0
        })]
      }
    );

    if(!result || !result.length){
      console.log("⚠ ML returned empty output");
      return null;
    }
    return JSON.parse(result[0]);
  }catch(e){
    console.error("ML inference failed:", e);
    return null;
  }
}

//==============================
// ✅ ALERT ENGINE (ONE EMAIL)
//==============================
async function raiseAlert(){

 console.log("🚨 ALERT TRIGGERED");

 const ml=await getSmartRecommendation();
 const cause=ml?.cause||"UNKNOWN";
 const explanation=interpretCauseSmart(cause);

 NotificationService.notify({
   eventType:"runtime.degradation",
   severity:"HIGH",
   subject:`⚠ Runtime Health Degradation (${state.healthScore}%)`,
   body:`
🚨 Runtime Degradation Detected

Health Score: ${state.healthScore}%
CPU Usage: ${state.cpu}%
Latency: ${Math.round(global.lastRequestLatency||0)} ms
Event Loop Lag: ${state.elLagMs} ms
Heap RSS: ${Math.round(state.rss/ONE_MB)} MB
Heap Used: ${Math.round(state.heapUsed/ONE_MB)} MB

🧠 Root Cause Analysis:
${cause}

${explanation}
`,
   resource:{
     resourceName:"monitoring-backend",
     resourceType:"application"
   }
 }).catch(e=>{
   console.error("❌ NOTIFY FAILED:",e.message);
 });

}

//==============================
async function sample(){

 const now=Date.now();
 state.heartbeatTs=now;
 state.elLagMs=Math.round(computeEventLoopLag());

 const mem=process.memoryUsage();
 state.rss = mem.rss;
 state.heapUsed=mem.heapUsed;
 state.heapTotal=mem.heapTotal;

 const load=os.loadavg()[0];
 const cores=os.cpus()?.length||1;
 state.cpu=Number(((load*100)/cores).toFixed(2));
 state.healthScore=computeHealthScore();

 if(state.healthScore<HEALTH_ALERT_SCORE&&
    (now-lastAlert)>ALERT_COOLDOWN_MS){
   await raiseAlert();
   lastAlert=now;
 }
}

export function startSampling(){
 if(samplerTimer)return;
 sample();
 samplerTimer=setInterval(sample,SAMPLE_INTERVAL_MS);
}

export function startHeartbeatWatchdog(){}
export function installCrashHooks(){
 process.on("unhandledRejection",console.error);
 process.on("uncaughtException",console.error);
}
// =============================
// ✅ SNAPSHOT EXPORTS FOR METRICS.ROUTES
// =============================

export function getRuntimeSnapshot(){
 return {
  cpu: state.cpu,
  rss: state.rss,
  heapUsed: state.heapUsed,
  heapTotal: state.heapTotal,
  elLagMs: state.elLagMs,
  gcTimeMs: state.gcTimeMs,
  healthScore: state.healthScore,
  lastRequestLatency: global.lastRequestLatency || 0
 };
}

export function getEnvSnapshot(){
 return {
  NODE_ENV:process.env.NODE_ENV,
  PORT:process.env.PORT
 };
}