import {Type,type Static} from 'typebox';
import {executionError} from './errors.js';
import {isJson,literalValue,type Json,type NodeValue} from './node-values.js';

const strict={additionalProperties:false} as const;
const identifier=Type.String({pattern:'^(?!(?:constructor|prototype|default)$)[a-z][a-z0-9_-]{0,47}$'});
const json=Type.Unsafe<Json>(Type.Unknown());

export const JsonTypeSchema=Type.Union([Type.Literal('null'),Type.Literal('boolean'),Type.Literal('number'),Type.Literal('string'),Type.Literal('array'),Type.Literal('object')]);
export type JsonType=Static<typeof JsonTypeSchema>;
export const TypedOperatorSchema=Type.Union([
  Type.Literal('exists'),Type.Literal('missing'),Type.Literal('type-is'),Type.Literal('equals'),Type.Literal('not-equals'),
  Type.Literal('less-than'),Type.Literal('less-than-or-equals'),Type.Literal('greater-than'),Type.Literal('greater-than-or-equals'),
  Type.Literal('in'),Type.Literal('not-in'),
]);
export type TypedOperator=Static<typeof TypedOperatorSchema>;
export const TypedConditionSchema=Type.Object({
  value:Type.Union([Type.String(),Type.Object({literalJson:Type.String()},strict)]),operator:TypedOperatorSchema,
  expected:Type.Optional(Type.Union([Type.String(),Type.Object({literalJson:Type.String()},strict)])),jsonType:Type.Optional(JsonTypeSchema),
},strict);
export type TypedCondition=Static<typeof TypedConditionSchema>;
export const SwitchCaseSchema=Type.Object({id:identifier,label:Type.String({minLength:1,maxLength:100}),value:json},strict);
export type SwitchCase=Static<typeof SwitchCaseSchema>;
export const SwitchSchema=Type.Object({
  kind:Type.Literal('switch'),id:Type.String({pattern:'^(?!(?:constructor|prototype)$)[a-z][a-z0-9_-]{0,47}$'}),label:Type.String({minLength:1,maxLength:100}),
  value:Type.Union([Type.String(),Type.Object({literalJson:Type.String()},strict)]),cases:Type.Array(SwitchCaseSchema,{minItems:1,maxItems:32}),
  strategy:Type.Union([Type.Literal('ordered'),Type.Literal('unique')]),default:Type.Optional(Type.Literal(true)),exhaustive:Type.Optional(Type.Literal('boolean')),
},strict);
export type SwitchNode=Static<typeof SwitchSchema>;
export const TypedConditionNodeSchema=Type.Object({
  kind:Type.Literal('condition'),id:Type.String({pattern:'^(?!(?:constructor|prototype)$)[a-z][a-z0-9_-]{0,47}$'}),label:Type.String({minLength:1,maxLength:100}),
  predicate:Type.Object({left:Type.Union([Type.String(),Type.Object({literalJson:Type.String()},strict)]),op:Type.Union([Type.Literal('equals'),Type.Literal('not-equals'),Type.Literal('contains'),Type.Literal('less-than'),Type.Literal('greater-than'),Type.Literal('truthy')]),right:Type.Union([Type.String(),Type.Object({literalJson:Type.String()},strict)])},strict),
  condition:TypedConditionSchema,
},strict);
export type TypedConditionNode=Static<typeof TypedConditionNodeSchema>;
export type ValueResolution={available:boolean;value?:Json};
export type RouteEvidence={port:string;caseId?:string;observed:Json};

