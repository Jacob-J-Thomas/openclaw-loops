import {Type,type Static,type TSchema} from 'typebox';
import {AdvancedSchema,ReasoningSchema} from './inference-settings.js';
import {executionError} from './errors.js';
import {NodeValueSchema,type NodeValue,type Json} from './node-values.js';
import {ContextNodeConfigSchema,type ContextNodeConfig} from './context.js';
import {type EvaluationResult,type Evaluator} from './evaluation.js';
import type {DataSchema} from './data-schema.js';
import {SwitchSchema,TypedConditionNodeSchema,evaluateSwitch,evaluateTypedCondition,type SwitchNode,type TypedConditionNode} from './branching.js';
export type {Json,NodeValue} from './node-values.js';

export const identifierSchema=Type.String({pattern:'^(?!(?:constructor|prototype)$)[a-z][a-z0-9_-]{0,47}$'});
const text=Type.String(),strict={additionalProperties:false} as const;
const identity={id:identifierSchema,label:Type.String({minLength:1,maxLength:100})};
const outputExtension={outputSchema:Type.Optional(Type.Unsafe<DataSchema>(Type.Unknown()))};
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
type BaseGraphNode=Static<typeof NodeSchema>&{context?:ContextNodeConfig;outputSchema?:DataSchema;structuredGeneration?:'native'};
type EvaluateNode={id:string;kind:'evaluate';label:string;value:NodeValue;evaluator:Evaluator;context?:ContextNodeConfig;outputSchema?:DataSchema};
type GateNode={id:string;kind:'gate';label:string;evaluationId:string;context?:ContextNodeConfig;outputSchema?:DataSchema};
export type GraphNode=BaseGraphNode|EvaluateNode|GateNode|(TypedConditionNode&{context?:ContextNodeConfig;outputSchema?:DataSchema})|(SwitchNode&{context?:ContextNodeConfig;outputSchema?:DataSchema});
const contextExtension=Type.Object({context:Type.Optional(ContextNodeConfigSchema)},strict);
const withContext=(schema:{properties:Record<string,TSchema>})=>Type.Object({...schema.properties,...outputExtension,...contextExtension.properties},strict);
const evaluatorSchema=Type.Union([
  Type.Object({kind:Type.Literal('json-schema-2020'),version:Type.String({minLength:1,maxLength:256}),schema:Type.Unknown()},strict),
  Type.Object({kind:Type.Literal('predicate'),version:Type.String({minLength:1,maxLength:256}),predicate:Type.Object({op:Type.Union([Type.Literal('equals'),Type.Literal('not-equals'),Type.Literal('contains'),Type.Literal('less-than'),Type.Literal('greater-than'),Type.Literal('truthy')]),expected:Type.Optional(Type.Unknown())},strict)},strict),
]);
const evaluateSchema=Type.Object({...identity,...outputExtension,kind:Type.Literal('evaluate'),value:NodeValueSchema,evaluator:evaluatorSchema,...contextExtension.properties},strict);
const gateSchema=Type.Object({...identity,...outputExtension,kind:Type.Literal('gate'),evaluationId:identifierSchema,...contextExtension.properties},strict);
const contextSchemas={
  input:Type.Object({...schemas.input.properties,...contextExtension.properties},strict),inference:Type.Object({...schemas.inference.properties,...outputExtension,...contextExtension.properties,structuredGeneration:Type.Optional(Type.Literal('native'))},strict),action:withContext(schemas.action),condition:withContext(schemas.condition),
  wait:withContext(schemas.wait),review:withContext(schemas.review),return:withContext(schemas.return),fail:withContext(schemas.fail),
};
const contextTypedConditionSchema=withContext(TypedConditionNodeSchema);
const contextSwitchSchema=withContext(SwitchSchema);
const contextRepeatSchema=Type.Object({...identity,...outputExtension,kind:Type.Literal('repeat'),maxIterations:Type.Integer({minimum:1}),body:Type.Tuple([contextSchemas.inference,contextSchemas.condition]),...contextExtension.properties},strict);
export const ContextNodeSchema=Type.Unsafe<GraphNode>(Type.Union([contextSchemas.input,contextSchemas.inference,contextSchemas.action,contextSchemas.condition,contextTypedConditionSchema,contextRepeatSchema,contextSchemas.wait,contextSchemas.review,contextSchemas.return,contextSchemas.fail,contextSwitchSchema,evaluateSchema,gateSchema]));
export type Predicate=Static<typeof PredicateSchema>;
export type NodeKind=GraphNode['kind'];
export type NodeOf<K extends NodeKind>=Extract<GraphNode,{kind:K}>;
export type NodeCapability='llm'|'model-info';
export type BindingUse={text:NodeValue;prior?:string[]};
export type NodeOutcome={output:Json;port?:string;route?:{port:string;caseId?:string;observed:Json};park?:{state:'waiting'|'review';value:Json};returned?:boolean};
export type NodeExecutionContext={
  signal:AbortSignal;
  input:Record<string,Json>;
  bind:(template:NodeValue,node?:GraphNode)=>Json;
  resolve:(template:NodeValue,node?:GraphNode)=>{available:boolean;value?:Json};
  compare:(predicate:Predicate,node?:GraphNode,iteration?:number)=>boolean;
  infer:(node:NodeOf<'inference'>,iteration?:number)=>Promise<Json>;
  evaluate:(value:Json,evaluator:Evaluator,nodeId:string)=>Promise<EvaluationResult>;
  modelInfo:()=>Promise<Json>;
  readOutput:(nodeId:string)=>Json|undefined;
  requireCapability:(capability:NodeCapability)=>void;
  checkAuthority:()=>void;
  begin:(node:GraphNode,iteration:number)=>number;
  finish:(checkpoint:number,output:Json)=>void;
  setOutput:(nodeId:string,output:Json)=>void;
  validateOutput:(node:GraphNode,output:Json)=>Json;
  commitContext:(node:GraphNode,output:Json)=>void;
};
type NodeContract<K extends NodeKind=NodeKind>={
  schema:TSchema;
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
  condition:{schema:schemas.condition,ports:['true','false'],capabilities:[],terminal:false,bindings:node=>('condition'in node?[{text:node.condition.value},...node.condition.expected?[{text:node.condition.expected}]:[]]:predicateBindings(node.predicate)),outputFields:()=>['value'],
    execute:(node,context)=>{if('condition'in node){const evaluated=evaluateTypedCondition(node.condition,value=>context.resolve(value,node));return {output:{value:evaluated.passed},port:evaluated.passed?'true':'false',route:{port:evaluated.passed?'true':'false',observed:evaluated.observed??evaluated.passed}};}const passed=context.compare(node.predicate,node);return {output:{value:passed},port:passed?'true':'false'};},
    editor:{title:'Condition',icon:'IF',description:node=>'condition'in node?node.condition.operator:node.predicate.op,create:id=>({id,kind:'condition',label:'Condition',predicate:{left:'{{input.text}}',op:'equals',right:'yes'}})}},
  switch:{schema:SwitchSchema,ports:[],capabilities:[],terminal:false,bindings:node=>[{text:node.value}],outputFields:()=>['value','caseId'],
    execute:(node,context)=>{const evaluated=evaluateSwitch(node,value=>context.resolve(value,node));return {output:evaluated.output,port:evaluated.route.port,route:evaluated.route};},
    editor:{title:'Switch',icon:'⇄',description:node=>node.strategy+' cases',create:id=>({id,kind:'switch',label:'Switch',value:'{{input.text}}',cases:[{id:'match',label:'Match',value:'yes'}],strategy:'unique',default:true})}},
  evaluate:{schema:evaluateSchema,ports:['next'],capabilities:[],terminal:false,bindings:node=>[{text:node.value}],outputFields:()=>['passed','errors','evidenceDigest','evaluatorDigest','inputDigest','evaluatorVersion','evaluatorNodeId'],
    execute:async(node,context)=>({output:await context.evaluate(context.bind(node.value,node),node.evaluator,node.id)}),
    editor:{title:'Evaluate',icon:'✓?',description:()=> 'Deterministic schema or predicate evidence',create:id=>({id,kind:'evaluate',label:'Evaluate',value:'{{input.text}}',evaluator:{kind:'json-schema-2020',version:'2020-12',schema:{type:'string'}}})}},
  gate:{schema:gateSchema,ports:['true','false'],capabilities:[],terminal:false,bindings:noBindings,outputFields:()=>['passed','evidenceDigest','evaluatorNodeId'],
    execute:(node,context)=>{const evidence=context.readOutput(node.evaluationId);if(!evidence||typeof evidence!=='object'||Array.isArray(evidence)||evidence.kind!=='loops-evaluation'||evidence.evaluatorNodeId!==node.evaluationId||typeof evidence.passed!=='boolean'||typeof evidence.evidenceDigest!=='string')throw executionError('Evidence gate requires committed evaluation evidence from this run.','LOOPS_EVIDENCE_UNAVAILABLE');return {output:{passed:evidence.passed,evidenceDigest:evidence.evidenceDigest,evaluatorNodeId:evidence.evaluatorNodeId},port:evidence.passed?'true':'false'};},
    editor:{title:'Evidence gate',icon:'⇄',description:()=> 'Route committed evaluation evidence',create:id=>({id,kind:'gate',label:'Evidence gate',evaluationId:'evaluate'})}},
  repeat:{schema:schemas.repeat,ports:['next'],capabilities:['llm'],terminal:false,
    bindings:node=>[{text:node.body[0].prompt},...predicateBindings(node.body[1].predicate).map(binding=>({...binding,prior:[node.body[0].id]}))],
    outputFields:node=>[...inferenceFields(node.body[0]),'succeeded','iterations','exhausted'],
    execute:async(node,context)=>{
      let succeeded=false,last:Json={};let iteration:number;
      for(iteration=1;iteration<=node.maxIterations;iteration++){
        context.signal.throwIfAborted();context.checkAuthority();
        const [inference,condition]=node.body;
        const inferenceCheckpoint=context.begin(inference,iteration);
        last=context.validateOutput(inference,await context.infer(inference,iteration));context.signal.throwIfAborted();
        context.finish(inferenceCheckpoint,last);context.setOutput(inference.id,last);context.commitContext(inference,last);
        const conditionCheckpoint=context.begin(condition,iteration);
        succeeded=context.compare(condition.predicate,condition,iteration);const conditionOutput=context.validateOutput(condition,{value:succeeded});context.finish(conditionCheckpoint,conditionOutput);context.setOutput(condition.id,conditionOutput);context.commitContext(condition,conditionOutput);
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
