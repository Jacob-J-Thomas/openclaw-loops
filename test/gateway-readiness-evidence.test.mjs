import {describe,expect,it} from 'vitest';
import {observeGatewayReadiness} from '../scripts/gateway-readiness-evidence.mjs';

const fixture=({clock=15000,child={exitCode:null,signalCode:null},probe=async()=>false,remainingMs=()=>60000,onPause=()=>{}}={})=>{
  const now=()=>clock,pause=async milliseconds=>{clock+=milliseconds;onPause();};
  return observeGatewayReadiness({child,probe,startedAt:0,restartOrdinal:1,remainingMs,now,pause});
};

describe('bounded gateway readiness observation',()=>{
  it('records when the same process starts listening after its deadline',async()=>{
    let probes=0;
    await expect(fixture({probe:async()=>++probes===3})).resolves.toEqual({restartOrdinal:1,deadlineElapsedMs:15000,deadlineProcessState:'alive',postDeadlineAttempts:3,postDeadlineWindowMs:200,listenerAfterDeadline:true,listenerElapsedMs:15200,finalProcessState:'alive'});
  });

  it('caps observation at 45 seconds and honors a smaller remaining verifier budget',async()=>{
    await expect(fixture()).resolves.toMatchObject({postDeadlineAttempts:450,postDeadlineWindowMs:45000,listenerAfterDeadline:false,listenerElapsedMs:0,finalProcessState:'alive'});
    await expect(fixture({remainingMs:()=>250})).resolves.toMatchObject({postDeadlineAttempts:3,postDeadlineWindowMs:250,listenerAfterDeadline:false});
  });

  it('stops observing after an exit or signal and never serializes hostile probe data',async()=>{
    const secret='token=private-secret /private/operator/path';
    const exited={exitCode:null,signalCode:null};
    const exit=await fixture({child:exited,onPause:()=>{exited.exitCode=17;}});
    expect(exit).toMatchObject({postDeadlineAttempts:1,listenerAfterDeadline:false,finalProcessState:'exited'});
    const signaled=await fixture({child:{exitCode:null,signalCode:'SIGTERM'}});
    expect(signaled).toMatchObject({postDeadlineAttempts:0,deadlineProcessState:'signaled',finalProcessState:'signaled'});
    const hostile=await fixture({probe:async()=>{throw new Error(secret);}});
    expect(JSON.stringify(hostile)).not.toContain(secret);
  });

  it('does not probe when the overall budget is already exhausted',async()=>{
    let probes=0;
    const result=await fixture({probe:async()=>{probes++;return true;},remainingMs:()=>0});
    expect(probes).toBe(0);
    expect(result).toMatchObject({postDeadlineAttempts:0,postDeadlineWindowMs:0,listenerAfterDeadline:false});
  });

  it('limits each socket probe to the remaining diagnostic window and retains actual elapsed time',async()=>{
    let clock=15000;
    const child={exitCode:null,signalCode:null},timeouts=[];
    const result=await observeGatewayReadiness({child,startedAt:0,restartOrdinal:1,remainingMs:()=>60000,now:()=>clock,
      probe:async timeoutMs=>{timeouts.push(timeoutMs);return false;},
      pause:async()=>{clock+=45100;child.exitCode=0;}});
    expect(timeouts).toEqual([1000]);
    expect(result).toMatchObject({postDeadlineWindowMs:45100,finalProcessState:'exited'});
    const shortTimeouts=[];
    await fixture({remainingMs:()=>50,probe:async timeoutMs=>{shortTimeouts.push(timeoutMs);return false;}});
    expect(shortTimeouts).toEqual([50]);
  });

});
