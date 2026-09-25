import React,{useRef} from 'react';
import {dataSchemaIssues,type DataSchema} from './data-schema.js';
import {isJson} from './node-values.js';
import {childNodes} from './node-contracts.js';
import type {Definition} from './graph.js';

export type SchemaRename={from:string[];to:string[]};
export type SchemaEdit={rename?:SchemaRename;removeInputIndex?:number};
export type SchemaDraftLocationSnapshot={paths:Map<string,string>;inputIds:string[]};
export const inputSchemaScope=(definitionId:string,fieldId:string)=>[definitionId,'input',fieldId];
export const outputSchemaScope=(definitionId:string,nodeId:string)=>[definitionId,'output',nodeId];
const draftKey=(scope:string[])=>JSON.stringify(scope);

const activeScopeKeys=(definition:Definition,drafts:DataSchemaDrafts):Set<string>=>{
  const keys=new Set<string>();
  const visit=(schema:DataSchema|undefined,scope:string[],depth=0):void=>{
    if(!schema||depth>32)return;
    keys.add(draftKey(scope));
    if(schema.type==='array')visit(schema.items,[...scope,'items'],depth+1);
    if(schema.type==='object')for(const [name,child] of Object.entries(schema.properties??{}))visit(child,[...scope,'properties',name],depth+1);
  };
  definition.inputSchema.forEach((field,index)=>visit(field.schema as DataSchema|undefined,inputSchemaScope(definition.id,drafts.inputFieldId(index))));
  for(const node of definition.nodes.flatMap(node=>[node,...childNodes(node)]))visit(node.outputSchema,outputSchemaScope(definition.id,node.id));
  return keys;
};

/** Raw invalid text has its own identity; history snapshots only move path bindings. */
export class DataSchemaDrafts{
  private nextId=0;
  private sources=new Map<string,string>();
  private paths=new Map<string,string>();
  private inputIds:string[]=[];
  get size(){return this.sources.size;}
  inputFieldId(index:number){while(this.inputIds.length<=index)this.inputIds.push(`input-field-${++this.nextId}`);return this.inputIds[index]!;}
  ensureInputs(count:number){if(this.inputIds.length>count)this.inputIds.length=count;else if(count>0)this.inputFieldId(count-1);}
  removeInput(index:number){this.inputIds.splice(index,1);}
  private identity(key:string){let id=this.paths.get(key);if(!id){id=`schema-draft-${++this.nextId}`;this.paths.set(key,id);}return id;}
  ensure(scope:string[]){this.identity(draftKey(scope));}
  get(key:string){const id=this.paths.get(key);return id===undefined?undefined:this.sources.get(id);}
  has(key:string){return this.get(key)!==undefined;}
  set(key:string,source:string){this.sources.set(this.identity(key),source);return this;}
  delete(key:string){const id=this.paths.get(key);return id===undefined?false:this.sources.delete(id);}
  clear(){this.sources.clear();this.paths.clear();this.inputIds=[];this.nextId=0;}
  snapshot(definition?:Definition):SchemaDraftLocationSnapshot{if(definition)this.reconcile(definition);return {paths:new Map(this.paths),inputIds:[...this.inputIds]};}
  restore(snapshot:SchemaDraftLocationSnapshot){this.paths=new Map(snapshot.paths);this.inputIds=[...snapshot.inputIds];}
  reconcile(definition:Definition){this.ensureInputs(definition.inputSchema.length);const active=activeScopeKeys(definition,this);for(const key of this.paths.keys())if(!active.has(key))this.paths.delete(key);for(const key of active)this.identity(key);}
  move(from:string[],to:string[]){
    const moves:[string,string,string][]=[];
    for(const [key,id] of this.paths){
      const scope=JSON.parse(key) as string[];
      if(from.every((part,index)=>scope[index]===part))moves.push([key,draftKey([...to,...scope.slice(from.length)]),id]);
    }
    for(const [oldKey,newKey] of moves){if(oldKey!==newKey&&this.paths.has(newKey)&&!moves.some(([key])=>key===newKey))throw new Error('Schema name already has an editor draft identity.');}
    for(const [oldKey] of moves)this.paths.delete(oldKey);
    for(const [,newKey,id] of moves)this.paths.set(newKey,id);
  }
}
export function moveDataSchemaDrafts(drafts:DataSchemaDrafts,from:string[],to:string[]){drafts.move(from,to);}
export function hasActiveDataSchemaDrafts(definition:Definition|null,drafts:DataSchemaDrafts):boolean{
  if(!definition||drafts.size===0)return false;
  for(const key of activeScopeKeys(definition,drafts))if(drafts.has(key))return true;
  return false;
}

