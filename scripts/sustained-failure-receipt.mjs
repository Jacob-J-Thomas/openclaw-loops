import {sanitizeGatewayReadiness} from './gateway-readiness-evidence.mjs';

const descriptions={
  'gateway-startup':'The gateway did not become ready.',
  'client-startup':'The gateway client did not become ready.',
  'gateway-request':'A gateway request did not complete.',
  assertion:'A sustained-workload assertion failed.',
  system:'A sustained-workload system operation failed.',
  unexpected:'The sustained workload failed unexpectedly.',
};
const knownFailures=new Map([
  ['Gateway did not listen.','The Gateway listening deadline expired.'],
  ['Gateway exited before listening.','The Gateway process exited before readiness.'],
  ['Gateway client startup timed out.','The Gateway client connection deadline expired.'],
  ['Gateway client worker exited before ready.','The Gateway client process exited before readiness.'],
  ['Client worker exited.','The Gateway client process exited during an operation.'],
  ['Gateway request timed out: sessions.create','The session creation request deadline expired.'],
  ['Gateway request timed out: plugins.sessionAction','The plugin session-action request deadline expired.'],
]);

const text=(value,key)=>{
  try{const candidate=value?.[key];return typeof candidate==='string'?candidate:'';}catch{return '';}
};
const numeric=(value,key)=>{
  try{const candidate=value?.[key];return typeof candidate==='number'?candidate:undefined;}catch{return undefined;}
};
const number=(value,maximum)=>Number.isSafeInteger(value)&&value>=0&&value<=maximum?value:0;
const states=new Set(['alive','exited','signaled','unavailable']);
const timingPhases=new Set(['socket-open','challenge','connect-plan-ready','request-sent','hello','failed','fallback','unknown']);
const read=(value,key)=>{try{return value?.[key];}catch{return undefined;}};
const state=value=>states.has(value)?value:'unavailable';
const timing=value=>{const phase=read(value,'phase'),generation=read(value,'generation'),durationMs=read(value,'durationMs'),phaseDurationMs=read(value,'phaseDurationMs'),hasChallenge=read(value,'hasChallenge'),usedFallback=read(value,'usedFallback');return {phase:timingPhases.has(phase)?phase:'unknown',generation:number(generation,Number.MAX_SAFE_INTEGER),durationMs:number(durationMs,Number.MAX_SAFE_INTEGER),phaseDurationMs:number(phaseDurationMs,Number.MAX_SAFE_INTEGER),hasChallenge:hasChallenge===true,usedFallback:usedFallback===true};};

export function sanitizeSustainedClientStartup(value){
  if(!value||typeof value!=='object')return;
  const entries=read(value,'timings'),timings=[];
  if(Array.isArray(entries))for(const entry of entries.slice(0,8))timings.push(timing(entry));
  return {restartOrdinal:number(read(value,'restartOrdinal'),5),budgetMs:number(read(value,'budgetMs'),15*60*1000),listening:read(value,'listening')===true,gatewayProcessState:state(read(value,'gatewayProcessState')),clientProcessState:state(read(value,'clientProcessState')),elapsedMs:number(read(value,'elapsedMs'),Number.MAX_SAFE_INTEGER),timings};
}

export function sustainedFailureCategory(error){
  const code=text(error,'code'),message=text(error,'message');
  if(message==='Gateway exited before listening.'||message==='Gateway did not listen.')return 'gateway-startup';
  if(message==='Gateway client startup timed out.'||message==='Gateway client worker exited before ready.'||message==='Client worker exited.')return 'client-startup';
  if(message==='Gateway request timed out: sessions.create'||message==='Gateway request timed out: plugins.sessionAction')return 'gateway-request';
  if(code==='ERR_ASSERTION'||text(error,'name')==='AssertionError')return 'assertion';
  if(['EACCES','EADDRINUSE','ECONNREFUSED','ECONNRESET','EIO','ENOENT','ENOSPC','EPERM','ETIMEDOUT'].includes(code)||numeric(error,'status')!==undefined||text(error,'signal'))return 'system';
  return 'unexpected';
}

export function sustainedFailureReceipt({phase,code,archiveSha256,error,elapsedMs,completeRuns,parkedRuns,runCount,readiness,clientStartup}){
  const category=sustainedFailureCategory(error);
  const safeReadiness=sanitizeGatewayReadiness(readiness);
  const safeClientStartup=sanitizeSustainedClientStartup(clientStartup);
  return {
    status:'failed',
    phase,
    code,
    category,
    message:knownFailures.get(text(error,'message'))??descriptions[category],
    archiveSha256,
    noModelCalls:true,
    progress:{elapsedMs:number(elapsedMs,Number.MAX_SAFE_INTEGER),completeRuns:number(completeRuns,number(runCount,256)),parkedRuns:number(parkedRuns,16)},
    ...(safeReadiness?{readiness:safeReadiness}:{}),
    ...(safeClientStartup?{clientStartup:safeClientStartup}:{})
  };
}
