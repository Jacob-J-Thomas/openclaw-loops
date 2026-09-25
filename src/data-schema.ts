import {Ajv2020,type ErrorObject} from 'ajv/dist/2020.js';
import {Type} from 'typebox';
import {isJson,type Json} from './node-values.js';

export type DataSchema={
  type:'object'|'array'|'string'|'number'|'integer'|'boolean'|'null'|'json';
  title?:string;
  description?:string;
  enum?:Json[];
  minimum?:number;
  maximum?:number;
  minLength?:number;
  maxLength?:number;
  pattern?:string;
  properties?:Record<string,DataSchema>;
  required?:string[];
  additionalProperties?:boolean;
  items?:DataSchema;
  minItems?:number;
  maxItems?:number;
};
export type DataSchemaDiagnostic={instancePath:string;keyword:string;message:string};
export const dataSchemaLimits={maxBytes:131072,maxDepth:32,maxNodes:512,maxProperties:128,maxEnumItems:128,maxPatternBytes:256} as const;
const forbidden=new Set(['__proto__','prototype','constructor']);
const wireStrict={additionalProperties:false} as const;
const wirePropertyName=Type.String({minLength:1,maxLength:100,pattern:'^(?!(?:__proto__|prototype|constructor)$).+$'});
const wireTitle=Type.String({maxLength:1024});
const wireInteger=Type.Integer({minimum:0});

// Wire operations install these definitions once at their own root. Keeping
// refs root-local avoids duplicate nested Type.Module $id resources when a
// definition union contains both input and output schema locations.
const wireJsonValueRef=Type.Ref('#/$defs/loops_json_value');
const wireDataSchemaRef=Type.Ref('#/$defs/loops_data_schema');
export const DataSchemaWireDefinitions={
  loops_json_value:Type.Union([
    Type.Null(),Type.Boolean(),Type.Number(),Type.String(),
    Type.Array(wireJsonValueRef),
    Type.Record(Type.String(),wireJsonValueRef),
  ]),
  loops_data_schema:Type.Union([
    Type.Object({type:Type.Literal('object'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems})),properties:Type.Optional(Type.Record(wirePropertyName,wireDataSchemaRef,{maxProperties:dataSchemaLimits.maxProperties})),required:Type.Optional(Type.Array(wirePropertyName,{maxItems:dataSchemaLimits.maxProperties,uniqueItems:true})),additionalProperties:Type.Optional(Type.Boolean())},wireStrict),
    Type.Object({type:Type.Literal('array'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems})),items:wireDataSchemaRef,minItems:Type.Optional(wireInteger),maxItems:Type.Optional(wireInteger)},wireStrict),
    Type.Object({type:Type.Literal('string'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems})),minLength:Type.Optional(wireInteger),maxLength:Type.Optional(wireInteger),pattern:Type.Optional(Type.String({maxLength:dataSchemaLimits.maxPatternBytes}))},wireStrict),
    Type.Object({type:Type.Literal('number'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems})),minimum:Type.Optional(Type.Number()),maximum:Type.Optional(Type.Number())},wireStrict),
    Type.Object({type:Type.Literal('integer'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems})),minimum:Type.Optional(Type.Number()),maximum:Type.Optional(Type.Number())},wireStrict),
    Type.Object({type:Type.Literal('boolean'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems}))},wireStrict),
    Type.Object({type:Type.Literal('null'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems}))},wireStrict),
    Type.Object({type:Type.Literal('json'),title:Type.Optional(wireTitle),description:Type.Optional(wireTitle),enum:Type.Optional(Type.Array(wireJsonValueRef,{minItems:1,maxItems:dataSchemaLimits.maxEnumItems}))},wireStrict),
  ]),
} as const;
export const DataSchemaWireRef=wireDataSchemaRef;

