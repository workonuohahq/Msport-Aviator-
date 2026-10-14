const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 10000);
const ROOT = path.join(__dirname, "public");
const MODE = process.env.DATA_SOURCE_MODE || "demo";
const DB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const DB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const INGEST_KEY = process.env.INGESTION_API_KEY || "";
const TARGETS = [1.2, 1.5, 2, 3, 5, 10];
const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".svg":"image/svg+xml" };
const SELECT = "provider,game_code,external_round_id,round_ended_at,crash_multiplier,source,source_verified,round_hash,server_hash,collected_at";

function send(res, status, body) {
  res.writeHead(status, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" });
  res.end(JSON.stringify(body));
}
function headers(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
}
async function db(table, { method="GET", query={}, body, prefer } = {}) {
  if (!DB_URL || !DB_KEY) throw new Error("database_not_configured");
  const url = new URL(DB_URL + "/rest/v1/" + table);
  Object.entries(query).forEach(([k,v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { method, headers: { apikey:DB_KEY, Authorization:"Bearer "+DB_KEY, "Content-Type":"application/json", ...(prefer?{Prefer:prefer}:{}) }, ...(body===undefined?{}:{body:JSON.stringify(body)}), signal:AbortSignal.timeout(8000) });
  const raw = await r.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!r.ok) { const e = new Error("database_request_failed"); e.status=r.status; e.details=data?.message||data?.hint||"Database request failed"; throw e; }
  return data;
}
const configured = () => Boolean(DB_URL && DB_KEY);
async function rounds(limit=1000) {
  return db("game_rounds", { query:{ select:SELECT, source_verified:"eq.true", order:"round_ended_at.desc.nullslast,created_at.desc", limit:Math.min(2000,Math.max(1,limit)) } });
}
function wilson(k,n,z=1.96) {
  if (!n) return {low:null,high:null};
  const p=k/n, d=1+z*z/n, c=(p+z*z/(2*n))/d, m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return {low:Math.max(0,c-m),high:Math.min(1,c+m)};
}
function estimates(data) {
  return TARGETS.map(target => {
    const hits=data.filter(r=>Number(r.crash_multiplier)>=target).length, n=data.length, p=hits/n, ci=wilson(hits,n);
    return {target,probability:p,percent:Number((p*100).toFixed(2)),interval95Percent:{low:Number((ci.low*100).toFixed(2)),high:Number((ci.high*100).toFixed(2))},successes:hits,sampleSize:n,basis:"observed_verified_history",forecast:false};
  });
}

function logLoss(p, y) {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return -(y ? Math.log(q) : Math.log(1 - q));
}
function walkForwardValidation(input) {
  const data = input.filter(r => r.round_ended_at && Number.isFinite(Date.parse(r.round_ended_at)))
    .slice().sort((a,b) => Date.parse(a.round_ended_at) - Date.parse(b.round_ended_at));
  const minimumTraining = 100;
  if (data.length <= minimumTraining) return {
    eligible: false, minimumTrainingRounds: minimumTraining, timestampedVerifiedRounds: data.length,
    message: "At least 101 timestamped verified rounds are required for this walk-forward check.", rows: []
  };
  const rows = TARGETS.map(target => {
    let modelBrier=0, baselineBrier=0, modelLogLoss=0, baselineLogLoss=0, count=0;
    for (let i=minimumTraining; i<data.length; i++) {
      const current = data[i];
      const y = Number(current.crash_multiplier) >= target ? 1 : 0;
      const window = data.slice(Math.max(0, i-500), i);
      const rollingHits = window.reduce((s,r)=>s+(Number(r.crash_multiplier)>=target?1:0),0);
      const priorHits = data.slice(0,i).reduce((s,r)=>s+(Number(r.crash_multiplier)>=target?1:0),0);
      const p = (rollingHits+1)/(window.length+2);
      const baseline = (priorHits+1)/(i+2);
      modelBrier += (p-y)**2;
      baselineBrier += (baseline-y)**2;
      modelLogLoss += logLoss(p,y);
      baselineLogLoss += logLoss(baseline,y);
      count++;
    }
    const mb=modelBrier/count, bb=baselineBrier/count, ml=modelLogLoss/count, bl=baselineLogLoss/count;
    return {target, evaluatedRounds:count, rolling500Brier:Number(mb.toFixed(6)), expandingBaselineBrier:Number(bb.toFixed(6)), brierImprovement:Number((bb-mb).toFixed(6)), rolling500LogLoss:Number(ml.toFixed(6)), expandingBaselineLogLoss:Number(bl.toFixed(6)), logLossImprovement:Number((bl-ml).toFixed(6)), testStart:data[minimumTraining].round_ended_at, testEnd:data[data.length-1].round_ended_at, interpretation:"Positive improvement means the rolling-frequency estimator scored better on this historical walk-forward sample; it is not proof of a durable edge."};
  });
  return {eligible:true,method:"chronological walk-forward; first 100 rounds for warm-up; rolling window up to 500; Beta(1,1) smoothing",timestampedVerifiedRounds:data.length,minimumTrainingRounds:minimumTraining,testRounds:data.length-minimumTraining,rows,warning:"Retrospective walk-forward results can still overfit through repeated model selection. Preserve a final untouched holdout and run prospective paper testing before making predictive claims."};
}

function validateRound(r) {
  if (!r || typeof r!=="object" || Array.isArray(r)) return "Each round must be an object.";
  if (!String(r.round_id??"").trim() || String(r.round_id).length>160) return "round_id is required (max 160 characters).";
  const m=Number(r.multiplier);
  if (!Number.isFinite(m)||m<1||m>1000000) return "multiplier must be between 1 and 1,000,000.";
  if (r.ended_at!=null&&!Number.isFinite(Date.parse(r.ended_at))) return "ended_at must be a valid date/time.";
  for (const k of ["round_hash","server_hash"]) if (r[k]!=null&&(typeof r[k]!=="string"||r[k].length>512)) return k+" must be a string (max 512 characters).";
  return null;
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let size=0; const chunks=[];
    req.on("data",chunk=>{size+=chunk.length;if(size>262144){reject(Object.assign(new Error("payload_too_large"),{status:413}));req.destroy();return;}chunks.push(chunk);});
    req.on("end",()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch{reject(Object.assign(new Error("invalid_json"),{status:400}));}});
    req.on("error",reject);
  });
}
function staticFile(res, pathname) {
  const relative=pathname==="/"?"index.html":pathname.replace(/^\/+/, "");
  const target=path.resolve(ROOT,relative);
  if (!target.startsWith(ROOT+path.sep)) {res.writeHead(403);return res.end("Forbidden");}
  fs.readFile(target,(err,data)=>{if(err){res.writeHead(404);return res.end("Not found");}res.writeHead(200,{"Content-Type":MIME[path.extname(target)]||"application/octet-stream"});res.end(data);});
}
async function route(req,res) {
  const url=new URL(req.url,"http://"+(req.headers.host||"localhost"));
  if(req.method==="GET"&&url.pathname==="/health") {
    let database="not_configured";
    if(configured()){try{await db("game_rounds",{query:{select:"id",limit:1}});database="connected";}catch{database="unreachable";}}
    return send(res,database==="unreachable"?503:200,{ok:database!=="unreachable",service:"msport-aviator-engine",mode:MODE,database,liveProviderConnected:false,timestamp:new Date().toISOString()});
  }
  if(req.method==="GET"&&url.pathname==="/api/status") {
    let database=configured()?"unverified":"not_configured", n=0, last=null;
    if(configured()){try{const r=await rounds(2000);database="connected";n=r.length;last=r[0]?.round_ended_at||null;}catch{database="unreachable";}}
    return send(res,200,{service:"MSport Aviator Statistical Engine",mode:MODE,database,sourceConnected:false,sourceStatus:"not_configured",predictionStatus:n>=100?"historical_estimates_available":"insufficient_verified_history",accuracyClaim:null,lastRoundAt:last,notes:["No authorised MSport/Scribe live feed has been verified or configured.","Only operator-marked verified rounds are included in empirical estimates.","Historical frequencies describe the supplied sample; they do not predict the next round."]});
  }
  if(req.method==="GET"&&url.pathname==="/api/overview") {
    if(!configured())return send(res,200,{roundsStored:0,verifiedRounds:0,sourceConnected:false,model:"empirical-history-only",lastUpdate:null,mode:MODE,database:"not_configured"});
    try{const r=await rounds(2000);return send(res,200,{roundsStored:r.length,verifiedRounds:r.length,sourceConnected:false,model:"empirical-history-only",lastUpdate:r[0]?.round_ended_at||null,mode:MODE,database:"connected",minimumSampleRecommended:1000,sampleAdequateForStrongClaims:r.length>=1000});}
    catch(e){return send(res,503,{error:"database_unavailable",message:"Database read failed; check server logs."});}
  }
  if(req.method==="GET"&&url.pathname==="/api/rounds") {
    if(!configured())return send(res,200,{data:[],count:0,sourceConnected:false,message:"Database not configured; no round data stored."});
    const limit=Number(url.searchParams.get("limit")||50);
    if(!Number.isInteger(limit)||limit<1||limit>2000)return send(res,400,{error:"invalid_limit",message:"limit must be an integer from 1 to 2000."});
    try{const data=await rounds(limit);return send(res,200,{data,count:data.length,sourceConnected:false,message:"Verified historical records only; live provider feed is not connected."});}
    catch(e){return send(res,503,{error:"database_unavailable",message:"Database read failed; check server logs."});}
  }
  if(req.method==="GET"&&url.pathname==="/api/probabilities") {
    if(!configured())return send(res,200,{assumptions:{verifiedForMsport:false},rows:[],warning:"No verified historical data is available. No probability estimate is being presented."});
    try{const data=await rounds(2000);if(data.length<30)return send(res,200,{assumptions:{verifiedForMsport:false,sampleSize:data.length},rows:[],warning:"Only "+data.length+" verified rounds are available. Collect more trustworthy history first."});return send(res,200,{assumptions:{verifiedForMsport:true,sourceConnected:false,sampleSize:data.length},rows:estimates(data),warning:"Observed frequencies with 95% Wilson intervals—not next-round forecasts or a guarantee of future results."});}
    catch(e){return send(res,503,{error:"database_unavailable",rows:[],warning:"Database read failed; check server logs."});}
  }
  if(req.method==="GET"&&url.pathname==="/api/validation") {
    if(!configured())return send(res,200,{eligible:false,message:"Database not configured; validation requires verified historical rounds.",rows:[]});
    try{const data=await rounds(2000);return send(res,200,walkForwardValidation(data));}
    catch(e){return send(res,503,{error:"database_unavailable",message:"Database read failed; check server logs.",rows:[]});}
  }
  if(req.method==="GET"&&url.pathname==="/api/alerts") {
    const alerts=[];
    if(!configured())alerts.push({type:"database",severity:"warning",title:"Database not connected",message:"Set server-only Supabase credentials before storing round history.",createdAt:new Date().toISOString()});
    alerts.push({type:"provider",severity:"warning",title:"Live results feed not connected",message:"No authorised MSport/Scribe results feed has been verified. This is not a live prediction service.",createdAt:new Date().toISOString()});
    if(configured()){try{const r=await rounds(1);if(!r.length)alerts.push({type:"sample",severity:"warning",title:"No verified rounds",message:"No verified round history is available yet.",createdAt:new Date().toISOString()});else if(Date.now()-Date.parse(r[0].round_ended_at||r[0].collected_at)>3600000)alerts.push({type:"freshness",severity:"warning",title:"Historical data may be stale",message:"Latest verified record is over one hour old; this alone does not prove provider outage.",createdAt:new Date().toISOString()});}catch{alerts.push({type:"database",severity:"critical",title:"Database read failed",message:"Could not read round history. Check service and database logs.",createdAt:new Date().toISOString()});}}
    return send(res,200,{alerts,count:alerts.length});
  }
  if(req.method==="POST"&&url.pathname==="/api/ingest/rounds") {
    if(!INGEST_KEY||!configured())return send(res,503,{error:"ingestion_not_configured",message:"Protected ingestion requires server-only database credentials and an ingestion API key."});
    const key=req.headers["x-ingestion-key"];
    if(typeof key!=="string"||key.length!==INGEST_KEY.length||!crypto.timingSafeEqual(Buffer.from(key),Buffer.from(INGEST_KEY)))return send(res,401,{error:"unauthorized",message:"Invalid ingestion key."});
    let body;try{body=await readBody(req);}catch(e){return send(res,e.status||400,{error:e.message,message:e.status===413?"Payload too large.":"Body must be valid JSON."});}
    if(!body||!Array.isArray(body.rounds)||body.rounds.length<1||body.rounds.length>500)return send(res,400,{error:"invalid_rounds",message:"rounds must contain 1 to 500 records."});
    const source=typeof body.source==="string"?body.source.trim().slice(0,80):"";
    if(!source)return send(res,400,{error:"source_required",message:"Provide a source label for auditability."});
    for(const r of body.rounds){const issue=validateRound(r);if(issue)return send(res,400,{error:"invalid_round",message:issue});}
    const verified=body.source_verified===true;
    const rows=body.rounds.map(r=>({provider:"msport",game_code:"aviator",external_round_id:String(r.round_id).trim(),round_ended_at:r.ended_at?new Date(r.ended_at).toISOString():null,crash_multiplier:Number(Number(r.multiplier).toFixed(4)),source,source_verified:verified,round_hash:r.round_hash||null,server_hash:r.server_hash||null,raw_payload:{ingestion_method:"protected_api",supplied_by_operator:true}}));
    let runId=null;
    try {
      const run=await db("ingestion_runs",{method:"POST",prefer:"return=representation",body:{source,rounds_received:rows.length,rounds_inserted:0,status:"running"}});
      runId=Array.isArray(run)?run[0]?.id:null;
      const saved=await db("game_rounds",{method:"POST",query:{on_conflict:"provider,game_code,external_round_id"},prefer:"resolution=ignore-duplicates,return=representation",body:rows});
      const inserted=Array.isArray(saved)?saved.length:0;
      if(runId!==null)await db("ingestion_runs",{method:"PATCH",query:{id:"eq."+runId},prefer:"return=minimal",body:{finished_at:new Date().toISOString(),rounds_inserted:inserted,status:"success"}});
      return send(res,201,{ok:true,received:rows.length,inserted,duplicates:rows.length-inserted,source,sourceVerified:verified,ingestionRunId:runId,note:verified?"Operator marked batch verified; independently confirm provenance.":"Stored as unverified and excluded from estimates."});
    } catch(e) {
      if(runId!==null)try{await db("ingestion_runs",{method:"PATCH",query:{id:"eq."+runId},prefer:"return=minimal",body:{finished_at:new Date().toISOString(),status:"failed",error_message:String(e.details||e.message||"Database write failed.").slice(0,1000)}});}catch{}
      return send(res,502,{error:"ingestion_failed",message:"Database write failed; check server logs."});
    }
  }
  if(req.method==="GET")return staticFile(res,url.pathname);
  res.setHeader("Allow","GET, POST");return send(res,405,{error:"method_not_allowed"});
}
http.createServer((req,res)=>{headers(res);route(req,res).catch(e=>{console.error("request_failed",{path:req.url,message:e.message,details:e.details||undefined});if(!res.headersSent)send(res,500,{error:"internal_error",message:"Request could not be completed."});else res.end();});}).listen(PORT,"0.0.0.0",()=>console.log("Aviator engine listening on "+PORT+"; mode="+MODE));
