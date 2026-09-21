import {describe,expect,it} from 'vitest';
import {sanitizeSustainedClientStartup,sustainedFailureCategory,sustainedFailureReceipt} from '../scripts/sustained-failure-receipt.mjs';

describe('sanitized sustained-workload failure receipt',()=>{
  it('distinguishes a readiness deadline from a process exit without copying unknown text',()=>{
    const receipt=message=>sustainedFailureReceipt({phase:'start',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'a'.repeat(64),error:new Error(message),elapsedMs:15000,completeRuns:0,parkedRuns:0,runCount:256});
    expect(receipt('Gateway did not listen.').message).toBe('The Gateway listening deadline expired.');
    expect(receipt('Gateway exited before listening.').message).toBe('The Gateway process exited before readiness.');
    expect(receipt('Gateway did not listen. token=private-secret').message).toBe('The sustained workload failed unexpectedly.');
  });
  it.each([
    [new Error('Gateway exited before listening.'),'gateway-startup'],
    [new Error('Gateway client startup timed out.'),'client-startup'],
    [new Error('Gateway request timed out: plugins.sessionAction'),'gateway-request'],
    [Object.assign(new Error('private assertion'),{code:'ERR_ASSERTION'}),'assertion'],
    [Object.assign(new Error('private disk path'),{code:'ENOSPC'}),'system'],
    [new Error('private unexpected detail'),'unexpected'],
  ])('maps a bounded category without copying an error message', (error,category)=>{
    expect(sustainedFailureCategory(error)).toBe(category);
    const receipt=sustainedFailureReceipt({phase:'epoch-1',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'a'.repeat(64),error,elapsedMs:123,completeRuns:4,parkedRuns:2,runCount:256});
    expect(receipt).toMatchObject({status:'failed',phase:'epoch-1',code:'SUSTAINED_VERIFICATION_FAILED',category,progress:{elapsedMs:123,completeRuns:4,parkedRuns:2}});
    expect(JSON.stringify(receipt)).not.toContain(error.message);
  });

  it('bounds numeric progress and tolerates hostile error data',()=>{
    const secret='token=private-secret /private/operator/config';
    const hostile={get message(){throw new Error(secret);},get code(){throw new Error(secret);},get status(){throw new Error(secret);},get signal(){throw new Error(secret);}};
    const receipt=sustainedFailureReceipt({phase:'start',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'b'.repeat(64),error:hostile,elapsedMs:900001,completeRuns:257,parkedRuns:-1,runCount:256});
    expect(receipt).toEqual({status:'failed',phase:'start',code:'SUSTAINED_VERIFICATION_FAILED',category:'unexpected',message:'The sustained workload failed unexpectedly.',archiveSha256:'b'.repeat(64),noModelCalls:true,progress:{elapsedMs:900001,completeRuns:0,parkedRuns:0}});
    expect(JSON.stringify(receipt)).not.toContain(secret);
  });

  it('retains the cleanup code and phase for compatibility',()=>{
    expect(sustainedFailureReceipt({phase:'process-cleanup',code:'SUSTAINED_CLEANUP_FAILED',archiveSha256:'c'.repeat(64),error:Object.assign(new Error('private'),{signal:'SIGKILL'}),elapsedMs:500,completeRuns:256,parkedRuns:16,runCount:256})).toMatchObject({phase:'process-cleanup',code:'SUSTAINED_CLEANUP_FAILED',category:'system',progress:{elapsedMs:500,completeRuns:256,parkedRuns:16}});
  });

  it('retains the original failure when the post-deadline observer sees a late listener',()=>{
    const secret='private readiness payload';
    const receipt=sustainedFailureReceipt({phase:'epoch-1',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'d'.repeat(64),error:new Error('Gateway did not listen.'),elapsedMs:60000,completeRuns:64,parkedRuns:0,runCount:256,readiness:{restartOrdinal:1,deadlineElapsedMs:15000,deadlineProcessState:'alive',postDeadlineAttempts:3,postDeadlineWindowMs:200,listenerAfterDeadline:true,listenerElapsedMs:15200,finalProcessState:'alive',secret}});
    expect(receipt).toMatchObject({status:'failed',phase:'epoch-1',code:'SUSTAINED_VERIFICATION_FAILED',message:'The Gateway listening deadline expired.',readiness:{listenerAfterDeadline:true,listenerElapsedMs:15200}});
    expect(JSON.stringify(receipt)).not.toContain(secret);
  });

  it('records bounded client startup phase, restart, listener, and process evidence without raw protocol data',()=>{
    const secret='token=private-client-token /private/gateway';
    const clientStartup={restartOrdinal:2,budgetMs:60_000,listening:true,gatewayProcessState:'alive',clientProcessState:'alive',elapsedMs:60_000,timings:[{phase:'socket-open',generation:3,durationMs:10,phaseDurationMs:10,hasChallenge:false,usedFallback:false,plan:secret},{phase:'hello',generation:3,durationMs:20,phaseDurationMs:10,hasChallenge:true,usedFallback:false}],secret};
    const receipt=sustainedFailureReceipt({phase:'epoch-2',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'f'.repeat(64),error:new Error('Gateway client startup timed out.'),elapsedMs:90_000,completeRuns:128,parkedRuns:0,runCount:256,clientStartup});
    expect(receipt).toMatchObject({category:'client-startup',clientStartup:{restartOrdinal:2,budgetMs:60_000,listening:true,gatewayProcessState:'alive',clientProcessState:'alive',elapsedMs:60_000,timings:[{phase:'socket-open'},{phase:'hello',hasChallenge:true}]}});
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(sanitizeSustainedClientStartup({timings:[{phase:'private-phase',generation:-1}],gatewayProcessState:'private'})).toMatchObject({gatewayProcessState:'unavailable',timings:[{phase:'unknown',generation:0}]});
  });

  it('reads each client timing field once before allowlisting it',()=>{
    const secret='private getter-swapped client phase';
    const timing={get phase(){return this.read?secret:(this.read=true,'socket-open');},generation:1,durationMs:2,phaseDurationMs:2,hasChallenge:false,usedFallback:false};
    const receipt=sustainedFailureReceipt({phase:'epoch-2',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'f'.repeat(64),error:new Error('Gateway client startup timed out.'),elapsedMs:60_000,completeRuns:128,parkedRuns:0,runCount:256,clientStartup:{timings:[timing]}});
    expect(receipt.clientStartup.timings).toEqual([expect.objectContaining({phase:'socket-open',generation:1})]);
    expect(JSON.stringify(receipt)).not.toContain(secret);
  });

  it('rejects getter-swapped readiness data',()=>{
    const secret='private getter replacement';
    const readiness={restartOrdinal:1,deadlineElapsedMs:15000,get deadlineProcessState(){return this.read?secret:(this.read=true,'alive');},postDeadlineAttempts:1,postDeadlineWindowMs:100,listenerAfterDeadline:false,listenerElapsedMs:0,finalProcessState:'alive'};
    const receipt=sustainedFailureReceipt({phase:'start',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'e'.repeat(64),error:new Error('Gateway did not listen.'),elapsedMs:15000,completeRuns:0,parkedRuns:0,runCount:256,readiness});
    expect(receipt.readiness.deadlineProcessState).toBe('alive');expect(JSON.stringify(receipt)).not.toContain(secret);
  });
});
