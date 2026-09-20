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

export function sustainedFailureCategory(error){
  const code=text(error,'code'),message=text(error,'message');
  if(message==='Gateway exited before listening.'||message==='Gateway did not listen.')return 'gateway-startup';
  if(message==='Gateway client startup timed out.'||message==='Gateway client worker exited before ready.'||message==='Client worker exited.')return 'client-startup';
  if(message==='Gateway request timed out: sessions.create'||message==='Gateway request timed out: plugins.sessionAction')return 'gateway-request';
  if(code==='ERR_ASSERTION'||text(error,'name')==='AssertionError')return 'assertion';
  if(['EACCES','EADDRINUSE','ECONNREFUSED','ECONNRESET','EIO','ENOENT','ENOSPC','EPERM','ETIMEDOUT'].includes(code)||numeric(error,'status')!==undefined||text(error,'signal'))return 'system';
  return 'unexpected';
}

export function sustainedFailureReceipt({phase,code,archiveSha256,error,elapsedMs,completeRuns,parkedRuns,runCount}){
  const category=sustainedFailureCategory(error);
  return {
    status:'failed',
    phase,
    code,
    category,
    message:knownFailures.get(text(error,'message'))??descriptions[category],
    archiveSha256,
    noModelCalls:true,
    progress:{elapsedMs:number(elapsedMs,Number.MAX_SAFE_INTEGER),completeRuns:number(completeRuns,number(runCount,256)),parkedRuns:number(parkedRuns,16)},
  };
}
