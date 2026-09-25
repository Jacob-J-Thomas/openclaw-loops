import {requestError,executionError} from './errors.js';
import { Type, type Static, type TObject } from 'typebox';
import { Value } from 'typebox/value';
import {defaultBudgets,legacyBudgets,type Budgets} from './budgets.js';
import {identifierSchema as key,NodeSchema,ContextNodeSchema,LegacyNodeSchema,nodeContract,childNodes,type GraphNode,type Predicate,type Json} from './node-contracts.js';
import {assertMutableContextPath,bindingTokens,contextBindingSegments,contextPatchLiteral,contextPathForBinding,pathSegments,type ContextNodeConfig} from './context.js';
import {isJson,literalValue,type NodeValue} from './node-values.js';
import {evaluatorConfigurationIssue} from './evaluation-authoring.js';
export {isJson} from './node-values.js';
export {NodeSchema,PredicateSchema,type GraphNode,type Predicate,type Json} from './node-contracts.js';
const obj={additionalProperties:false} as const;
export const DefinitionFields = {
  schemaVersion:Type.Union([Type.Literal(1),Type.Literal(2),Type.Literal(3)]), id:key, slug:key, name:Type.String({minLength:1,maxLength:100}),
  description:Type.String({maxLength:500}), revision:Type.Integer({minimum:0}),
  inputSchema:Type.Array(Type.Object({name:key,label:Type.String({minLength:1,maxLength:100}),type:Type.Union([Type.Literal('text'),Type.Literal('number'),Type.Literal('boolean'),Type.Literal('json')]),required:Type.Boolean()},obj)),
  nodes:Type.Array(ContextNodeSchema,{minItems:2}),
  edges:Type.Array(Type.Object({id:key,source:key,target:key,port:Type.Union([Type.Literal('next'),Type.Literal('true'),Type.Literal('false'),Type.Literal('approve'),Type.Literal('reject')])},obj)),
  layout:Type.Record(key,Type.Object({x:Type.Number({minimum:-10000,maximum:10000}),y:Type.Number({minimum:-10000,maximum:10000})},obj)),
  capabilities:Type.Array(Type.Union([Type.Literal('llm'),Type.Literal('model-info')]),{maxItems:2,uniqueItems:true}),
  limits:Type.Object({maxExecutions:Type.Integer({minimum:2}),timeoutMs:Type.Optional(Type.Integer({minimum:1000})),maxOutputBytes:Type.Integer({minimum:128})},obj),
};
const v2Layout=Type.Record(key,Type.Object({x:Type.Number({minimum:-Number.MAX_SAFE_INTEGER,maximum:Number.MAX_SAFE_INTEGER}),y:Type.Number({minimum:-Number.MAX_SAFE_INTEGER,maximum:Number.MAX_SAFE_INTEGER})},obj));
export const DefinitionVersionSchemas={
  1:Type.Object({...DefinitionFields,schemaVersion:Type.Literal(1),nodes:Type.Array(LegacyNodeSchema,{minItems:2}),limits:Type.Required(DefinitionFields.limits,obj)},obj),
  2:Type.Object({...DefinitionFields,schemaVersion:Type.Literal(2),nodes:Type.Array(NodeSchema,{minItems:2}),layout:v2Layout},obj),
  3:Type.Object({...DefinitionFields,schemaVersion:Type.Literal(3),layout:v2Layout},obj),
};
// Editable state can be temporarily inconsistent while a user changes format.
// Public validation still enforces the discriminated version schemas below.
export type Definition=Static<TObject<typeof DefinitionFields>>;
export const DefinitionSchema=Type.Unsafe<Definition>(Type.Union([DefinitionVersionSchemas[1],DefinitionVersionSchemas[2],DefinitionVersionSchemas[3]]));
// Portable graph content excludes server identity and runtime state. Authoring
// operations take activation as a separate enabled flag, not an imported grant.
const {schemaVersion:_schemaVersion,id:_id,revision:_revision,...definitionContentFields}=DefinitionFields;
export const DefinitionContentSchema=Type.Object({...definitionContentFields,schemaVersion:Type.Optional(Type.Union([Type.Literal(2),Type.Literal(3)]))},obj);
export const DefinitionPatchSchema=Type.Partial(DefinitionContentSchema,{...obj,minProperties:1});
export type DefinitionContent=Static<typeof DefinitionContentSchema>;
export type DefinitionPatch=Static<typeof DefinitionPatchSchema>;
export function parseDefinitionContent(value:unknown,budgets:Budgets=defaultBudgets):DefinitionContent{
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>budgets.definitionBytes||!Value.Check(DefinitionContentSchema,value))throw requestError('New definition fields do not match schemaVersion 2 or 3, or exceed the configured definition budget. Identity and revision are assigned by the server.');
  return structuredClone(value);
}
export function parseDefinitionPatch(value:unknown,budgets:Budgets=defaultBudgets):DefinitionPatch{
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>budgets.definitionBytes||!Value.Check(DefinitionPatchSchema,value))throw requestError('Supply at least one editable definition field within the configured definition budget. Identity and grants are server-owned; pass enabled separately to change activation.');
  return structuredClone(value);
}
export type Capability = Definition['capabilities'][number];
export type Issue = {nodeId?:string;message:string};
export const ports=(node:GraphNode):string[]=>[...nodeContract(node.kind).ports];
export function parseDefinition(value:unknown,budgets:Budgets=defaultBudgets):Definition {
  if (!Value.Check(DefinitionSchema,value)) throw requestError('Definition does not match schemaVersion 1, 2 or 3.');
  const budget=value.schemaVersion===1?legacyBudgets.definitionBytes:budgets.definitionBytes;
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>budget)throw requestError(`Definition exceeds its ${budget}-byte transport budget.`);
  return structuredClone(value);
}
export function validateGraph(d:Definition):Issue[] {
  const issues:Issue[]=[];
  const error=(message:string,nodeId?:string)=>issues.push({message,...nodeId?{nodeId}:{}});
  const ids=new Set<string>();
  for(const n of d.nodes){
    if(ids.has(n.id))error('Node IDs must be unique.',n.id);
    ids.add(n.id);
    for(const b of childNodes(n)){if(ids.has(b.id)||d.nodes.some(x=>x.id===b.id))error('Body node IDs must be unique.',n.id);ids.add(b.id);}
  }
  if(d.schemaVersion===3)for(const node of d.nodes.flatMap(node=>[node,...childNodes(node)])){
    if(node.kind==='evaluate'){const issue=evaluatorConfigurationIssue(node.evaluator);if(issue)error(issue,node.id);}
    const context=node.context;
    if(!context)continue;
    try{
      if(context.projection.mode==='consume')for(const path of context.projection.paths)pathSegments(path);
      if(context.patch.mode!=='omit'){
        assertMutableContextPath(context.patch.target);
        if(context.patch.source.kind==='output'&&context.patch.source.path!==undefined)pathSegments(context.patch.source.path);
      }
    }catch(cause){error(cause instanceof Error?cause.message:'Invalid context configuration.',node.id);}
  }
  if(new Set(d.inputSchema.map(f=>f.name)).size!==d.inputSchema.length)error('Input names must be unique.');
  const entries=d.nodes.filter(n=>n.kind==='input');
  if(entries.length!==1)error('Exactly one Input node is required.');
  const edgeIds=new Set<string>();
  for(const e of d.edges){
    if(edgeIds.has(e.id))error('Edge IDs must be unique.',e.source);edgeIds.add(e.id);
    if(!d.nodes.some(n=>n.id===e.source)||!d.nodes.some(n=>n.id===e.target))error('Edge endpoint does not exist.',e.source);
    if(entries.some(n=>n.id===e.target))error('Input cannot have an incoming edge.',e.target);
  }
  for(const n of d.nodes){
    const outgoing=d.edges.filter(e=>e.source===n.id);
    for(const p of ports(n))if(outgoing.filter(e=>e.port===p).length!==1)error(`Connect exactly one ${p} edge.`,n.id);
    if(outgoing.some(e=>!ports(n).includes(e.port)))error('Unexpected outgoing port.',n.id);
    for(const capability of nodeContract(n.kind).capabilities)if(!d.capabilities.includes(capability))error(`Declare the ${capability} capability.`,n.id);
  }
  const visited=new Set<string>(),active=new Set<string>();
  function visit(id:string){if(active.has(id)){error('Graph cycles are forbidden; use Repeat.',id);return;}if(visited.has(id))return;active.add(id);visited.add(id);for(const e of d.edges.filter(e=>e.source===id))visit(e.target);active.delete(id);}
  if(entries.length===1)visit(entries[0].id);
  for(const n of d.nodes)if(!visited.has(n.id))error('Node is unreachable from Input.',n.id);
  if(!d.nodes.some(n=>nodeContract(n.kind).terminal))error('A terminal Return or Fail is required.');
  // A binding must name an input, or a node that dominates the consuming node.
  const predecessors=(id:string)=>d.edges.filter(e=>e.target===id).map(e=>e.source);
  const all=new Set(d.nodes.map(n=>n.id));
  const dom=new Map(d.nodes.map(n=>[n.id,new Set(n.kind==='input'?[n.id]:all)]));
  for(let pass=0;pass<d.nodes.length;pass++)for(const n of d.nodes.filter(n=>n.kind!=='input')){
    const pred=predecessors(n.id);const common=new Set(pred.length?[...(dom.get(pred[0])??[])].filter(x=>pred.every(p=>dom.get(p)?.has(x))):[]);
    common.add(n.id);dom.set(n.id,common);
  }
  if(d.schemaVersion===3)for(const node of d.nodes)if(node.kind==='gate'){
    const evaluation=d.nodes.find(candidate=>candidate.id===node.evaluationId);
    if(!evaluation||evaluation.kind!=='evaluate')error('Evidence gate must name an Evaluate node.',node.id);
    else if(!dom.get(node.id)?.has(evaluation.id))error('Evidence gate requires its Evaluate node to dominate every path into the gate.',node.id);
  }
  const checkText=(s:NodeValue,n:GraphNode,{bodyPrior=[],dominator=n,repeatScope=n.kind==='repeat',reportNode=n,contextReportNode=n}:{bodyPrior?:string[];dominator?:GraphNode;repeatScope?:boolean;reportNode?:GraphNode;contextReportNode?:GraphNode}={})=>{
    const report=(message:string)=>error(message,reportNode.id),reportContext=(message:string)=>error(message,contextReportNode.id);
    if(typeof s!=='string'){
      if(d.schemaVersion===1)report('Literal JSON values require a version 2 definition.');
      else try{literalValue(s.literalJson);}catch(cause){report(cause instanceof Error?cause.message:'Invalid literal JSON.');}
      return;
    }
    const bindings=bindingTokens(s);
    for(const binding of bindings.tokens){
      const path=binding.raw.trim();
      const contextPath=d.schemaVersion===3?contextPathForBinding(path):undefined;
      const pattern=d.schemaVersion===1?/^(input\.[a-z][\w-]*|nodes\.[a-z][\w-]*\.(text|value|succeeded|iterations|exhausted|provider|model|agentId)|repeat\.index)$/:/^(input\.[a-z][\w-]*(?:\.[\w-]+)*|nodes\.[a-z][\w-]*\.[a-z][\w-]*(?:\.[\w-]+)*|repeat\.index)$/;
      if(!contextPath&&(!pattern.test(path)||path.split('.').some(p=>['__proto__','constructor','prototype'].includes(p)))){report(`Unsupported binding: ${path}`);continue;}
      if(contextPath){
        const context=(n as GraphNode & {context?:ContextNodeConfig}).context;
        if(!context||context.projection.mode!=='consume'||!context.projection.paths.some((candidate:string)=>contextPath===candidate||contextPath.startsWith(`${candidate}/`))){reportContext(`Context binding is not projected: ${path}`);}
        continue;
      }
      const [root,id,field]=path.split('.');
      if(root==='input'&&!d.inputSchema.some(f=>f.name===id))report(`Unknown input: ${id}`);
      if(root==='repeat'&&!repeatScope)report('repeat.index is only available inside Repeat.');
      if(root==='nodes'&&!bodyPrior.includes(id)&&(id===n.id||!dom.get(dominator.id)?.has(id)))report(`Binding ${id} is not guaranteed to have executed.`);
      if(root==='nodes'){
        const producer=d.nodes.flatMap(node=>[node,...childNodes(node)]).find(node=>node.id===id);
        const fields=producer?outputFields(producer):[];
        if(producer&&!fields.includes(field))report(`Node ${id} (${producer.kind}) does not produce ${field}.`);
      }
    }
    if(bindings.unclosed)report('Unclosed binding.');
  };
  for(const node of d.nodes){
    if(node.kind!=='repeat')for(const binding of nodeContract(node.kind).bindings(node))checkText(binding.text,node,{bodyPrior:binding.prior});
    const literal=(node as GraphNode & {context?:ContextNodeConfig}).context&&contextPatchLiteral((node as GraphNode & {context?:ContextNodeConfig}).context!);
    if(literal!==undefined)checkText(literal,node);
  }
  // Repeat body nodes execute in order but use their own context projections.
  // Validate their full bindings against the parent graph dominance relation.
  for(const parent of d.nodes)if(parent.kind==='repeat'){
    const [inference,condition]=parent.body,inferenceNode=inference as GraphNode,conditionNode=condition as GraphNode;
    for(const binding of nodeContract(inference.kind).bindings(inference))checkText(binding.text,inferenceNode,{dominator:parent,repeatScope:true,reportNode:parent});
    const inferenceLiteral=inferenceNode.context&&contextPatchLiteral(inferenceNode.context);if(inferenceLiteral!==undefined)checkText(inferenceLiteral,inferenceNode,{dominator:parent,repeatScope:true});
    for(const binding of nodeContract(condition.kind).bindings(condition))checkText(binding.text,conditionNode,{bodyPrior:[inference.id],dominator:parent,repeatScope:true,reportNode:parent});
    const conditionLiteral=conditionNode.context&&contextPatchLiteral(conditionNode.context);if(conditionLiteral!==undefined)checkText(conditionLiteral,conditionNode,{bodyPrior:[inference.id],dominator:parent,repeatScope:true});
  }
  return issues;
}
export function validateInput(d:Definition,value:unknown,budgets:Budgets=defaultBudgets):Record<string,Json>{
  const budget=d.schemaVersion===1?legacyBudgets.inputBytes:budgets.inputBytes;
  if(!value||typeof value!=='object'||Array.isArray(value)||new TextEncoder().encode(JSON.stringify(value)).byteLength>budget)throw requestError(`Input must be a JSON object of at most ${budget===16000?'16 KB':`${budget} bytes`}.`);
  const input=value as Record<string,Json>;
  for(const k of Object.keys(input))if(!d.inputSchema.some(f=>f.name===k))throw requestError(`Unexpected input: ${k}`);
  for(const f of d.inputSchema){const v=input[f.name];if(v===undefined&&!f.required)continue;if(f.type==='json'){if(d.schemaVersion===1||v===undefined||!isJson(v))throw requestError(`Input ${f.name} must be valid JSON in a version 2 or 3 definition.`);}else if(typeof v!==(f.type==='text'?'string':f.type)||typeof v==='number'&&!Number.isFinite(v))throw requestError(`Input ${f.name} must be ${f.type}.`);}
  return structuredClone(input);
}
export type BindingContext={input:Record<string,Json>;nodes:Record<string,Json>;context?:Record<string,Json>;repeat?:{index:number}};
export function bind(template:NodeValue,ctx:BindingContext):Json{
  if(typeof template!=='string')return literalValue(template.literalJson);
  const resolve=(raw:string):Json=>{const contextParts=contextBindingSegments(raw.trim()),parts=contextParts?['context',...contextParts]:raw.trim().split('.');let value:unknown=ctx;for(const part of parts){if(['__proto__','prototype','constructor'].includes(part)||!value||typeof value!=='object'||!Object.hasOwn(value,part))throw executionError(`Binding unavailable: ${raw}`,'LOOPS_BINDING_UNAVAILABLE');value=(value as Record<string,unknown>)[part];}if(value===undefined)throw executionError(`Binding unavailable: ${raw}`,'LOOPS_BINDING_UNAVAILABLE');return value as Json;};
  const bindings=bindingTokens(template);
  if(bindings.tokens.length===1&&bindings.tokens[0].start===0&&bindings.tokens[0].end===template.length)return resolve(bindings.tokens[0].raw);
  let rendered='',cursor=0;
  for(const binding of bindings.tokens){rendered+=template.slice(cursor,binding.start);const value=resolve(binding.raw);rendered+=typeof value==='string'?value:JSON.stringify(value);cursor=binding.end;}
  return rendered+template.slice(cursor);
}
export const display=(value:Json):string=>typeof value==='string'?value:JSON.stringify(value);
export function compare(p:Predicate,ctx:BindingContext,version:1|2|3=1):boolean{
  const l=bind(p.left,ctx);
  if(p.op==='truthy')return l===true||l==='true';
  const r=bind(p.right,ctx);
  switch(p.op){case'equals':return version===1?display(l)===display(r):equalJson(l,r);case'not-equals':return version===1?display(l)!==display(r):!equalJson(l,r);case'contains':return version!==1&&Array.isArray(l)?l.some(value=>equalJson(value,r)):display(l).includes(display(r));case'less-than':return version!==1?typeof l==='number'&&typeof r==='number'&&l<r:Number.isFinite(Number(l))&&Number.isFinite(Number(r))&&Number(l)<Number(r);case'greater-than':return version!==1?typeof l==='number'&&typeof r==='number'&&l>r:Number.isFinite(Number(l))&&Number.isFinite(Number(r))&&Number(l)>Number(r);}
}
function equalJson(left:Json,right:Json):boolean{if(left===right)return true;if(typeof left!==typeof right||!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;const entries=Object.entries(left);return entries.length===Object.keys(right).length&&entries.every(([key,value])=>Object.hasOwn(right,key)&&equalJson(value,(right as Record<string,Json>)[key]));}
export function outputFields(node:GraphNode):string[]{return nodeContract(node.kind).outputFields(node);}
