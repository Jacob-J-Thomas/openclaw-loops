const MAX_DIAGNOSTIC_MS=45*1000;
const numeric=(value,maximum)=>Number.isSafeInteger(value)&&value>=0&&value<=maximum?value:0;
const state=child=>!child?'unavailable':child.exitCode!==null?'exited':child.signalCode!==null?'signaled':'alive';
const states=new Set(['alive','exited','signaled','unavailable']);
const read=(value,key)=>{try{return value?.[key];}catch{return undefined;}};

export function sanitizeGatewayReadiness(value){
  if(!value||typeof value!=='object')return;
  const safeState=key=>{const candidate=read(value,key);return states.has(candidate)?candidate:'unavailable';};
  return {
    restartOrdinal:numeric(read(value,'restartOrdinal'),5),
    deadlineElapsedMs:numeric(read(value,'deadlineElapsedMs'),Number.MAX_SAFE_INTEGER),
    deadlineProcessState:safeState('deadlineProcessState'),
    postDeadlineAttempts:numeric(read(value,'postDeadlineAttempts'),450),
    postDeadlineWindowMs:numeric(read(value,'postDeadlineWindowMs'),Number.MAX_SAFE_INTEGER),
    listenerAfterDeadline:read(value,'listenerAfterDeadline')===true,
    listenerElapsedMs:numeric(read(value,'listenerElapsedMs'),Number.MAX_SAFE_INTEGER),
    finalProcessState:safeState('finalProcessState'),
  };
}

export async function observeGatewayReadiness({child,probe,startedAt,restartOrdinal,remainingMs,now=Date.now,pause}){
  const deadlineState=state(child),diagnosticStartedAt=now();
  const availableMs=Math.min(MAX_DIAGNOSTIC_MS,numeric(remainingMs(),Number.MAX_SAFE_INTEGER));
  const diagnosticDeadline=diagnosticStartedAt+availableMs;
  let attempts=0,listenerAfterDeadline=false,listenerElapsedMs=0,finalState;
  while(now()<diagnosticDeadline){
    finalState=state(child);
    if(finalState!=='alive')break;
    attempts++;
    try{if(await probe(Math.max(1,Math.min(1000,diagnosticDeadline-now())))){listenerAfterDeadline=true;listenerElapsedMs=numeric(now()-startedAt,Number.MAX_SAFE_INTEGER);break;}}catch{/* Probe errors remain private to the caller. */}
    await pause(Math.min(100,Math.max(0,diagnosticDeadline-now())));
  }
  finalState=state(child);
  return sanitizeGatewayReadiness({
    restartOrdinal:numeric(restartOrdinal,5),
    deadlineElapsedMs:numeric(diagnosticStartedAt-startedAt,Number.MAX_SAFE_INTEGER),
    deadlineProcessState:deadlineState,
    postDeadlineAttempts:numeric(attempts,450),
    postDeadlineWindowMs:numeric(now()-diagnosticStartedAt,Number.MAX_SAFE_INTEGER),
    listenerAfterDeadline,
    listenerElapsedMs,
    finalProcessState:finalState,
  });
}
