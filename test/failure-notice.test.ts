import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {FailureNotice,displayFailure} from '../src/failure-notice.js';
import {LoopError,errorDetail,requestError,storageError} from '../src/errors.js';

describe('public failure presentation',()=>{
  it.each([false,true])('keeps code, location, retryability=%s and recovery from the typed operation error',retryable=>{
    const detail={code:'HOST_TIMEOUT',message:'The selected runtime timed out.',phase:'inference',nodeId:'research',model:'fake/selected',retryable,recovery:'Inspect the uncertain attempt before explicitly retrying.'};
    const failure=displayFailure(new LoopError(detail,{cause:new Error('SYNTHETIC_PRIVATE_CAUSE')}),'Could not continue');
    expect(failure).toEqual({...detail,message:'Could not continue: '+detail.message});
    const html=renderToStaticMarkup(React.createElement(FailureNotice,{failure,onDismiss:()=>{}}));
    for(const value of [detail.code,detail.phase,detail.nodeId,detail.model,detail.recovery])expect(html).toContain(value);
    expect(html).toContain('role="alert"');expect(html).toContain('aria-label="Dismiss error"');
    expect(html).toContain(retryable?'Yes, after the recovery step':'Resolve the failure first');expect(html).not.toContain('SYNTHETIC_PRIVATE_CAUSE');
  });
  it('preserves safe storage and provider diagnostics without exposing their private native causes',()=>{
    const secret='SYNTHETIC_PRIVATE_CREDENTIAL',native=Object.assign(new Error(`Disk write /private/${secret}/store with body ${secret}`),{code:'ENOSPC'});
    const provider=Object.assign(new Error(`Request https://user:${secret}@example.test/?key=${secret} failed`),{status:401});
    const errors=[storageError(native),new LoopError(errorDetail(provider,{phase:'inference',nodeId:'draft',model:'fake/selected'}),{cause:provider})];
    for(const error of errors){const failure=displayFailure(error);expect(typeof failure).toBe('object');const html=renderToStaticMarkup(React.createElement(FailureNotice,{failure}));expect(html).toContain('Next step:');expect(html).not.toContain(secret);expect(html).not.toContain('example.test');expect(html).not.toContain('/private/');}
  });
  it('shows operation recovery without inventing node or model attribution',()=>{
    const error=requestError('The saved revision changed.','LOOPS_REVISION_CONFLICT','Reload the current revision and merge the draft.');
    const html=renderToStaticMarkup(React.createElement(FailureNotice,{failure:displayFailure(error),label:'Library operation failure'}));
    expect(html).toContain(error.code);expect(html).toContain('operation');expect(html).toContain(error.detail.recovery);expect(html).not.toContain('<dt>Node</dt>');expect(html).not.toContain('<dt>Model</dt>');
  });
  it('retains local messages, escapes authored text, and does not invent metadata for untyped failures',()=>{
    const error=Object.assign(new Error('Invalid input <script>alert("test")</script>'),{code:'SYNTHETIC_UNTRUSTED_CODE',cause:{token:'SYNTHETIC_CAUSE_SECRET'}});
    const html=renderToStaticMarkup(React.createElement(FailureNotice,{failure:displayFailure(error,'Local draft')}));
    expect(html).toContain('Local draft: Invalid input &lt;script&gt;');expect(html).not.toContain('<script>');expect(html).not.toContain('SYNTHETIC');expect(html).not.toContain('<dt>Phase</dt>');expect(html).not.toContain('Next step:');
    expect(renderToStaticMarkup(React.createElement(FailureNotice,{failure:''}))).toBe('');
  });
});