export function jsonType(value:Json):JsonType{
  if(value===null)return 'null';if(Array.isArray(value))return 'array';if(typeof value==='object')return 'object';
  if(typeof value==='boolean'||typeof value==='number'||typeof value==='string')return typeof value as JsonType;
  throw new Error('Invalid JSON value.');
}
export function equalJson(left:Json,right:Json):boolean{
  if(left===right)return true;
  if(typeof left!==typeof right||left===null||right===null||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
  if(Array.isArray(left)&&Array.isArray(right))return left.length===right.length&&left.every((value,index)=>equalJson(value,right[index]!));
  const entries=Object.entries(left);return entries.length===Object.keys(right).length&&entries.every(([key,value])=>Object.hasOwn(right,key)&&equalJson(value,(right as Record<string,Json>)[key]!));
}
function required(condition:TypedCondition):boolean{return !['exists','missing','type-is'].includes(condition.operator);}
export function validateTypedCondition(condition:TypedCondition):string[]{
  const issues:string[]=[];
  if(required(condition)&&condition.expected===undefined)issues.push(condition.operator+' requires an expected value.');
  if(!required(condition)&&condition.expected!==undefined)issues.push(condition.operator+' does not accept an expected value.');
  if(condition.operator==='type-is'&&condition.jsonType===undefined)issues.push('type-is requires a JSON type.');
  if(condition.operator!=='type-is'&&condition.jsonType!==undefined)issues.push('Only type-is accepts a JSON type.');
  return issues;
}
export function validateSwitch(node:SwitchNode):string[]{
  const issues:string[]=[];const ids=new Set<string>(),values:SwitchCase[]=[];
  for(const item of node.cases){
    if(ids.has(item.id))issues.push('Switch case IDs must be unique ('+item.id+').');ids.add(item.id);
    if(!isJson(item.value)){issues.push('Switch case '+item.id+' must be a JSON value.');continue;}
    const duplicate=values.find(value=>equalJson(value.value,item.value));
    if(node.strategy==='unique'&&duplicate)issues.push('Switch has duplicate reachable case values ('+item.id+' and '+duplicate.id+').');
    values.push(item);
  }
  if(!node.default&&!node.exhaustive)issues.push('Switch requires an explicit default or an exhaustive finite domain.');
  if(node.default&&node.exhaustive)issues.push('Switch cannot use both default and an exhaustive finite domain.');
  if(node.exhaustive==='boolean'){
    const booleans=new Set(node.cases.filter(item=>typeof item.value==='boolean').map(item=>item.value));
    if(node.cases.some(item=>typeof item.value!=='boolean')||!booleans.has(true)||!booleans.has(false))issues.push('An exhaustive boolean Switch requires exactly true and false cases.');
  }
  return issues;
}
export function switchPorts(node:SwitchNode):string[]{return [...node.cases.map(item=>item.id),...node.default?['default']:[]];}
function requireValue(value:ValueResolution,operator:TypedOperator):Json{
  if(value.available)return value.value!;
  throw executionError(operator+' cannot evaluate an unavailable binding.','LOOPS_BINDING_UNAVAILABLE');
}
export function evaluateTypedCondition(condition:TypedCondition,resolve:(value:NodeValue)=>ValueResolution):{passed:boolean;observed?:Json}{
  const left=resolve(condition.value);
  if(condition.operator==='exists')return {passed:left.available};
  if(condition.operator==='missing')return {passed:!left.available};
  const observed=requireValue(left,condition.operator);
  if(condition.operator==='type-is')return {passed:jsonType(observed)===condition.jsonType,observed};
  const expected=requireValue(resolve(condition.expected!),condition.operator);
  switch(condition.operator){
    case'equals':return {passed:equalJson(observed,expected),observed};
    case'not-equals':return {passed:!equalJson(observed,expected),observed};
    case'less-than':case'less-than-or-equals':case'greater-than':case'greater-than-or-equals':{
      if(typeof observed!=='number'||typeof expected!=='number')throw executionError(condition.operator+' requires numeric values.','LOOPS_BRANCH_TYPE');
      const passed=condition.operator==='less-than'?observed<expected:condition.operator==='less-than-or-equals'?observed<=expected:condition.operator==='greater-than'?observed>expected:observed>=expected;
      return {passed,observed};
    }
    case'in':case'not-in':{
      if(!Array.isArray(expected))throw executionError(condition.operator+' requires an array expected value.','LOOPS_BRANCH_TYPE');
      const found=expected.some(item=>equalJson(observed,item));return {passed:condition.operator==='in'?found:!found,observed};
    }
  }
}
export function evaluateSwitch(node:SwitchNode,resolve:(value:NodeValue)=>ValueResolution):{output:Json;route:RouteEvidence}{
  const resolved=resolve(node.value);const observed=requireValue(resolved,'equals');const matching=node.cases.filter(item=>equalJson(observed,item.value));
  if(node.strategy==='unique'&&matching.length>1)throw executionError('Switch unique cases matched more than once.','LOOPS_INVALID_GRAPH');
  const selected=matching[0];
  if(selected)return {output:{value:observed,caseId:selected.id},route:{port:selected.id,caseId:selected.id,observed}};
  if(node.default)return {output:{value:observed,caseId:'default'},route:{port:'default',caseId:'default',observed}};
  throw executionError('An exhaustive Switch did not match its finite domain.','LOOPS_INVALID_GRAPH');
}
export function literalNodeValue(value:Json):NodeValue{return {literalJson:JSON.stringify(value)};}
export function parsedNodeValue(value:NodeValue):Json{return typeof value==='string'?value:literalValue(value.literalJson);}
