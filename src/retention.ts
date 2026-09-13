import {Type,type Static} from 'typebox';
import {Value} from 'typebox/value';
import {requestError} from './errors.js';
import type {Run} from './engine.js';

const strict={additionalProperties:false} as const;
export const RetentionPolicySchema=Type.Object({
  olderThanDays:Type.Optional(Type.Number({minimum:0,maximum:365000})),
  keepLatest:Type.Optional(Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER})),
},strict);
export type RetentionPolicy=Static<typeof RetentionPolicySchema>;
export const RetiredAdmissionSchema=Type.Object({runId:Type.String({minLength:1}),fingerprint:Type.String({pattern:'^[a-f0-9]{64}$'}),fingerprintVersion:Type.Optional(Type.Literal(2)),canonicalFingerprint:Type.Optional(Type.String({pattern:'^[a-f0-9]{64}$'})),retiredAt:Type.String({minLength:1}),owner:Type.Object({agentId:Type.String(),sessionKey:Type.String(),sessionId:Type.String()},strict)},strict);
export type RetiredAdmission=Static<typeof RetiredAdmissionSchema>;
export const RetentionResultSchema=Type.Object({
  planId:Type.String({pattern:'^[a-f0-9]{64}$'}),policy:RetentionPolicySchema,applied:Type.Boolean(),
  candidates:Type.Array(Type.Object({id:Type.String(),updatedAt:Type.String()},strict)),
  protected:Type.Object({active:Type.Integer({minimum:0}),ancestry:Type.Integer({minimum:0}),recent:Type.Integer({minimum:0})},strict),
  total:Type.Integer({minimum:0}),
},strict);
export type RetentionResult=Static<typeof RetentionResultSchema>;

export function retentionCandidates(runs:Array<Pick<Run,'id'|'state'|'createdAt'|'updatedAt'|'cleanupPending'>>,policy:RetentionPolicy,physical:ReadonlySet<string>,referenced:ReadonlySet<string>,at=Date.now()){
  if(!Value.Check(RetentionPolicySchema,policy)||policy.olderThanDays===undefined&&policy.keepLatest===undefined)throw requestError('History cleanup requires olderThanDays or keepLatest. No history has been deleted.');
  const cutoff=policy.olderThanDays===undefined?Infinity:at-policy.olderThanDays*86400000;
  const ordered=[...runs].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const protectedCounts={active:0,ancestry:0,recent:0};const candidates:Array<{id:string;updatedAt:string}>=[];
  ordered.forEach((run,index)=>{
    if(!['completed','failed','cancelled','interrupted'].includes(run.state)||physical.has(run.id)||run.cleanupPending){protectedCounts.active++;return;}
    if(referenced.has(run.id)){protectedCounts.ancestry++;return;}
    const updated=Date.parse(run.updatedAt);
    if(index<(policy.keepLatest??0)||!Number.isFinite(updated)||updated>=cutoff){protectedCounts.recent++;return;}
    candidates.push({id:run.id,updatedAt:run.updatedAt});
  });
  return {candidates,protected:protectedCounts,total:ordered.length};
}
