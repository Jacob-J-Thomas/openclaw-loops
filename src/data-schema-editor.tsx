import React from 'react';
import {dataSchemaIssues,type DataSchema} from './data-schema.js';
import {isJson} from './node-values.js';
import {childNodes} from './node-contracts.js';
import type {Definition} from './graph.js';

export type DataSchemaDrafts=Map<string,string>;
export const inputSchemaScope=(definitionId:string,fieldName:string)=>[definitionId,'input',fieldName];
export const outputSchemaScope=(definitionId:string,nodeId:string)=>[definitionId,'output',nodeId];
const draftKey=(scope:string[])=>JSON.stringify(scope);
export function moveDataSchemaDrafts(drafts:DataSchemaDrafts,from:string[],to:string[]){
  for(const [key,source] of [...drafts]){
    const scope=JSON.parse(key) as string[];
    if(from.every((part,index)=>scope[index]===part)){
      drafts.delete(key);drafts.set(draftKey([...to,...scope.slice(from.length)]),source);
    }
  }
}
export function hasActiveDataSchemaDrafts(definition:Definition|null,drafts:DataSchemaDrafts):boolean{
  if(!definition||drafts.size===0)return false;
  const active=(schema:DataSchema|undefined,scope:string[],depth=0):boolean=>{
    if(!schema||depth>32)return false;
    if(drafts.has(draftKey(scope)))return true;
    if(schema.type==='array')return active(schema.items,[...scope,'items'],depth+1);
    if(schema.type==='object')return Object.entries(schema.properties??{}).some(([key,child])=>active(child,[...scope,'properties',key],depth+1));
    return false;
  };
  return definition.inputSchema.some(field=>active(field.schema as DataSchema|undefined,inputSchemaScope(definition.id,field.name)))||
    definition.nodes.flatMap(node=>[node,...childNodes(node)]).some(node=>active(node.outputSchema,outputSchemaScope(definition.id,node.id)));
}

