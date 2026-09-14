import React from 'react';
import {LoopError,safeFailure,type LoopErrorData} from './errors.js';

export type DisplayFailure=string|LoopErrorData;

// Keep the public diagnostic returned by the shared client. Local validation
// errors retain their message; arbitrary causes/properties are never expanded.
export function displayFailure(error:unknown,context?:string):DisplayFailure{
  const failure=error instanceof LoopError?safeFailure(error):error instanceof Error?error.message:String(error);
  if(!context)return failure;
  return typeof failure==='string'?`${context}: ${failure}`:{...failure,message:`${context}: ${failure.message}`};
}

export function FailureNotice({failure,label='Operation failure',onDismiss}:{failure:DisplayFailure;label?:string;onDismiss?:()=>void}){
  if(!failure)return null;
  const detail=typeof failure==='string'?undefined:failure;
  return <section className="lp-message error lp-run-failure" role="alert" aria-label={label}>
    {onDismiss&&<button className="lp-failure-dismiss" onClick={onDismiss} aria-label="Dismiss error">×</button>}
    {detail&&<h3 className="lp-mono">{detail.code}</h3>}
    <p>{typeof failure==='string'?failure:failure.message}</p>
    {detail&&<><dl>
      <dt>Phase</dt><dd>{detail.phase}</dd>
      {detail.nodeId!==undefined&&<><dt>Node</dt><dd className="lp-mono">{detail.nodeId}</dd></>}
      {detail.model!==undefined&&<><dt>Model</dt><dd className="lp-mono">{detail.model}</dd></>}
      <dt>Retryable</dt><dd>{detail.retryable?'Yes, after the recovery step':'Resolve the failure first'}</dd>
    </dl><p><strong>Next step: </strong>{detail.recovery}</p></>}
  </section>;
}
