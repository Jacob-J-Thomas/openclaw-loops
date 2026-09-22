import {Type,type Static,type TSchema} from 'typebox';
import {AdvancedSchema,ReasoningSchema} from './inference-settings.js';
import {executionError} from './errors.js';
import {NodeValueSchema,type NodeValue,type Json} from './node-values.js';
import {ContextNodeConfigSchema,type ContextNodeConfig} from './context.js';
export type {Json,NodeValue} from './node-values.js';

export const identifierSchema=Type.String({pattern:'^(?!(?:constructor|prototype)$)[a-z][a-z0-9_-]{0,47}$'});
const text=Type.String(),strict={additionalProperties:false} as const;
const identity={id:identifierSchema,label:Type.String({minLength:1,maxLength:100})};
const predicateSchema=<V extends TSchema>(value:V)=>Type.Object({
  left:value,op:Type.Union([Type.Literal('equals'),Type.Literal('not-equals'),Type.Literal('contains'),Type.Literal('less-than'),Type.Literal('greater-than'),Type.Literal('truthy')]),right:value,
},strict);
export const PredicateSchema=predicateSchema(NodeValueSchema);
function schemasForValues<V extends TSchema>(value:V){
const inferenceSchema=Type.Object({...identity,kind:Type.Literal('inference'),prompt:value,output:Type.Union([Type.Literal('text'),Type.Literal('json')]),
  model:Type.Optional(Type.String({minLength:1,maxLength:300})),agentId:Type.Optional(identifierSchema),reasoning:Type.Optional(ReasoningSchema),advanced:Type.Optional(AdvancedSchema),
},strict);
const conditionSchema=Type.Object({...identity,kind:Type.Literal('condition'),predicate:predicateSchema(value)},strict);
return {
  input:Type.Object({...identity,kind:Type.Literal('input')},strict),
  inference:inferenceSchema,
  action:Type.Object({...identity,kind:Type.Literal('action'),capability:Type.Literal('model-info')},strict),
  condition:conditionSchema,
  repeat:Type.Object({...identity,kind:Type.Literal('repeat'),maxIterations:Type.Integer({minimum:1}),body:Type.Tuple([inferenceSchema,conditionSchema])},strict),
  wait:Type.Object({...identity,kind:Type.Literal('wait'),message:value},strict),
  review:Type.Object({...identity,kind:Type.Literal('review'),proposal:value},strict),
  return:Type.Object({...identity,kind:Type.Literal('return'),value},strict),
  fail:Type.Object({...identity,kind:Type.Literal('fail'),reason:value},strict),
};
}
const schemas=schemasForValues(NodeValueSchema),legacySchemas=schemasForValues(text);
export const NodeSchema=Type.Union([schemas.input,schemas.inference,schemas.action,schemas.condition,schemas.repeat,schemas.wait,schemas.review,schemas.return,schemas.fail]);
export const LegacyNodeSchema=Type.Union([legacySchemas.input,legacySchemas.inference,legacySchemas.action,legacySchemas.condition,legacySchemas.repeat,legacySchemas.wait,legacySchemas.review,legacySchemas.return,legacySchemas.fail]);
export type GraphNode=Static<typeof NodeSchema>&{context?:ContextNodeConfig};
const contextExtension=Type.Object({context:Type.Optional(ContextNodeConfigSchema)},strict);
const withContext=(schema:{properties:Record<string,TSchema>})=>Type.Object({...schema.properties,...contextExtension.properties},strict);
const contextSchemas={
  input:withContext(schemas.input),inference:withContext(schemas.inference),action:withContext(schemas.action),condition:withContext(schemas.condition),
  wait:withContext(schemas.wait),review:withContext(schemas.review),return:withContext(schemas.return),fail:withContext(schemas.fail),
};
const contextRepeatSchema=Type.Object({...identity,kind:Type.Literal('repeat'),maxIterations:Type.Integer({minimum:1}),body:Type.Tuple([contextSchemas.inference,contextSchemas.condition]),...contextExtension.properties},strict);
export const ContextNodeSchema=Type.Unsafe<GraphNode>(Type.Union([contextSchemas.input,contextSchemas.inference,contextSchemas.action,contextSchemas.condition,contextRepeatSchema,contextSchemas.wait,contextSchemas.review,contextSchemas.return,contextSchemas.fail]));
export type Predicate=Static<typeof PredicateSchema>;
export type NodeKind=GraphNode['kind'];
export type NodeOf<K extends NodeKind>=Extract<GraphNode,{kind:K}>;
export type NodeCapability='llm'|'model-info';
export type BindingUse={text:NodeValue;prior?:string[]};
export type NodeOutcome={output:Json;port?:string;park?:{state:'waiting'|'review';value:Json};returned?:boolean};
export type NodeExecutionContext={
  signal:AbortSignal;
  input:Record<string,Json>;
  bind:(template:NodeValue,node?:GraphNode)=>Json;
  compare:(predicate:Predicate,node?:GraphNode,iteration?:number)=>boolean;
  infer:(node:NodeOf<'inference'>,iteration?:number)=>Promise<Json>;
  modelInfo:()=>Promise<Json>;
  requireCapability:(capability:NodeCapability)=>void;
  checkAuthority:()=>void;
  begin:(node:GraphNode,iteration:number)=>number;
  finish:(checkpoint:number,output:Json)=>void;
  setOutput:(nodeId:string,output:Json)=>void;
  commitContext:(node:GraphNode,output:Json)=>void;
};
type NodeContract<K extends NodeKind>={
  schema:(typeof schemas)[K];
  ports:readonly string[];
  capabilities:readonly NodeCapability[];
  terminal:boolean;
  bindings:(node:NodeOf<K>)=>BindingUse[];
  outputFields:(node:NodeOf<K>)=>string[];
  execute:(node:NodeOf<K>,context:NodeExecutionContext)=>NodeOutcome|Promise<NodeOutcome>;
  editor:{
    title:string;icon:string;
    description:(node:NodeOf<K>)=>string;
    create:(id:string,fresh:(prefix:string)=>string,repeatIterations:number)=>NodeOf<K>;
  };
};
const predicateBindings=(predicate:Predicate):BindingUse[]=>[{text:predicate.left},...predicate.op==='truthy'?[]:[{text:predicate.right}]];
const inferenceFields=(node:NodeOf<'inference'>)=>['text','provider','model','agentId','usage','execution','audit','settings',...node.output==='json'?['value']:[]];
const noBindings=()=>[],noFields=()=>[];

