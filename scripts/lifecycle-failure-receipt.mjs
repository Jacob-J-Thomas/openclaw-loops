import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sanitizeGatewayReadiness} from './gateway-readiness-evidence.mjs';

const phases=new Set(['archive-validation','install-previous','backup-previous','upgrade','uninstall-reinstall','matching-predecessor-restore']);
const operations=new Set(['archive-validation','installer','installed-file-validation','gateway-readiness','sdk-client-startup','public-session-actions','client-shutdown','gateway-shutdown','profile-backup','profile-restore','state-validation','host-state-migration','rollback-staging','receipt-write','unknown']);
const outcomes=new Set(['completed','failed','timed-out','not-started']);
const processStates=new Set(['alive','exited','signaled','unavailable']);
const clientMilestonePhases=['worker-entry','sdk-imported','client-started'];
const descriptions={
  'storage-full':'Lifecycle storage capacity was exhausted.',
  'permission-denied':'Lifecycle access was denied by the operating system.',
  'required-file-missing':'A required lifecycle file was unavailable.',
  timeout:'A lifecycle operation timed out.',
  connection:'A lifecycle connection failed.',
  invariant:'A lifecycle verification invariant failed.',
  'subprocess-exit':'A lifecycle subprocess exited unsuccessfully.',
  unexpected:'Lifecycle verification failed unexpectedly.',
};
const own=(value,key)=>{
  if(!value||typeof value!=='object')return undefined;
  try{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&'value' in descriptor?descriptor.value:undefined;}catch{return undefined;}
};
const clean=(value,pattern)=>typeof value==='string'&&pattern.test(value)?value:'unknown';
const elapsed=value=>Number.isSafeInteger(value)&&value>=0&&value<=86_400_000?value:0;
const ordinal=value=>Number.isSafeInteger(value)&&value>=0&&value<=128?value:0;
const validElapsed=value=>Number.isSafeInteger(value)&&value>=0&&value<=86_400_000;
const clientMilestone=(value,expected,previous)=>{
  const phase=own(value,'phase'),sequence=own(value,'sequence');
  const workerElapsedMs=own(value,'workerElapsedMs'),receivedElapsedMs=own(value,'receivedElapsedMs');
  if(phase!==clientMilestonePhases[expected]||sequence!==expected||!validElapsed(workerElapsedMs)||!validElapsed(receivedElapsedMs))return;
  if(previous&&(workerElapsedMs<previous.workerElapsedMs||receivedElapsedMs<previous.receivedElapsedMs))return;
  return {phase,sequence,workerElapsedMs,receivedElapsedMs};
};
const clientMilestones=value=>{
  if(!Array.isArray(value))return [];
  const result=[];
  for(let index=0;index<clientMilestonePhases.length;index++){
    const item=own(value,String(index));
    if(item===undefined)break;
    const safe=clientMilestone(item,index,result.at(-1));
    if(!safe)break;
    result.push(safe);
  }
  return result;
};
// Parent-received time is measured from spawn; worker elapsed time is measured
// from actual module entry. They have different origins and are never merged.
export function appendLifecycleClientMilestone(existing,message,receivedElapsedMs){
  const entries=clientMilestones(existing);
  if(own(message,'type')!=='startup-milestone'||entries.length===clientMilestonePhases.length)return entries;
  const next=clientMilestone({phase:own(message,'phase'),sequence:own(message,'sequence'),workerElapsedMs:own(message,'workerElapsedMs'),receivedElapsedMs},entries.length,entries.at(-1));
  return next?[...entries,next]:entries;
}
const processState=value=>processStates.has(value)?value:'unavailable';
export function lifecycleChildProcessState(child){
  try{
    if(!child||typeof child!=='object'||!Number.isSafeInteger(child.pid)||child.pid<1)return 'unavailable';
    if(child.exitCode!==null)return 'exited';
    if(child.signalCode!==null)return 'signaled';
    return 'alive';
  }catch{return 'unavailable';}
}
export function beginLifecycleChildCleanup(evidence,kind){
  const prefix=kind==='gateway'?'gateway':'client';
  evidence[`${prefix}StopAttempted`]=false;
  evidence[`${prefix}StopCompleted`]=false;
  evidence[`${prefix}ProcessState`]=undefined;
}
export function observeLifecycleLogFlush(source,target){
  const completion=new Promise(resolve=>{
    let settled=false;
    const settle=value=>{if(settled)return;settled=true;source.off('error',failed);target.off('finish',finished);target.off('error',failed);target.off('close',closed);resolve(value);};
    const finished=()=>settle(true),failed=()=>settle(false),closed=()=>settle(false);
    source.once('error',failed);
    target.once('finish',finished);
    target.once('error',failed);
    target.once('close',closed);
  });
  source.pipe(target);
  return completion;
}
export async function waitForLifecycleLogFlush(completion,timeoutMs=5000){
  let timer;
  try{return await Promise.race([completion,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
const provenance=value=>({
  previous:{source:clean(own(own(value,'previous'),'source'),/^[0-9a-f]{40}$/),sha256:clean(own(own(value,'previous'),'sha256'),/^[0-9a-f]{64}$/),hostVersion:clean(own(own(value,'previous'),'hostVersion'),/^[0-9A-Za-z.+-]{1,64}$/)},
  current:{sha256:clean(own(own(value,'current'),'sha256'),/^[0-9a-f]{64}$/),hostVersion:clean(own(own(value,'current'),'hostVersion'),/^[0-9A-Za-z.+-]{1,64}$/)},
});

function category(error){
  const code=own(error,'code'),message=own(error,'message');
  if(code==='ENOSPC')return 'storage-full';
  if(code==='EACCES'||code==='EPERM')return 'permission-denied';
  if(code==='ENOENT')return 'required-file-missing';
  if(code==='ETIMEDOUT'||(typeof message==='string'&&/timed out|timeout/i.test(message)))return 'timeout';
  if(['ECONNREFUSED','ECONNRESET','EPIPE'].includes(code)||(typeof message==='string'&&/\b(?:ECONNREFUSED|ECONNRESET|EPIPE)\b/.test(message)))return 'connection';
  if(code==='ERR_ASSERTION')return 'invariant';
  if(typeof own(error,'status')==='number'||typeof own(error,'signal')==='string')return 'subprocess-exit';
  return 'unexpected';
}

function operation(value,fallback='unknown'){
  const name=own(value,'operation'),outcome=own(value,'outcome');
  const phase=own(value,'phase'),restartOrdinal=own(value,'restartOrdinal');
  return {operation:operations.has(name)?name:fallback,outcome:outcomes.has(outcome)?outcome:'failed',elapsedMs:elapsed(own(value,'elapsedMs')),...(phases.has(phase)?{phase}:{}),...(Number.isSafeInteger(restartOrdinal)&&restartOrdinal>=0&&restartOrdinal<=128?{restartOrdinal:ordinal(restartOrdinal)}:{})};
}

function completed(value){
  if(!Array.isArray(value))return [];
  const recent=[];
  for(let index=Math.max(0,value.length-64);index<value.length;index++){
    const item=operation(own(value,String(index)));
    if(item.outcome==='completed')recent.push(item);
  }
  return recent;
}

export function sanitizeLifecycleClientStartup(value){
  if(!value||typeof value!=='object')return;
  return {restartOrdinal:ordinal(own(value,'restartOrdinal')),budgetMs:elapsed(own(value,'budgetMs')),listening:own(value,'listening')===true,gatewayProcessState:processState(own(value,'gatewayProcessState')),clientProcessState:processState(own(value,'clientProcessState')),elapsedMs:elapsed(own(value,'elapsedMs')),milestones:clientMilestones(own(value,'milestones'))};
}

// The verifier uses this recorder around the actual awaited operations. A
// rejected callback stays active until its failure is captured; beginning
// cleanup never turns that failed operation into a completed one.
export function createLifecycleOperations(context=()=>({}),clock=Date.now){
  let active;
  const history=[];
  const begin=(name,extra={})=>{active={operation:name,...context(),...extra,startedAt:clock()};};
  const record=(outcome='failed')=>operation({...context(),...active,outcome,elapsedMs:active?Math.max(0,Math.min(86_400_000,clock()-active.startedAt)):0});
  const complete=()=>{if(active){history.push(record('completed'));if(history.length>64)history.shift();}active=undefined;};
  const abandon=()=>{active=undefined;};
  const snapshot=()=>({...record(),completedOperations:history.map(item=>({...item}))});
  const run=async(name,callback,extra)=>{begin(name,extra);const result=await callback();complete();return result;};
  return {begin,record,complete,abandon,snapshot,run,completed:()=>history.map(item=>({...item}))};
}

export function lifecycleFailureReceipt(phase,error,artifacts,readiness,diagnostics){
  const safeCategory=category(error),safeReadiness=sanitizeGatewayReadiness(readiness);
  const activeOperation=diagnostics?operation(diagnostics):undefined;
  const clientStartup=sanitizeLifecycleClientStartup(own(diagnostics,'clientStartup'));
  const cleanupError=own(diagnostics,'cleanupError');
  const cleanupOperation=cleanupError?{...operation(own(diagnostics,'cleanup')),category:category(cleanupError)}:undefined;
  return {status:'failed',phase:phases.has(phase)?phase:'unknown',category:safeCategory,message:descriptions[safeCategory],...(activeOperation?{activeOperation,completedOperations:completed(own(diagnostics,'completedOperations'))}:{}),...(cleanupOperation?{cleanupFailure:cleanupOperation}:{}),...(artifacts?{artifacts:provenance(artifacts)}:{}),...(safeReadiness?{readiness:safeReadiness}:{}),...(clientStartup?{clientStartup}:{})};
}

export function writeLifecycleFailureReceipt(directory,phase,error,artifacts,readiness,diagnostics){
  mkdirSync(directory,{recursive:true});
  const receipt=lifecycleFailureReceipt(phase,error,artifacts,readiness,diagnostics);
  writeFileSync(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  return receipt;
}

const logTimestamp=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/;
const normalizedLogTimestamp=value=>{
  if(typeof value!=='string')return null;
  const match=logTimestamp.exec(value);if(!match)return null;
  const zone=match[3],hours=zone==='Z'?0:Number(zone.slice(1,3)),minutes=zone==='Z'?0:Number(zone.slice(4,6));
  if(hours>14||minutes>59||(hours===14&&minutes!==0))return null;
  const offset=zone==='Z'?0:(zone[0]==='+'?1:-1)*(hours*60+minutes);
  const parsed=Date.parse(value);if(!Number.isFinite(parsed))return null;
  const local=new Date(parsed+offset*60_000).toISOString();
  if(local.slice(0,19)!==match[1]||Number(local.slice(20,23))!==Number((match[2]??'').padEnd(3,'0').slice(0,3)))return null;
  return new Date(parsed).toISOString();
};

export function lifecycleGatewayLogTimestamp(line){
  if(typeof line!=='string'||line.length>32_768)return null;
  const prefix=/^\[?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z)/.exec(line)?.[1];
  if(prefix)return normalizedLogTimestamp(prefix);
  try{
    const entry=JSON.parse(line);
    if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;
    return normalizedLogTimestamp(own(own(entry,'_meta'),'date'))??normalizedLogTimestamp(own(entry,'time'));
  }catch{return null;}
}

// Optional startup evidence is an allowlist: neither worker errors nor Gateway
// log text may enter the uploaded lifecycle artifact.
export function writeLifecycleStartupDiagnostic(directory,value){
  const take=(items,limit,convert)=>Array.isArray(items)?items.slice(-limit).map(convert):[];
  const bounded=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:0;
  const sample=value=>({
    workerElapsedMs:elapsed(own(value,'workerElapsedMs')),
    parentReceivedElapsedMs:elapsed(own(value,'parentReceivedElapsedMs')),
    rssBytes:bounded(own(value,'rssBytes'),1_000_000_000_000),
    cpuUserMicros:bounded(own(value,'cpuUserMicros'),60_000_000),
    cpuSystemMicros:bounded(own(value,'cpuSystemMicros'),60_000_000),
    loopDelayMaxMs:elapsed(own(value,'loopDelayMaxMs')),
    loopUtilization:Number.isFinite(own(value,'loopUtilization'))&&own(value,'loopUtilization')>=0&&own(value,'loopUtilization')<=1?own(value,'loopUtilization'):0,
  });
  const observation=value=>{
    const phase=own(value,'phase'),detail=own(value,'detail');
    const allowed=new Set(['client-construction-start','client-constructed','start-returned','hello-ok','connect-error','socket-close']);
    return {phase:allowed.has(phase)?phase:'unknown',workerElapsedMs:elapsed(own(value,'workerElapsedMs')),parentReceivedElapsedMs:elapsed(own(value,'parentReceivedElapsedMs')),...(phase==='connect-error'&&['authorization','timeout','transport','other'].includes(detail)?{detail}:{}),...(phase==='socket-close'&&/^(?:[1-4]\d{3}|unknown)$/.test(detail)?{detail}:{})};
  };
  const resource=value=>({state:processState(own(value,'state')),...(own(value,'sample')==='unavailable'?{sample:'unavailable'}:{}),...(Number.isFinite(own(value,'cpuPercent'))&&own(value,'cpuPercent')>=0&&own(value,'cpuPercent')<=10000?{cpuPercent:own(value,'cpuPercent')}:{}),...(Number.isSafeInteger(own(value,'rssKiB'))&&own(value,'rssKiB')>=0&&own(value,'rssKiB')<=1_000_000_000?{rssKiB:own(value,'rssKiB')}:{}),processStatus:clean(own(value,'processStatus'),/^[A-Z+<NsL]{1,8}$/)});
  const startup=value=>({phase:phases.has(own(value,'phase'))?own(value,'phase'):'unknown',restartOrdinal:ordinal(own(value,'restartOrdinal')),outcome:['ready','timeout','error'].includes(own(value,'outcome'))?own(value,'outcome'):'unknown',observations:take(own(value,'observations'),16,observation),resourceSamples:take(own(value,'resourceSamples'),16,sample),...(own(value,'startup')?{startup:sanitizeLifecycleClientStartup(own(value,'startup'))}:{}),...(own(value,'gatewayResource')?{gatewayResource:resource(own(value,'gatewayResource'))}:{})});
  const log=value=>({status:['read','unavailable','refused-symlink','not-regular'].includes(own(value,'status'))?own(value,'status'):'unavailable',bytes:elapsed(own(value,'bytes')),tailTruncated:own(value,'tailTruncated')===true,lines:take(own(value,'lines'),24,line=>({category:['migration','plugin-service','gateway-ready','connection','warning-or-error','other'].includes(own(line,'category'))?own(line,'category'):'other',length:elapsed(own(line,'length')),timestamp:typeof own(line,'timestamp')==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(own(line,'timestamp'))?own(line,'timestamp'):null}))});
  const logs=own(value,'gatewayLogs');
  const host=value=>({version:clean(own(value,'version'),/^[0-9A-Za-z.+-]{1,64}$/),packageSha256:clean(own(value,'packageSha256'),/^[0-9a-f]{64}$/),cliSha256:clean(own(value,'cliSha256'),/^[0-9a-f]{64}$/),clientSha256:clean(own(value,'clientSha256'),/^[0-9a-f]{64}$/)});
  const cleanup=own(value,'cleanup');
  const receipt={version:1,sourceHead:clean(own(value,'sourceHead'),/^[0-9a-f]{40}$/),previousSource:clean(own(value,'previousSource'),/^[0-9a-f]{40}$/),previousArchiveSha256:clean(own(value,'previousArchiveSha256'),/^[0-9a-f]{64}$/),currentArchiveSha256:clean(own(value,'currentArchiveSha256'),/^[0-9a-f]{64}$/),nodeVersion:clean(own(value,'nodeVersion'),/^v\d+\.\d+\.\d+$/),hosts:{previous:host(own(own(value,'hosts'),'previous')),current:host(own(own(value,'hosts'),'current'))},gatewayStartups:take(own(value,'gatewayStartups'),4,item=>({phase:phases.has(own(item,'phase'))?own(item,'phase'):'unknown',restartOrdinal:ordinal(own(item,'restartOrdinal')),budgetMs:elapsed(own(item,'budgetMs')),listeningElapsedMs:elapsed(own(item,'listeningElapsedMs'))})),clientStartups:take(own(value,'clientStartups'),4,startup),gatewayLogs:{host:['previous','current'].includes(own(logs,'host'))?own(logs,'host'):'unknown',stderr:log(own(logs,'stderr')),configured:log(own(logs,'configured'))},cleanup:{clientProcessState:processState(own(cleanup,'clientProcessState')),gatewayProcessState:processState(own(cleanup,'gatewayProcessState')),clientStopAttempted:own(cleanup,'clientStopAttempted')===true,gatewayStopAttempted:own(cleanup,'gatewayStopAttempted')===true,clientStopCompleted:own(cleanup,'clientStopCompleted')===true,gatewayStopCompleted:own(cleanup,'gatewayStopCompleted')===true}};
  mkdirSync(directory,{recursive:true});
  writeFileSync(resolve(directory,'startup-diagnostic.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  return receipt;
}

export function finalizeLifecycleStartupDiagnostic(writer,primaryError){
  try{return {primaryError,diagnosticWritten:writer()===true};}
  catch{return {primaryError,diagnosticWritten:false};}
}
