import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sanitizeGatewayReadiness} from './gateway-readiness-evidence.mjs';

const phases=new Set(['archive-validation','install-previous','backup-previous','upgrade','uninstall-reinstall','matching-predecessor-restore']);
const operations=new Set(['archive-validation','installer','installed-file-validation','gateway-readiness','sdk-client-startup','public-session-actions','client-shutdown','gateway-shutdown','unknown']);
const outcomes=new Set(['completed','failed','timed-out','not-started']);
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

function operation(value,fallback='archive-validation'){
  const name=own(value,'operation'),outcome=own(value,'outcome');
  const phase=own(value,'phase'),restartOrdinal=own(value,'restartOrdinal');
  return {operation:operations.has(name)?name:fallback,outcome:outcomes.has(outcome)?outcome:'failed',elapsedMs:elapsed(own(value,'elapsedMs')),...(phases.has(phase)?{phase}:{}),...(Number.isSafeInteger(restartOrdinal)&&restartOrdinal>=0&&restartOrdinal<=128?{restartOrdinal:ordinal(restartOrdinal)}:{})};
}

function completed(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,16).map(item=>operation(item)).filter(item=>item.outcome==='completed');
}

export function lifecycleFailureReceipt(phase,error,artifacts,readiness,diagnostics){
  const safeCategory=category(error),safeReadiness=sanitizeGatewayReadiness(readiness);
  const activeOperation=operation(diagnostics);
  const cleanupError=own(diagnostics,'cleanupError');
  const cleanupOperation=cleanupError?{...operation(own(diagnostics,'cleanup'), 'gateway-shutdown'),category:category(cleanupError)}:undefined;
  return {status:'failed',phase:phases.has(phase)?phase:'unknown',category:safeCategory,message:descriptions[safeCategory],activeOperation,completedOperations:completed(own(diagnostics,'completedOperations')),...(cleanupOperation?{cleanupFailure:cleanupOperation}:{}),...(artifacts?{artifacts:provenance(artifacts)}:{}),...(safeReadiness?{readiness:safeReadiness}:{})};
}

export function writeLifecycleFailureReceipt(directory,phase,error,artifacts,readiness,diagnostics){
  mkdirSync(directory,{recursive:true});
  const receipt=lifecycleFailureReceipt(phase,error,artifacts,readiness,diagnostics);
  writeFileSync(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  return receipt;
}
