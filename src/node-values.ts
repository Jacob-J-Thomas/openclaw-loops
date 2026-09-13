import {Type,type Static} from 'typebox';
import {executionError} from './errors.js';

export type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
// Store the JSON source explicitly so an unfinished editor draft is recoverable.
// It is parsed and validated before publication and again before consumption.
export const NodeValueSchema=Type.Union([Type.String(),Type.Object({literalJson:Type.String()}, {additionalProperties:false})],{
  description:'A text template with {{bindings}}, or an explicit version-2 JSON value such as {literalJson:"0"}, {literalJson:"false"}, or {literalJson:"{\\"count\\":0}"}. Literal JSON strings do not expand bindings. Invalid JSON can be drafted but cannot be executed.',
});
export type NodeValue=Static<typeof NodeValueSchema>;
export function isJson(value:unknown,depth=0):value is Json{
  if(depth>100)return false;
  if(value===null||typeof value==='boolean'||typeof value==='string')return true;
  if(typeof value==='number')return Number.isFinite(value);
  if(Array.isArray(value))return value.every(item=>isJson(item,depth+1));
  if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return Object.entries(value).every(([key,item])=>!['__proto__','constructor','prototype'].includes(key)&&isJson(item,depth+1));
  return false;
}
export function literalValue(source:string):Json{
  let value:unknown;
  try{value=JSON.parse(source);}catch{throw executionError('Literal JSON must contain one complete JSON value.','LOOPS_LITERAL_INVALID');}
  if(!isJson(value))throw executionError('Literal JSON must use finite numbers, safe object keys and at most 100 nesting levels.','LOOPS_LITERAL_INVALID');
  return value;
}
export function valueSource(value:NodeValue):string{return typeof value==='string'?value:value.literalJson;}
