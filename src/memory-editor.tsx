import React from 'react';
import type {Definition,GraphNode} from './graph.js';
import type {MemoryNodeConfig,MemoryNodeOperation} from './memory-node.js';
import type {MemoryNodePolicy,MemoryPolicy,MemoryWriteScope} from './memory-policy.js';
import type {MemorySchemaEntry} from './memory-definition.js';
import type {DataSchema} from './data-schema.js';
import {ValueEditor} from './value-editor.js';
import {DataSchemaEditor,memorySchemaScope,type DataSchemaDrafts,type SchemaEdit} from './data-schema-editor.js';

const operations:MemoryNodeOperation[]=['consume','search','inspect','write','update','forget','mutation','retention-preview','retention-apply','reset-preview','reset-apply'];
const lines=(text:string)=>text.split('\n').map(value=>value.trim()).filter(Boolean);
const emptyRule=():MemoryNodePolicy=>({readPrefixes:[],writeScopes:[],forgetPrefixes:[]});
const emptyScope=():MemoryWriteScope=>({prefix:'notes',schemaId:'note',schemaVersion:1,retentionDays:30});
const schemaKey=(entry:Pick<MemorySchemaEntry,'id'|'version'>)=>`${entry.id}:${entry.version}`;
const record=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string');
const scopeShape=(value:unknown):value is MemoryWriteScope=>record(value)&&typeof value.prefix==='string'&&typeof value.schemaId==='string'&&typeof value.schemaVersion==='number'&&typeof value.retentionDays==='number';

