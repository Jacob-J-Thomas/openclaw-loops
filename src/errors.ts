export type LoopErrorData = {code:string;message:string;phase:string;nodeId?:string;model?:string;retryable:boolean;recovery:string};
export class LoopError extends Error {
  constructor(readonly detail:LoopErrorData){super(detail.message);this.name='LoopError';}
}
export function errorDetail(error:unknown, context:{phase:string;nodeId?:string;model?:string}):LoopErrorData {
  if(error instanceof LoopError)return {...context,...error.detail};
  const message=(error instanceof Error?error.message:'Execution failed.').slice(0,4000);
  const code=typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'?error.code:undefined;
  const policy=/allowlist|not allowed|denied|revoked|unauthorized/i.test(message);
  const unavailable=/unavailable|ECONNREFUSED|offline|overload|rate.limit|429|503/i.test(message);
  return {...context,code:code??(policy?'HOST_POLICY_DENIED':unavailable?'HOST_UNAVAILABLE':'EXECUTION_FAILED'),message,
    retryable:unavailable&&!policy,recovery:policy?'Review the effective host policy and selected model/account. Loops cannot override a host denial.'
      :unavailable?'Check the selected provider/runtime, then explicitly retry this attempt.'
      :'Inspect the failed node and its recorded inputs before retrying.'};
}
