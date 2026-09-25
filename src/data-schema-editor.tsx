import React from 'react';
import type {DataSchema} from './data-schema.js';

const types:DataSchema['type'][]=['object','array','string','number','integer','boolean','null','json'];
const fresh=(type:DataSchema['type']='object'):DataSchema=>type==='object'?{type,properties:{},required:[],additionalProperties:false}:type==='array'?{type,items:{type:'json'}}:{type};
const Field=({label,children}:{label:string;children:React.ReactNode})=><label className="lp-field"><span>{label}</span>{children}</label>;
function SchemaCard({label,value,onChange,onRemove,depth=0}:{label:string;value:DataSchema;onChange:(value:DataSchema)=>void;onRemove?:()=>void;depth?:number}){
  const update=(patch:Partial<DataSchema>)=>onChange({...value,...patch});
  const changeType=(type:DataSchema['type'])=>onChange({...fresh(type),title:value.title,description:value.description});
  const properties=value.properties??{},required=new Set(value.required??[]);
  const [enumSource,setEnumSource]=React.useState(value.enum===undefined?'':JSON.stringify(value.enum));
  const [enumIssue,setEnumIssue]=React.useState('');
  const setEnum=(source:string)=>{setEnumSource(source);if(source.trim()===''){setEnumIssue('');update({enum:undefined});return;}try{const parsed=JSON.parse(source);if(!Array.isArray(parsed))throw Error('Enum must be a JSON array.');setEnumIssue('');update({enum:parsed as DataSchema['enum']});}catch{setEnumIssue('Enter a JSON array of allowed values.');}};
  return <fieldset className="lp-data-schema" data-schema-depth={depth}><legend>{label}</legend>
    <div className="lp-data-schema-actions"><Field label="Value type"><select aria-label={`${label} value type`} value={value.type} onChange={event=>changeType(event.target.value as DataSchema['type'])}>{types.map(type=><option key={type} value={type}>{type==='json'?'Any JSON value':type}</option>)}</select></Field>{onRemove&&<button type="button" className="lp-text-button" onClick={onRemove}>Remove schema</button>}</div>
    {(value.type==='string'||value.type==='number'||value.type==='integer'||value.type==='array')&&<div className="lp-data-schema-constraints">
      {(value.type==='number'||value.type==='integer')&&<><Field label="Minimum"><input type="number" value={value.minimum??''} onChange={event=>update(event.target.value===''?{minimum:undefined}:{minimum:Number(event.target.value)})}/></Field><Field label="Maximum"><input type="number" value={value.maximum??''} onChange={event=>update(event.target.value===''?{maximum:undefined}:{maximum:Number(event.target.value)})}/></Field></>}
      {value.type==='string'&&<><Field label="Minimum length"><input type="number" min={0} value={value.minLength??''} onChange={event=>update(event.target.value===''?{minLength:undefined}:{minLength:Number(event.target.value)})}/></Field><Field label="Maximum length"><input type="number" min={0} value={value.maxLength??''} onChange={event=>update(event.target.value===''?{maxLength:undefined}:{maxLength:Number(event.target.value)})}/></Field><Field label="Simple pattern"><input value={value.pattern??''} onChange={event=>update(event.target.value===''?{pattern:undefined}:{pattern:event.target.value})}/></Field></>}
      {value.type==='array'&&<><Field label="Minimum items"><input type="number" min={0} value={value.minItems??''} onChange={event=>update(event.target.value===''?{minItems:undefined}:{minItems:Number(event.target.value)})}/></Field><Field label="Maximum items"><input type="number" min={0} value={value.maxItems??''} onChange={event=>update(event.target.value===''?{maxItems:undefined}:{maxItems:Number(event.target.value)})}/></Field></>}
    </div>}
    <Field label="Enum JSON values"><textarea rows={2} value={enumSource} placeholder='[0, null, "example"]' onChange={event=>setEnum(event.target.value)}/>{enumIssue&&<span className="lp-node-error" role="alert">{enumIssue}</span>}</Field>
    {value.type==='object'&&<><label className="lp-check"><input type="checkbox" checked={value.additionalProperties===true} onChange={event=>update({additionalProperties:event.target.checked})}/>Allow unknown properties</label>
      {Object.entries(properties).map(([key,child],index)=><div className="lp-data-schema-property" key={key}><Field label={`Property ${index+1} name`}><input value={key} onChange={event=>{const next=event.target.value;if(!next||next!==key&&Object.hasOwn(properties,next))return;const renamed=Object.fromEntries(Object.entries(properties).map(([name,schema])=>[name===key?next:name,schema]));update({properties:renamed,required:(value.required??[]).map(item=>item===key?next:item)});}}/></Field><label className="lp-check"><input type="checkbox" checked={required.has(key)} onChange={event=>update({required:event.target.checked?[...(value.required??[]),key]:value.required?.filter(item=>item!==key)})}/>Required</label><SchemaCard label={`Property ${key}`} value={child} onChange={next=>update({properties:{...properties,[key]:next}})} onRemove={()=>{const copy={...properties};delete copy[key];update({properties:copy,required:value.required?.filter(item=>item!==key)});}} depth={depth+1}/></div>)}
      <button type="button" aria-keyshortcuts="Enter Space" onClick={()=>{let number=Object.keys(properties).length+1,key=`property_${number}`;while(Object.hasOwn(properties,key))key=`property_${++number}`;update({properties:{...properties,[key]:fresh()}});}}>Add property</button>
    </>}
    {value.type==='array'&&<SchemaCard label="Array item schema" value={value.items??fresh('json')} onChange={items=>update({items})} depth={depth+1}/>}
  </fieldset>;
}
export function DataSchemaEditor({label,value,onChange}:{label:string;value?:DataSchema;onChange:(value:DataSchema|undefined)=>void}){
  return <section className="lp-data-schema-editor" aria-label={label}>{value===undefined?<button type="button" aria-keyshortcuts="Enter Space" onClick={()=>onChange(fresh())}>Add nested schema</button>:<SchemaCard label={label} value={value} onChange={onChange} onRemove={()=>onChange(undefined)}/>}</section>;
}
