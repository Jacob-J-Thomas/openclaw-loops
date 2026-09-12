import {Type} from 'typebox';
export const LoopErrorSchema=Type.Object({code:Type.String(),message:Type.String(),phase:Type.String(),nodeId:Type.Optional(Type.String()),model:Type.Optional(Type.String()),retryable:Type.Boolean(),recovery:Type.String()},{additionalProperties:false});
export type LoopErrorData = {code:string;message:string;phase:string;nodeId?:string;model?:string;retryable:boolean;recovery:string};
export class LoopError extends Error {
  constructor(readonly detail:LoopErrorData,options?:ErrorOptions){super(detail.message,options);this.name='LoopError';}
}
// Use only for expected plugin-owned failures. Unexpected host/transport errors
// remain private; the Gateway intentionally masks thrown plugin exceptions.
export function requestError(message:string,code='LOOPS_INVALID_REQUEST',recovery='Review the request and current loop or run state before retrying.'){
  return new LoopError({code,message,phase:'operation',retryable:false,recovery});
}
export function safeFailure(error:LoopError):LoopErrorData{
  const {code,message,phase,nodeId,model,retryable,recovery}=error.detail;
  return {code,message:message.slice(0,4000),phase,retryable,recovery:recovery.slice(0,4000),...nodeId===undefined?{}:{nodeId},...model===undefined?{}:{model}};
}
export function errorDetail(error:unknown, context:{phase:string;nodeId?:string;model?:string}):LoopErrorData {
  const location={phase:context.phase,...context.nodeId===undefined?{}:{nodeId:context.nodeId},...context.model===undefined?{}:{model:context.model}};
  if(error instanceof LoopError){const detail={...location,...error.detail};if(detail.nodeId===undefined)delete detail.nodeId;if(detail.model===undefined)delete detail.model;return detail;}
  const message=(error instanceof Error?error.message:'Execution failed.').slice(0,4000);
  const code=typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'?error.code:undefined;
  const policy=/allowlist|not allowed|denied|revoked|unauthorized/i.test(message);
  const unavailable=/unavailable|ECONNREFUSED|offline|overload|rate.limit|429|503/i.test(message);
  return {...location,code:code??(policy?'HOST_POLICY_DENIED':unavailable?'HOST_UNAVAILABLE':'EXECUTION_FAILED'),message,
    retryable:unavailable&&!policy,recovery:policy?'Review the effective host policy and selected model/account. Loops cannot override a host denial.'
      :unavailable?'Check the selected provider/runtime, then explicitly retry this attempt.'
      :'Inspect the failed node and its recorded inputs before retrying.'};
}
