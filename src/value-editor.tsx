import React,{useId} from 'react';
import {literalValue,valueSource,type NodeValue} from './node-values.js';

export function ValueEditor({label,value,onChange,literals,rows=1}:{label:string;value:NodeValue;onChange:(value:NodeValue)=>void;literals:boolean;rows?:number}){
  const descriptionId=useId(),literal=typeof value!=='string';let error:string|undefined;
  if(literal)try{literalValue(value.literalJson);}catch(cause){error=cause instanceof Error?cause.message:'Invalid JSON value.';}
  const change=(source:string)=>onChange(literal?{literalJson:source}:source);
  return <div className="lp-value-editor">
    <label className="lp-field"><span>{label} source</span><select value={literal?'json':'template'} onChange={event=>{
      if(event.target.value==='json')onChange({literalJson:JSON.stringify(valueSource(value))});
      else{let source=valueSource(value);if(literal)try{const parsed=literalValue(source);source=typeof parsed==='string'?parsed:JSON.stringify(parsed);}catch{/* Keep unfinished source available when switching modes. */}onChange(source);}
    }}><option value="template">Text or binding</option><option value="json" disabled={!literals}>JSON value</option></select></label>
    <label className="lp-field"><span>{literal?`${label} JSON`:label}</span>{literal||rows>1?<textarea rows={literal?Math.max(rows,3):rows} value={valueSource(value)} aria-invalid={Boolean(error)} aria-describedby={literal?descriptionId:undefined} onChange={event=>change(event.target.value)}/>:<input value={valueSource(value)} onChange={event=>change(event.target.value)}/>}</label>
    {literal&&<div id={descriptionId}><p className="lp-hint">Use a JSON value such as 0, false, null, [1,2], or {`{"count":0}`}. Quote literal text. Bindings inside JSON are kept as text.</p>
      {error&&<p className="danger" role="status">{error}</p>}</div>}
  </div>;
}