const types:DataSchema['type'][]=['object','array','string','number','integer','boolean','null','json'];
const fresh=(type:DataSchema['type']='object'):DataSchema=>type==='object'?{type,properties:{},required:[],additionalProperties:false}:type==='array'?{type,items:{type:'json'}}:{type};
const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="lp-field"><span>{label}</span>{children}</label>;
function SchemaCard({label,value,onChange,onRemove,scope,drafts,onDraftValidityChange,depth=0}:{label:string;value:DataSchema;onChange:(value:DataSchema)=>void;onRemove?:()=>void;scope:string[];drafts:DataSchemaDrafts;onDraftValidityChange:()=>void;depth?:number}){
  const update=(patch:Partial<DataSchema>)=>onChange({...value,...patch});
  const changeType=(type:DataSchema['type'])=>onChange({...fresh(type),title:value.title,description:value.description});
  const properties=value.properties??{},required=new Set(value.required??[]);
  const key=draftKey(scope),invalidSource=drafts.get(key),enumSource=invalidSource??(value.enum===undefined?'':JSON.stringify(value.enum));
  const parseEnum=(source:string):{value?:DataSchema['enum'];error?:string}=>{
    if(source.trim()==='')return {};
    let parsed:unknown;try{parsed=JSON.parse(source);}catch{return {error:'Enter a JSON array of allowed values.'};}
    if(!Array.isArray(parsed)||!parsed.every(item=>isJson(item)))return {error:'Enum must contain JSON values in an array.'};
    const diagnostic=dataSchemaIssues({...value,enum:parsed}).find(item=>item.instancePath==='/enum');
    return diagnostic?{error:diagnostic.message}:{value:parsed};
  };
  const enumIssue=invalidSource===undefined?undefined:parseEnum(invalidSource).error;
  const setEnum=(source:string)=>{const parsed=parseEnum(source);if(parsed.error){drafts.set(key,source);onDraftValidityChange();return;}drafts.delete(key);onDraftValidityChange();update({enum:parsed.value});};
  return <fieldset className="lp-data-schema" data-schema-depth={depth}><legend>{label}</legend>
    <div className="lp-data-schema-actions"><Field label="Value type"><select aria-label={`${label} value type`} value={value.type} onChange={event=>changeType(event.target.value as DataSchema['type'])}>{types.map(type=><option key={type} value={type}>{type==='json'?'Any JSON value':type}</option>)}</select></Field>{onRemove&&<button type="button" className="lp-text-button" onClick={onRemove}>Remove schema</button>}</div>
    {(value.type==='string'||value.type==='number'||value.type==='integer'||value.type==='array')&&<div className="lp-data-schema-constraints">
      {(value.type==='number'||value.type==='integer')&&<><Field label="Minimum"><input type="number" value={value.minimum??''} onChange={event=>update(event.target.value===''?{minimum:undefined}:{minimum:Number(event.target.value)})}/></Field><Field label="Maximum"><input type="number" value={value.maximum??''} onChange={event=>update(event.target.value===''?{maximum:undefined}:{maximum:Number(event.target.value)})}/></Field></>}
      {value.type==='string'&&<><Field label="Minimum length"><input type="number" min={0} value={value.minLength??''} onChange={event=>update(event.target.value===''?{minLength:undefined}:{minLength:Number(event.target.value)})}/></Field><Field label="Maximum length"><input type="number" min={0} value={value.maxLength??''} onChange={event=>update(event.target.value===''?{maxLength:undefined}:{maxLength:Number(event.target.value)})}/></Field><Field label="Simple pattern"><input value={value.pattern??''} onChange={event=>update(event.target.value===''?{pattern:undefined}:{pattern:event.target.value})}/></Field></>}
      {value.type==='array'&&<><Field label="Minimum items"><input type="number" min={0} value={value.minItems??''} onChange={event=>update(event.target.value===''?{minItems:undefined}:{minItems:Number(event.target.value)})}/></Field><Field label="Maximum items"><input type="number" min={0} value={value.maxItems??''} onChange={event=>update(event.target.value===''?{maxItems:undefined}:{maxItems:Number(event.target.value)})}/></Field></>}
    </div>}
    <Field label="Enum JSON values"><textarea rows={2} value={enumSource} placeholder='[0, null, "example"]' onChange={event=>setEnum(event.target.value)}/>{enumIssue&&<><span className="lp-node-error" role="alert">{enumIssue}</span><button type="button" className="lp-text-button" onClick={()=>{drafts.delete(key);onDraftValidityChange();}}>Discard invalid enum text</button></>}</Field>
    {value.type==='object'&&<><label className="lp-check"><input type="checkbox" checked={value.additionalProperties===true} onChange={event=>update({additionalProperties:event.target.checked})}/>Allow unknown properties</label>
      {Object.entries(properties).map(([key,child],index)=><div className="lp-data-schema-property" key={key}><Field label={`Property ${index+1} name`}><input value={key} onChange={event=>{const next=event.target.value;if(!next||next!==key&&Object.hasOwn(properties,next))return;moveDataSchemaDrafts(drafts,[...scope,'properties',key],[...scope,'properties',next]);const renamed=Object.fromEntries(Object.entries(properties).map(([name,schema])=>[name===key?next:name,schema]));update({properties:renamed,required:(value.required??[]).map(item=>item===key?next:item)});}}/></Field><label className="lp-check"><input type="checkbox" checked={required.has(key)} onChange={event=>update({required:event.target.checked?[...(value.required??[]),key]:value.required?.filter(item=>item!==key)})}/>Required</label><SchemaCard label={`Property ${key}`} value={child} onChange={next=>update({properties:{...properties,[key]:next}})} onRemove={()=>{const copy={...properties};delete copy[key];update({properties:copy,required:value.required?.filter(item=>item!==key)});}} scope={[...scope,'properties',key]} drafts={drafts} onDraftValidityChange={onDraftValidityChange} depth={depth+1}/></div>)}
      <button type="button" aria-keyshortcuts="Enter Space" onClick={()=>{let number=Object.keys(properties).length+1,key=`property_${number}`;while(Object.hasOwn(properties,key))key=`property_${++number}`;update({properties:{...properties,[key]:fresh()}});}}>Add property</button>
    </>}
    {value.type==='array'&&<SchemaCard label="Array item schema" value={value.items??fresh('json')} onChange={items=>update({items})} scope={[...scope,'items']} drafts={drafts} onDraftValidityChange={onDraftValidityChange} depth={depth+1}/>}
  </fieldset>;
}
export function DataSchemaEditor({label,value,onChange,scope,drafts,onDraftValidityChange}:{label:string;value?:DataSchema;onChange:(value:DataSchema|undefined)=>void;scope:string[];drafts:DataSchemaDrafts;onDraftValidityChange:()=>void}){
  return <section className="lp-data-schema-editor" aria-label={label}>{value===undefined?<button type="button" aria-keyshortcuts="Enter Space" onClick={()=>onChange(fresh())}>Add nested schema</button>:<SchemaCard label={label} value={value} onChange={onChange} onRemove={()=>onChange(undefined)} scope={scope} drafts={drafts} onDraftValidityChange={onDraftValidityChange}/>}</section>;
}