const pointer=(parts:string[])=>parts.length?'/'+parts.map(part=>part.replaceAll('~','~0').replaceAll('/','~1')).join('/'):'';
const bytes=(value:unknown)=>{try{return Buffer.byteLength(JSON.stringify(value));}catch{return Number.POSITIVE_INFINITY;}};
const issue=(instancePath:string,keyword:string,message:string):DataSchemaDiagnostic=>({instancePath,keyword,message});
function safePattern(value:string){
  // One bounded quantifier in an anchored expression avoids combinatorial
  // backtracking while retaining common character-class constraints.
  if(Buffer.byteLength(value)>dataSchemaLimits.maxPatternBytes||!value.startsWith('^')||!value.endsWith('$')||/[()|]/.test(value))return false;
  const quantifiers=value.match(/[+*?]|\{[^}]*\}/g)??[];
  if(quantifiers.length>1)return false;
  if(quantifiers[0]?.startsWith('{')){
    const bounds=/^\{(\d+)(?:,(\d+))?\}$/.exec(quantifiers[0]);
    if(!bounds||Number(bounds[1])>1024||bounds[2]!==undefined&&Number(bounds[2])>1024)return false;
  }
  try{new RegExp(value);return true;}catch{return false;}
}
export function dataSchemaIssues(value:unknown):DataSchemaDiagnostic[]{
  const issues:DataSchemaDiagnostic[]=[],seen=new Set<object>();let nodes=0;
  if(bytes(value)>dataSchemaLimits.maxBytes)return [issue('','maxBytes',`Schema exceeds ${dataSchemaLimits.maxBytes} bytes.`)];
  const visit=(current:unknown,path:string[],depth:number)=>{
    if(++nodes>dataSchemaLimits.maxNodes){issues.push(issue(pointer(path),'maxNodes',`Schema exceeds ${dataSchemaLimits.maxNodes} nodes.`));return;}
    if(depth>dataSchemaLimits.maxDepth){issues.push(issue(pointer(path),'maxDepth',`Schema exceeds ${dataSchemaLimits.maxDepth} levels.`));return;}
    if(!current||typeof current!=='object'||Array.isArray(current)||Object.getPrototypeOf(current)!==Object.prototype){issues.push(issue(pointer(path),'type','Schema must be a plain object.'));return;}
    if(seen.has(current)){issues.push(issue(pointer(path),'cycle','Schema cannot contain a cycle.'));return;}seen.add(current);
    const schema=current as Record<string,unknown>,type=schema.type;
    const allowed=new Set(['type','title','description','enum','minimum','maximum','minLength','maxLength','pattern','properties','required','additionalProperties','items','minItems','maxItems']);
    for(const key of Object.keys(schema))if(!allowed.has(key)||forbidden.has(key))issues.push(issue(pointer([...path,key]),'additionalProperties','Unknown schema property.'));
    if(typeof type!=='string'||!['object','array','string','number','integer','boolean','null','json'].includes(type))issues.push(issue(pointer([...path,'type']),'type','Select a supported value type.'));
    for(const key of ['title','description'])if(schema[key]!==undefined&&(typeof schema[key]!=='string'||Buffer.byteLength(schema[key])>1024))issues.push(issue(pointer([...path,key]),'type',`${key} must be text up to 1,024 bytes.`));
    if(schema.enum!==undefined){
      if(!Array.isArray(schema.enum)||schema.enum.length===0||schema.enum.length>dataSchemaLimits.maxEnumItems||schema.enum.some(item=>!isJson(item)))issues.push(issue(pointer([...path,'enum']),'enum',`Enum must contain 1 to ${dataSchemaLimits.maxEnumItems} JSON values.`));
    }
    for(const key of ['minimum','maximum'])if(schema[key]!==undefined&&(typeof schema[key]!=='number'||!Number.isFinite(schema[key])))issues.push(issue(pointer([...path,key]),'type',`${key} must be a finite number.`));
    for(const key of ['minLength','maxLength','minItems','maxItems'])if(schema[key]!==undefined&&(!Number.isSafeInteger(schema[key])||Number(schema[key])<0))issues.push(issue(pointer([...path,key]),'type',`${key} must be a non-negative safe integer.`));
    if(typeof schema.minimum==='number'&&typeof schema.maximum==='number'&&schema.minimum>schema.maximum)issues.push(issue(pointer(path),'range','minimum cannot exceed maximum.'));
    if(typeof schema.minLength==='number'&&typeof schema.maxLength==='number'&&schema.minLength>schema.maxLength)issues.push(issue(pointer(path),'range','minLength cannot exceed maxLength.'));
    if(typeof schema.minItems==='number'&&typeof schema.maxItems==='number'&&schema.minItems>schema.maxItems)issues.push(issue(pointer(path),'range','minItems cannot exceed maxItems.'));
    if(schema.pattern!==undefined&&(typeof schema.pattern!=='string'||!safePattern(schema.pattern)))issues.push(issue(pointer([...path,'pattern']),'pattern',`Pattern must be a simple regular expression up to ${dataSchemaLimits.maxPatternBytes} bytes without groups or alternation.`));
    if(type==='object'){
      if(schema.properties!==undefined){
        if(!schema.properties||typeof schema.properties!=='object'||Array.isArray(schema.properties)||Object.getPrototypeOf(schema.properties)!==Object.prototype||Object.keys(schema.properties).length>dataSchemaLimits.maxProperties)issues.push(issue(pointer([...path,'properties']),'properties',`properties must contain at most ${dataSchemaLimits.maxProperties} named schemas.`));
        else for(const [key,child] of Object.entries(schema.properties)){if(!key||Buffer.byteLength(key)>100||forbidden.has(key))issues.push(issue(pointer([...path,'properties',key]),'propertyName','Property name is not allowed.'));else visit(child,[...path,'properties',key],depth+1);}
      }
      if(schema.required!==undefined){
        if(!Array.isArray(schema.required)||schema.required.length>dataSchemaLimits.maxProperties||new Set(schema.required).size!==schema.required.length||schema.required.some(key=>typeof key!=='string'||!schema.properties||!Object.hasOwn(schema.properties as object,key)))issues.push(issue(pointer([...path,'required']),'required','required must contain unique names of declared properties.'));
      }
      if(schema.additionalProperties!==undefined&&typeof schema.additionalProperties!=='boolean')issues.push(issue(pointer([...path,'additionalProperties']),'type','additionalProperties must be true or false.'));
    }else if(type==='array'){
      if(schema.items===undefined)issues.push(issue(pointer([...path,'items']),'required','Arrays need an item schema.'));else visit(schema.items,[...path,'items'],depth+1);
    }else for(const key of ['properties','required','additionalProperties','items','minItems','maxItems'])if(schema[key]!==undefined)issues.push(issue(pointer([...path,key]),'inapplicable',`${key} only applies to ${key==='items'||key.includes('Items')?'arrays':'objects'}.`));
    if(!['number','integer'].includes(String(type)))for(const key of ['minimum','maximum'])if(schema[key]!==undefined)issues.push(issue(pointer([...path,key]),'inapplicable',`${key} only applies to number or integer values.`));
    if(type!=='string')for(const key of ['minLength','maxLength','pattern'])if(schema[key]!==undefined)issues.push(issue(pointer([...path,key]),'inapplicable',`${key} only applies to text values.`));
    if(type!=='array')for(const key of ['minItems','maxItems'])if(schema[key]!==undefined)issues.push(issue(pointer([...path,key]),'inapplicable',`${key} only applies to arrays.`));
    seen.delete(current);
  };
  visit(value,[],0);return issues;
}
function toJsonSchema(schema:DataSchema):Record<string,unknown>|boolean{
  const base:Record<string,unknown>={...schema.type==='json'?{}:{type:schema.type},...schema.enum===undefined?{}:{enum:schema.enum}};
  for(const key of ['minimum','maximum','minLength','maxLength','pattern','minItems','maxItems'] as const)if(schema[key]!==undefined)base[key]=schema[key];
  if(schema.type==='object'){
    base.properties=Object.fromEntries(Object.entries(schema.properties??{}).map(([key,value])=>[key,toJsonSchema(value)]));
    base.required=schema.required??[];
    base.additionalProperties=schema.additionalProperties??false;
  }else if(schema.type==='array')base.items=toJsonSchema(schema.items!);
  return base;
}
export function validateDataSchema(value:unknown):DataSchema{
  const issues=dataSchemaIssues(value);if(issues.length)throw new DataSchemaFailure(issues);
  return structuredClone(value) as DataSchema;
}
export class DataSchemaFailure extends Error{
  readonly diagnostics:DataSchemaDiagnostic[];
  constructor(diagnostics:DataSchemaDiagnostic[]){super(diagnostics.map(d=>`${d.instancePath||'/'}: ${d.message}`).join(' '));this.name='DataSchemaFailure';this.diagnostics=diagnostics;}
}
export function validateDataValue(schema:unknown,value:unknown):DataSchemaDiagnostic[]{
  let checked:DataSchema;try{checked=validateDataSchema(schema);}catch(error){return error instanceof DataSchemaFailure?error.diagnostics:[issue('','schema','Schema is invalid.')];}
  const validate=new Ajv2020({allErrors:true,strict:true,validateSchema:true}).compile(toJsonSchema(checked));
  if(validate(value))return [];
  return (validate.errors??[]).map((error:ErrorObject)=>issue(error.instancePath,error.keyword,error.message??'Value does not satisfy schema.'));
}
