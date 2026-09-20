import {describe,expect,it} from 'vitest';
import {sustainedFailureCategory,sustainedFailureReceipt} from '../scripts/sustained-failure-receipt.mjs';

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
});