export function MemoryEditor({node,definition,onNodeChange,onDefinitionChange,drafts,onDraftValidityChange,lockedSchemaKeys}:{node:Extract<GraphNode,{kind:'memory'}>;definition:Definition;onNodeChange:(node:GraphNode)=>void;onDefinitionChange:(definition:Definition,edit?:SchemaEdit)=>void;drafts:DataSchemaDrafts;onDraftValidityChange:()=>void;lockedSchemaKeys:ReadonlySet<string>}){
  const config=node.memory,enabled=definition.memoryPolicy?.enabled===true;
  // Invalid imported policies remain authored drafts. Inspect their unknown
  // fields without normalizing them until the author chooses a repair.
  const rawPolicy=definition.memoryPolicy as unknown;
  const rawNodes=enabled&&record(rawPolicy)?rawPolicy.nodes:undefined;
  const nodes=record(rawNodes)?rawNodes:undefined;
  const rawRule=nodes?.[node.id];
  const rule=record(rawRule)&&strings(rawRule.readPrefixes)&&strings(rawRule.forgetPrefixes)&&Array.isArray(rawRule.writeScopes)&&rawRule.writeScopes.every(scopeShape)?rawRule as MemoryNodePolicy:undefined;
  const selectedInvalid=enabled&&nodes!==undefined&&rawRule!==undefined&&!rule;
  const diagnostic=enabled&&!nodes?'Memory node collection is invalid. Repair it explicitly before editing scopes.':selectedInvalid?'This Memory node policy has invalid collections or write scopes. Repair the affected fields explicitly.':undefined;
  const carriedNodes=()=>nodes??{};
  const changePolicy=(nextNodes:Record<string,unknown>)=>onDefinitionChange({...definition,memoryPolicy:{version:1,enabled:true,nodes:nextNodes} as MemoryPolicy});
  const update=(patch:Partial<MemoryNodeConfig>)=>onNodeChange({...node,memory:{...config,...patch}});
  const updateRule=(next:MemoryNodePolicy)=>changePolicy({...carriedNodes(),[node.id]:next});
  const updateScope=(index:number,next:MemoryWriteScope)=>{
    if(!rule)return;
    const scopes=rule.writeScopes.map((scope,at)=>at===index?next:scope);
    const schemas=definition.memorySchemas??[],previous=rule.writeScopes[index]!;
    const oldKey=schemaKey({id:previous.schemaId,version:previous.schemaVersion}),newKey=schemaKey({id:next.schemaId,version:next.schemaVersion});
    const referencedElsewhere=Object.entries(carriedNodes()).some(([id,entry])=>record(entry)&&Array.isArray(entry.writeScopes)&&entry.writeScopes.some((scope:unknown,at:number)=>scopeShape(scope)&&(id!==node.id||at!==index)&&schemaKey({id:scope.schemaId,version:scope.schemaVersion})===oldKey));
    const moveCatalog=oldKey!==newKey&&!lockedSchemaKeys.has(oldKey)&&!referencedElsewhere;
    const oldEntry=schemas.find(entry=>schemaKey(entry)===oldKey),targetExists=schemas.some(entry=>schemaKey(entry)===newKey);
    const retained=moveCatalog?schemas.filter(entry=>schemaKey(entry)!==oldKey):schemas;
    const catalog=targetExists?retained:[...retained,{id:next.schemaId,version:next.schemaVersion,schema:structuredClone(oldEntry?.schema??{type:'json' as const})}];
    const rename=moveCatalog&&!targetExists?{rename:{from:memorySchemaScope(definition.id,previous.schemaId,previous.schemaVersion),to:memorySchemaScope(definition.id,next.schemaId,next.schemaVersion)}}:undefined;
    onDefinitionChange({...definition,memoryPolicy:{version:1,enabled:true,nodes:{...carriedNodes(),[node.id]:{...rule,writeScopes:scopes}}} as MemoryPolicy,memorySchemas:catalog},rename);
  };
  return <section aria-label="Memory node settings"><p className="lp-hint">Memory is plugin-owned and absent unless this loop enables an authored policy. Keys are scoped to this loop and the current agent conversation. Nothing enters a prompt unless another node explicitly binds this node’s output.</p>
    <label className="lp-field"><span>Memory operation</span><select value={config.operation} onChange={event=>{const operation=event.target.value as MemoryNodeOperation,next:{operation:MemoryNodeOperation;key:MemoryNodeConfig['key'];value?:MemoryNodeConfig['value'];expectedVersion?:MemoryNodeConfig['expectedVersion'];plan?:MemoryNodeConfig['plan'];limit?:number}={...config,operation};if(!['write','update'].includes(operation))delete next.value;else next.value??={literalJson:'null'};if(!['update','forget'].includes(operation))delete next.expectedVersion;else next.expectedVersion??={literalJson:'1'};if(!operation.endsWith('-apply'))delete next.plan;else next.plan??='{{nodes.preview.planId}}';onNodeChange({...node,memory:next});}}>{operations.map(operation=><option key={operation}>{operation}</option>)}</select></label>
    <ValueEditor label={config.operation==='mutation'?'Mutation ID':config.operation.includes('retention')||config.operation.includes('reset')||config.operation==='search'?'Memory key prefix':'Memory key'} value={config.key} literals onChange={key=>update({key})}/>
    {['write','update'].includes(config.operation)&&<ValueEditor label="Memory JSON value" value={config.value??{literalJson:'null'}} literals onChange={value=>update({value})}/>}
    {['update','forget'].includes(config.operation)&&<ValueEditor label="Expected memory version" value={config.expectedVersion??{literalJson:'1'}} literals onChange={expectedVersion=>update({expectedVersion})}/>}
    {config.operation.endsWith('-apply')&&<><p className="lp-hint">Bind the plan ID from an earlier preview node, for example {'{{nodes.preview.planId}}'}. The inventory is checked again before removal.</p><ValueEditor label="Memory removal preview plan ID" value={config.plan??'{{nodes.preview.planId}}'} literals onChange={plan=>update({plan})}/></>}
    {config.operation==='search'&&<label className="lp-field"><span>Search page limit</span><input type="number" min={1} max={50} value={config.limit??20} onChange={event=>update({limit:Number(event.target.value)})}/></label>}
    <details open><summary>Authored memory policy</summary><label className="lp-check"><input type="checkbox" checked={enabled} onChange={event=>onDefinitionChange({...definition,memoryPolicy:event.target.checked?{version:1,enabled:true,nodes:{...carriedNodes(),[node.id]:rule??emptyRule()}} as MemoryPolicy:{version:1,enabled:false}})}/>Enable memory for this loop</label>
      {diagnostic&&<p role="alert">{diagnostic}</p>}
      {enabled&&!nodes&&<button type="button" onClick={()=>changePolicy({[node.id]:emptyRule()})}>Repair memory node collection</button>}
      {enabled&&nodes&&!rule&&<>
        {rawRule===undefined||!record(rawRule)?<button type="button" onClick={()=>changePolicy({...nodes,[node.id]:emptyRule()})}>Repair this Memory node policy</button>:<>
          {!strings(rawRule.readPrefixes)&&<button type="button" onClick={()=>changePolicy({...nodes,[node.id]:{...rawRule,readPrefixes:[]}})}>Repair read prefixes</button>}
          {!strings(rawRule.forgetPrefixes)&&<button type="button" onClick={()=>changePolicy({...nodes,[node.id]:{...rawRule,forgetPrefixes:[]}})}>Repair forget prefixes</button>}
          {!Array.isArray(rawRule.writeScopes)&&<button type="button" onClick={()=>changePolicy({...nodes,[node.id]:{...rawRule,writeScopes:[]}})}>Repair write scopes</button>}
          {Array.isArray(rawRule.writeScopes)&&rawRule.writeScopes.map((scope:unknown,index:number)=>!scopeShape(scope)&&<button key={index} type="button" onClick={()=>changePolicy({...nodes,[node.id]:{...rawRule,writeScopes:(rawRule.writeScopes as unknown[]).map((entry,at)=>at===index?emptyScope():entry)}})}>Repair write scope {index+1}</button>)}
        </>}
      </>}
      {enabled&&rule&&<><label className="lp-field"><span>Read key prefixes, one per line</span><textarea aria-label="Memory read prefixes" value={rule.readPrefixes.join('\n')} onChange={event=>updateRule({...rule,readPrefixes:lines(event.target.value)})}/></label>
      <label className="lp-field"><span>Forget/reset key prefixes, one per line</span><textarea aria-label="Memory forget prefixes" value={rule.forgetPrefixes.join('\n')} onChange={event=>updateRule({...rule,forgetPrefixes:lines(event.target.value)})}/></label>
      <h4>Write scopes and versioned JSON schemas</h4>{rule.writeScopes.map((scope,index)=>{
        const entry=definition.memorySchemas?.find(item=>item.id===scope.schemaId&&item.version===scope.schemaVersion);
        return <div key={index} className="lp-memory-scope"><label className="lp-field"><span>Write prefix {index+1}</span><input value={scope.prefix} onChange={event=>updateScope(index,{...scope,prefix:event.target.value})}/></label><label className="lp-field"><span>Schema ID</span><input value={scope.schemaId} onChange={event=>updateScope(index,{...scope,schemaId:event.target.value})}/></label><label className="lp-field"><span>Schema version</span><input type="number" min={1} value={scope.schemaVersion} onChange={event=>updateScope(index,{...scope,schemaVersion:Number(event.target.value)})}/></label><label className="lp-field"><span>Retention days</span><input type="number" min={0} max={3650} value={scope.retentionDays} onChange={event=>updateScope(index,{...scope,retentionDays:Number(event.target.value)})}/></label>
          <DataSchemaEditor label={`${scope.schemaId} v${scope.schemaVersion} memory schema`} value={entry?.schema} scope={memorySchemaScope(definition.id,scope.schemaId,scope.schemaVersion)} drafts={drafts} onDraftValidityChange={onDraftValidityChange} onChange={(schema,rename)=>{const entries=definition.memorySchemas??[];const next=entries.filter(item=>schemaKey(item)!==schemaKey({id:scope.schemaId,version:scope.schemaVersion}));if(schema)next.push({id:scope.schemaId,version:scope.schemaVersion,schema:schema as DataSchema});onDefinitionChange({...definition,memorySchemas:next},rename?{rename}:undefined);}}/>
          <button type="button" onClick={()=>updateRule({...rule,writeScopes:rule.writeScopes.filter((_,at)=>at!==index)})}>Remove write scope</button></div>;
      })}<button type="button" onClick={()=>{const scope=emptyScope();onDefinitionChange({...definition,memoryPolicy:{version:1,enabled:true,nodes:{...carriedNodes(),[node.id]:{...rule,writeScopes:[...rule.writeScopes,scope]}}} as MemoryPolicy,memorySchemas:[...(definition.memorySchemas??[]),...definition.memorySchemas?.some(entry=>schemaKey(entry)===schemaKey({id:scope.schemaId,version:scope.schemaVersion}))?[]:[{id:scope.schemaId,version:scope.schemaVersion,schema:{type:'json' as const}}]]});}}>Add write scope</button></>}
    </details>
  </section>;
}
