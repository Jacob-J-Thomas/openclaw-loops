import React,{useEffect,useState} from 'react';
import type {Evaluator} from './evaluation.js';

export type EvaluationDraft={kind:Evaluator['kind'];version:string;schemaSource:string;predicateOp:'equals'|'not-equals'|'contains'|'less-than'|'greater-than'|'truthy';expectedSource:string};
export const defaultEvaluationDraft:EvaluationDraft={kind:'json-schema-2020',version:'2020-12',schemaSource:'{"type":"object"}',predicateOp:'truthy',expectedSource:'null'};
export function evaluationDraft(evaluator:Evaluator):EvaluationDraft{
  return evaluator.kind==='json-schema-2020'?{...defaultEvaluationDraft,kind:evaluator.kind,version:evaluator.version,schemaSource:JSON.stringify(evaluator.schema,null,2)}:{...defaultEvaluationDraft,kind:evaluator.kind,version:evaluator.version,predicateOp:evaluator.predicate.op,expectedSource:JSON.stringify(evaluator.predicate.expected??null,null,2)};
}
export function parseEvaluationDraft(draft:EvaluationDraft):{evaluator?:Evaluator;error?:string}{
  if(!draft.version.trim())return {error:'Evaluator version is required.'};
  try{
    if(draft.kind==='json-schema-2020')return {evaluator:{kind:draft.kind,version:draft.version.trim(),schema:JSON.parse(draft.schemaSource)}};
    return {evaluator:{kind:draft.kind,version:draft.version.trim(),predicate:{op:draft.predicateOp,...draft.predicateOp==='truthy'?{}:{expected:JSON.parse(draft.expectedSource)}}}};
  }catch{return {error:'Schema and predicate expected value must each be valid JSON.'};}
}
export function EvaluationEditor({value,onChange}:{value:EvaluationDraft;onChange:(value:EvaluationDraft)=>void}){
  const parsed=parseEvaluationDraft(value);
  return <fieldset className="lp-evaluation-editor"><legend>Deterministic evaluation</legend><label className="lp-field"><span>Evaluator</span><select value={value.kind} onChange={event=>onChange({...value,kind:event.target.value as EvaluationDraft['kind']})}><option value="json-schema-2020">JSON Schema 2020-12</option><option value="predicate">Predicate</option></select></label><label className="lp-field"><span>Evaluator version</span><input value={value.version} onChange={event=>onChange({...value,version:event.target.value})}/></label>{value.kind==='json-schema-2020'?<label className="lp-field"><span>JSON Schema</span><textarea value={value.schemaSource} onChange={event=>onChange({...value,schemaSource:event.target.value})}/></label>:<><label className="lp-field"><span>Predicate</span><select value={value.predicateOp} onChange={event=>onChange({...value,predicateOp:event.target.value as EvaluationDraft['predicateOp']})}>{['equals','not-equals','contains','less-than','greater-than','truthy'].map(op=><option key={op}>{op}</option>)}</select></label>{value.predicateOp!=='truthy'&&<label className="lp-field"><span>Expected JSON value</span><textarea value={value.expectedSource} onChange={event=>onChange({...value,expectedSource:event.target.value})}/></label>}</>}{parsed.error&&<p className="lp-node-error" role="alert">{parsed.error}</p>}</fieldset>;
}
// Invalid JSON cannot become an Evaluator, so retain that local authoring state
// until it becomes valid. It is keyed by the graph node rather than component
// lifetime because selecting another node unmounts this editor.
const invalidDrafts=new Map<string,EvaluationDraft>();
export function ControlledEvaluationEditor({nodeId,evaluator,onChange}:{nodeId:string;evaluator:Evaluator;onChange:(evaluator:Evaluator)=>void}){
  const [draft,setDraft]=useState(()=>invalidDrafts.get(nodeId)??evaluationDraft(evaluator));
  useEffect(()=>setDraft(invalidDrafts.get(nodeId)??evaluationDraft(evaluator)),[nodeId,evaluator]);
  return <EvaluationEditor value={draft} onChange={next=>{setDraft(next);const parsed=parseEvaluationDraft(next);if(parsed.evaluator){invalidDrafts.delete(nodeId);onChange(parsed.evaluator);}else invalidDrafts.set(nodeId,next);}}/>;
}
