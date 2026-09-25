import React from 'react';
import type {ContextLifecycle} from './context-lifecycle.js';
import type {NodeValue} from './node-values.js';
import type {GraphNode} from './graph.js';
import type {InferenceCapabilities,InferenceSettings} from './inference-settings.js';
import {InferenceEditor} from './inference-editor.js';
import {ValueEditor} from './value-editor.js';

const operations=['retrieve','inject','summarize','compact','reset'] as const;
const lines=(value:string)=>value.split('\n').map(path=>path.trim()).filter(Boolean);

export function ContextLifecycleEditor({value,onChange,loadCapabilities}:{value:ContextLifecycle;onChange:(value:ContextLifecycle)=>void;loadCapabilities:(settings:InferenceSettings)=>Promise<InferenceCapabilities>}){
  const update=(next:Partial<ContextLifecycle>)=>onChange({...value,...next});
  const source=value.source?.kind??'';
  return <section aria-label="Context lifecycle settings"><p className="lp-hint">Each operation uses only these explicit JSON Pointer paths. Compact and reset retain a durable before-state record; summaries send only this declared selection to the configured completion adapter.</p>
    <label className="lp-field"><span>Operation</span><select value={value.operation} onChange={event=>{const operation=event.target.value as ContextLifecycle['operation'];const next={...value,operation};if(operation!=='inject')delete next.value;if(operation==='summarize'||operation==='compact')delete next.source;if(operation==='inject'&&!next.source&&next.value===undefined)next.value={literalJson:'null'};onChange(next);}}>{operations.map(operation=><option key={operation} value={operation}>{operation}</option>)}</select></label>
    <label className="lp-field"><span>Write target (JSON Pointer)</span><input aria-label="Lifecycle write target" value={value.target} onChange={event=>update({target:event.target.value})}/></label>
    <label className="lp-field"><span>Selected paths, one JSON Pointer per line</span><textarea aria-label="Lifecycle selected paths" rows={4} value={value.paths.join('\n')} onChange={event=>update({paths:lines(event.target.value)})}/></label>
    {!['summarize','compact'].includes(value.operation)&&<><label className="lp-field"><span>Source</span><select aria-label="Lifecycle source" value={source} onChange={event=>{const kind=event.target.value;const next={...value};if(!kind){delete next.source;if(value.operation==='inject'&&next.value===undefined)next.value={literalJson:'null'};}else {delete next.value;next.source=kind==='initial'?{kind:'initial'}:{kind:'retained',sourceId:'',format:'snapshot'};}onChange(next);}}><option value="">{value.operation==='inject'?'Authored value':'Choose a source'}</option><option value="initial">Initial input snapshot</option><option value="retained">Retained source ID</option></select></label>
    {value.source?.kind==='retained'&&<><label className="lp-field"><span>Retained source ID</span><input aria-label="Retained source ID" value={value.source.sourceId} onChange={event=>update({source:{...value.source as Extract<ContextLifecycle['source'],{kind:'retained'}>,sourceId:event.target.value}})}/></label><label className="lp-field"><span>Retained source format</span><select value={value.source.format??'snapshot'} onChange={event=>update({source:{...value.source as Extract<ContextLifecycle['source'],{kind:'retained'}>,format:event.target.value as 'snapshot'|'document'}})}><option value="snapshot">Lifecycle snapshot</option><option value="document">JSON document</option></select></label></>}</>}
    {value.operation==='inject'&&!value.source&&<ValueEditor label="Explicit JSON value or binding" value={value.value??{literalJson:'null'}} literals onChange={item=>update({value:item as NodeValue})}/>}
    {(value.operation==='summarize'||value.operation==='compact')&&<><ValueEditor label="Authored summary instructions" rows={5} value={value.instructions??''} literals onChange={instructions=>update({instructions})}/><InferenceEditor node={{id:'lifecycle-settings',kind:'inference',label:'Lifecycle settings',prompt:'',output:'text',...value.model?{model:value.model}:{},...value.agentId?{agentId:value.agentId}:{},...value.reasoning?{reasoning:value.reasoning}:{},...value.advanced?{advanced:value.advanced}:{}} as Extract<GraphNode,{kind:'inference'}>} onChange={settings=>update({model:settings.model,agentId:settings.agentId,reasoning:settings.reasoning,advanced:settings.advanced})} loadCapabilities={loadCapabilities}/></>}
    <label className="lp-field"><span>Reason retained with this change</span><textarea rows={2} value={value.reason??''} onChange={event=>update({reason:event.target.value||undefined})}/></label>
  </section>;
}