// Internal, exhaustive registry for the current sequential palette. Execution
// receives capabilities and journal operations from the engine, never a host API
// or storage handle. Adding a kind must supply every part of this contract.
export const nodeContracts:{[K in NodeKind]:NodeContract<K>}={
  input:{schema:schemas.input,ports:['next'],capabilities:[],terminal:false,bindings:noBindings,outputFields:()=>['fields'],
    execute:(node,context)=>({output:{fields:Object.keys(context.input)}}),
    editor:{title:'Input',icon:'IN',description:()=> 'Named, validated values',create:id=>({id,kind:'input',label:'Input'})}},
  inference:{schema:schemas.inference,ports:['next'],capabilities:['llm'],terminal:false,bindings:node=>[{text:node.prompt}],outputFields:inferenceFields,
    execute:async(node,context)=>({output:await context.infer(node)}),
    editor:{title:'Inference',icon:'AI',description:()=> 'OpenClaw · one model call',create:id=>({id,kind:'inference',label:'Inference',prompt:'Summarize: {{input.text}}',output:'text'})}},
  action:{schema:schemas.action,ports:['next'],capabilities:['model-info'],terminal:false,bindings:noBindings,outputFields:()=>['provider','model','agentId'],
    execute:async(node,context)=>{context.requireCapability(node.capability);return {output:await context.modelInfo()};},
    editor:{title:'Model action',icon:'TOOL',description:()=> 'OpenClaw · model metadata',create:id=>({id,kind:'action',label:'Model action',capability:'model-info'})}},
  condition:{schema:schemas.condition,ports:['true','false'],capabilities:[],terminal:false,bindings:node=>predicateBindings(node.predicate),outputFields:()=>['value'],
    execute:(node,context)=>{const passed=context.compare(node.predicate,node);return {output:{value:passed},port:passed?'true':'false'};},
    editor:{title:'Condition',icon:'IF',description:node=>node.predicate.op,create:id=>({id,kind:'condition',label:'Condition',predicate:{left:'{{input.text}}',op:'equals',right:'yes'}})}},
  repeat:{schema:schemas.repeat,ports:['next'],capabilities:['llm'],terminal:false,
    bindings:node=>[{text:node.body[0].prompt},...predicateBindings(node.body[1].predicate).map(binding=>({...binding,prior:[node.body[0].id]}))],
    outputFields:node=>[...inferenceFields(node.body[0]),'succeeded','iterations','exhausted'],
    execute:async(node,context)=>{
      let succeeded=false,last:Json={};let iteration:number;
      for(iteration=1;iteration<=node.maxIterations;iteration++){
        context.signal.throwIfAborted();context.checkAuthority();
        const [inference,condition]=node.body;
        const inferenceCheckpoint=context.begin(inference,iteration);
        last=await context.infer(inference,iteration);context.signal.throwIfAborted();
        context.finish(inferenceCheckpoint,last);context.setOutput(inference.id,last);context.commitContext(inference,last);
        const conditionCheckpoint=context.begin(condition,iteration);
        succeeded=context.compare(condition.predicate,condition,iteration);context.finish(conditionCheckpoint,{value:succeeded});context.setOutput(condition.id,{value:succeeded});context.commitContext(condition,{value:succeeded});
        if(succeeded)break;
      }
      return {output:{...(last as Record<string,Json>),succeeded,iterations:Math.min(iteration,node.maxIterations),exhausted:!succeeded}};
    },
    editor:{title:'Repeat',icon:'↻',description:node=>`Inference → Condition · ≤ ${node.maxIterations}`,create:(id,fresh,maxIterations)=>({id,kind:'repeat',label:'Repeat',maxIterations,body:[{id:fresh('draft'),kind:'inference',label:'Draft',prompt:'Write a concise draft for: {{input.text}}',output:'text'},{id:fresh('check'),kind:'condition',label:'Check',predicate:{left:'true',op:'truthy',right:''}}]})}},
  wait:{schema:schemas.wait,ports:['next'],capabilities:[],terminal:false,bindings:node=>[{text:node.message}],outputFields:noFields,
    execute:(node,context)=>({output:{},park:{state:'waiting',value:context.bind(node.message,node)}}),
    editor:{title:'Wait',icon:'Ⅱ',description:()=> 'Durable manual checkpoint',create:id=>({id,kind:'wait',label:'Wait',message:'Continue when ready.'})}},
  review:{schema:schemas.review,ports:['approve','reject'],capabilities:[],terminal:false,bindings:node=>[{text:node.proposal}],outputFields:()=>['decision'],
    execute:(node,context)=>({output:{},park:{state:'review',value:context.bind(node.proposal,node)}}),
    editor:{title:'Human review',icon:'✓',description:()=> 'Authenticated human decision',create:id=>({id,kind:'review',label:'Human review',proposal:'{{input.text}}'})}},
  return:{schema:schemas.return,ports:[],capabilities:[],terminal:true,bindings:node=>[{text:node.value}],outputFields:noFields,
    execute:(node,context)=>({output:context.bind(node.value,node),returned:true}),
    editor:{title:'Return',icon:'OUT',description:()=> 'Typed result',create:id=>({id,kind:'return',label:'Return',value:'{{input.text}}'})}},
  fail:{schema:schemas.fail,ports:[],capabilities:[],terminal:true,bindings:node=>[{text:node.reason}],outputFields:noFields,
    execute:(node,context)=>{const value=context.bind(node.reason,node);throw executionError(typeof value==='string'?value:JSON.stringify(value),'LOOPS_EXPLICIT_FAILURE');},
    editor:{title:'Fail',icon:'!',description:()=> 'Explicit failure',create:id=>({id,kind:'fail',label:'Fail',reason:'This branch ended with an explicit failure.'})}},
};
export const nodeKinds=Object.keys(nodeContracts) as NodeKind[];
export function nodeContract<K extends NodeKind>(kind:K):NodeContract<K>{return nodeContracts[kind];}
export function childNodes(node:GraphNode):GraphNode[]{return node.kind==='repeat'?[...node.body]:[];}
export function requiredCapabilities(nodes:GraphNode[]):NodeCapability[]{return [...new Set(nodes.flatMap(node=>[...nodeContract(node.kind).capabilities]))];}
