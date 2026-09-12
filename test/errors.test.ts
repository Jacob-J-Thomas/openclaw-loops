import {describe,it,expect,vi} from 'vitest';
import {errorDetail,executionError} from '../src/errors.js';

describe('safe execution diagnostics',()=>{
  it.each([
    [401,undefined,'HOST_AUTHENTICATION_FAILED',false],
    [429,undefined,'HOST_RATE_LIMITED',true],
    [504,undefined,'HOST_TIMEOUT',true],
    [undefined,'ECONNREFUSED','HOST_UNAVAILABLE',true],
    [undefined,'context_length_exceeded','HOST_CONTEXT_LIMIT',false],
    [undefined,'LLM_ISOLATED_UNSUPPORTED','HOST_SETTINGS_REJECTED',false],
  ])('classifies a wrapped status %s/code %s without copying private payloads', (status,code,expected,retryable)=>{
    const secret='SYNTHETIC_PRIVATE_CREDENTIAL';
    const cause=Object.assign(new Error(`Request https://user:${secret}@example.test/?key=${secret} failed`),{status,code});
    const wrapped=Object.assign(new Error(`Runtime failed with payload ${secret}`,{cause}),{code:'LLM_COMPLETION_FAILED'});
    const detail=errorDetail(wrapped,{phase:'inference',nodeId:'research',model:'fake/selected'});
    expect(detail).toMatchObject({code:expected,retryable,phase:'inference',nodeId:'research',model:'fake/selected',recovery:expect.any(String)});
    expect(JSON.stringify(detail)).not.toContain(secret);expect(JSON.stringify(detail)).not.toContain('example.test');
  });
  it('does not evaluate getters or echo arbitrary codes and bounds cyclic causes',()=>{
    const getter=vi.fn(()=>{throw new Error('SYNTHETIC_GETTER_SECRET');});
    const error:Record<string,unknown>={code:'SYNTHETIC_CODE_SECRET',message:'SYNTHETIC_MESSAGE_SECRET'};
    Object.defineProperty(error,'status',{get:getter});error.cause=error;
    expect(errorDetail(error,{phase:'execution'})).toMatchObject({code:'EXECUTION_FAILED',retryable:false});expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(errorDetail(error,{phase:'execution'}))).not.toContain('SYNTHETIC');
  });
  it('keeps deliberate graph failures and their location actionable',()=>{
    const error=executionError('Required test evidence was missing.','LOOPS_EXPLICIT_FAILURE');
    expect(errorDetail(error,{phase:'inference',nodeId:'exit',model:'fake/test'})).toMatchObject({code:'LOOPS_EXPLICIT_FAILURE',message:'Required test evidence was missing.',phase:'execution',nodeId:'exit',model:'fake/test'});
    expect(errorDetail(new Error('Parameter temperature is not allowed'),{phase:'inference'}).code).toBe('HOST_SETTINGS_REJECTED');
  });
});