const types:DataSchema['type'][]=['object','array','string','number','integer','boolean','null','json'];
const fresh=(type:DataSchema['type']='object'):DataSchema=>type==='object'?{type,properties:{},required:[],additionalProperties:false}:type==='array'?{type,items:{type:'json'}}:{type};
const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="lp-field"><span>{label}</span>{children}</label>;
function SchemaCard({label,value,onChange,onRemove,scope,drafts,onDraftValidityChange,depth=0}:{label:string;value:DataSchema;onChange:(value:DataSchema,rename?:SchemaRename)=>void;onRemove?:()=>void;scope:string[];drafts:DataSchemaDrafts;onDraftValidityChange:()=>void;depth?:number}){
  const update=(patch:Partial<DataSchema>,rename?:SchemaRename)=>onChange({...value,...patch},rename);
  const changeType=(type:DataSchema['type'])=>onChange({...fresh(type),title:value.title,description:value.description});
  const properties=value.properties??{},required=new Set(value.required??[]);
  // Object keys may reorder when a name becomes an integer index. Preserve the
  // row's React identity across the rename so keyboard focus stays with it.
  const rowIds=useRef(new Map<string,number>()),nextRowId=useRef(0);
  for(const name of Object.keys(properties))if(!rowIds.current.has(name))rowIds.current.set(name,++nextRowId.current);
  for(const name of rowIds.current.keys())if(!Object.hasOwn(properties,name))rowIds.current.delete(name);
  drafts.ensure(scope);const key=draftKey(scope),invalidSource=drafts.get(key),enumSource=invalidSource??(value.enum===undefined?'':JSON.stringify(value.enum));
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
      {Object.entries(properties).map(([key,child],index)=><div className="lp-data-schema-property" key={rowIds.current.get(key)}><Field label={`Property ${index+1} name`}><input value={key} onChange={event=>{const next=event.target.value;if(!next||next!==key&&Object.hasOwn(properties,next))return;const rowId=rowIds.current.get(key);if(rowId!==undefined){rowIds.current.delete(key);rowIds.current.set(next,rowId);}const renamed=Object.fromEntries(Object.entries(properties).map(([name,schema])=>[name===key?next:name,schema]));update({properties:renamed,required:(value.required??[]).map(item=>item===key?next:item)},{from:[...scope,'properties',key],to:[...scope,'properties',next]});}}/></Field><label className="lp-check"><input type="checkbox" checked={required.has(key)} onChange={event=>update({required:event.target.checked?[...(value.required??[]),key]:value.required?.filter(item=>item!==key)})}/>Required</label><SchemaCard label={`Property ${key}`} value={child} onChange={(next,rename)=>update({properties:{...properties,[key]:next}},rename)} onRemove={()=>{rowIds.current.delete(key);const copy={...properties};delete copy[key];update({properties:copy,required:value.required?.filter(item=>item!==key)});}} scope={[...scope,'properties',key]} drafts={drafts} onDraftValidityChange={onDraftValidityChange} depth={depth+1}/></div>)}
      <button type="button" aria-keyshortcuts="Enter Space" onClick={()=>{let number=Object.keys(properties).length+1,key=`property_${number}`;while(Object.hasOwn(properties,key))key=`property_${++number}`;update({properties:{...properties,[key]:fresh()}});}}>Add property</button>
    </>}
    {value.type==='array'&&<SchemaCard label="Array item schema" value={value.items??fresh('json')} onChange={(items,rename)=>update({items},rename)} scope={[...scope,'items']} drafts={drafts} onDraftValidityChange={onDraftValidityChange} depth={depth+1}/>}
  </fieldset>;
}
export function DataSchemaEditor({label,value,onChange,scope,drafts,onDraftValidityChange}:{label:string;value?:DataSchema;onChange:(value:DataSchema|undefined,rename?:SchemaRename)=>void;scope:string[];drafts:DataSchemaDrafts;onDraftValidityChange:()=>void}){
  return <section className="lp-data-schema-editor" aria-label={label}>{value===undefined?<button type="button" aria-keyshortcuts="Enter Space" onClick={()=>onChange(fresh())}>Add nested schema</button>:<SchemaCard label={label} value={value} onChange={onChange} onRemove={()=>onChange(undefined)} scope={scope} drafts={drafts} onDraftValidityChange={onDraftValidityChange}/>}</section>;
}
