import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sanitizeGatewayReadiness} from './gateway-readiness-evidence.mjs';

const phases=new Set(['archive-validation','install-previous','backup-previous','upgrade','uninstall-reinstall','matching-predecessor-restore']);
const operations=new Set(['archive-validation','installer','installed-file-validation','gateway-readiness','sdk-client-startup','public-session-actions','client-shutdown','gateway-shutdown','profile-backup','profile-restore','state-validation','rollback-staging','receipt-write','unknown']);
const outcomes=new Set(['completed','failed','timed-out','not-started']);
const processStates=new Set(['alive','exited','signaled','unavailable']);
const timingPhases=new Set(['socket-open','challenge','connect-plan-ready','request-sent','hello','failed','fallback']);
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
const timing=value=>({phase:timingPhases.has(own(value,'phase'))?own(value,'phase'):'unknown',generation:ordinal(own(value,'generation')),durationMs:elapsed(own(value,'durationMs')),phaseDurationMs:elapsed(own(value,'phaseDurationMs')),hasChallenge:own(value,'hasChallenge')===true,usedFallback:own(value,'usedFallback')===true});
const processState=value=>processStates.has(value)?value:'unavailable';
export function lifecycleChildProcessState(child){
  try{
    if(!child||typeof child!=='object'||!Number.isSafeInteger(child.pid)||child.pid<1)return 'unavailable';
    if(child.exitCode!==null)return 'exited';
    if(child.signalCode!==null)return 'signaled';
    return 'alive';
  }catch{return 'unavailable';}
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
  const entries=own(value,'timings'),timings=[];
  if(Array.isArray(entries))for(const entry of entries.slice(0,8))timings.push(timing(entry));
  return {restartOrdinal:ordinal(own(value,'restartOrdinal')),budgetMs:elapsed(own(value,'budgetMs')),listening:own(value,'listening')===true,gatewayProcessState:processState(own(value,'gatewayProcessState')),clientProcessState:processState(own(value,'clientProcessState')),elapsedMs:elapsed(own(value,'elapsedMs')),timings};
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
