import React from 'react';
import {ValueEditor} from './value-editor.js';
import type {ContextNodeConfig,ContextPatch,ContextProjection} from './context.js';
export type {ContextNodeConfig,ContextPatch,ContextProjection} from './context.js';
export type ContextConfigurable={context?:ContextNodeConfig};

const contextDefault=():ContextNodeConfig=>({version:1,projection:{mode:'omit'},patch:{mode:'omit'}});
export {contextDefault};

/** A small authoring check; graph validation remains the authority at save/run time. */
export function contextPathIssue(path:string,{mutable=false}:{mutable?:boolean}={}):string|undefined{
  if(path.length>1024)return 'A context path can be at most 1024 characters.';
  if(!path.startsWith('/'))return 'Use an RFC 6901 JSON Pointer beginning with /. ';
  if(/~(?:[^01]|$)/.test(path))return 'Use ~0 for ~ and ~1 for / in a JSON Pointer.';
  const parts=path.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));
  if(parts.some(part=>['__proto__','prototype','constructor'].includes(part)))return 'This context path contains a protected object key.';
  if(mutable&&parts[0]==='input')return 'Context input is immutable. Choose another context target.';
  return undefined;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="lp-field"><span>{label}</span>{children}</label>;}
function pathErrors(paths:string[],mutable=false){
  const errors=paths.length===0?['Choose at least one context path.']:[];
  if(paths.length>128)errors.push('Choose no more than 128 context paths.');
  errors.push(...paths.map(path=>contextPathIssue(path,{mutable})).filter((value):value is string=>Boolean(value)));
  if(new Set(paths).size!==paths.length)errors.push('Choose each projected path only once.');
  return errors;
}

export function ContextEditor<T extends ContextConfigurable>({node,onChange,heading='Shared context'}:{node:T;onChange:(node:T)=>void;heading?:string}){
  const config=node.context;
  const update=(next:ContextNodeConfig|undefined)=>{
    if(next===undefined){const {context:_context,...withoutContext}=node;onChange(withoutContext as T);return;}
    onChange({...node,context:next} as T);
  };
  const projection=config?.projection??{mode:'omit'} as ContextProjection;
  const patch=config?.patch??{mode:'omit'} as ContextPatch;
  const projectionErrors=projection.mode==='consume'?pathErrors(projection.paths):[];
  const targetError=patch.mode==='omit'?undefined:contextPathIssue(patch.target,{mutable:true});
  const outputPathError=patch.mode!=='omit'&&patch.source.kind==='output'&&patch.source.path?contextPathIssue(patch.source.path):undefined;
  const hasErrors=projectionErrors.length>0||targetError!==undefined||outputPathError!==undefined;
  const errors=[...projectionErrors,...(targetError?[targetError]:[]),...(outputPathError?[outputPathError]:[])];
  const setProjection=(next:ContextProjection)=>update({...config??contextDefault(),projection:next});
  const setPatch=(next:ContextPatch)=>update({...config??contextDefault(),patch:next});
  return <section className="lp-context-editor" aria-label={heading}>
    <div className="lp-context-heading"><h4>{heading}</h4>{config&&<button className="lp-text-button danger" type="button" onClick={()=>update(undefined)}>Remove context configuration</button>}</div>
    {!config&&<><p className="lp-hint">Context is off for this node. Configure it to project selected state or commit an output patch.</p><button type="button" onClick={()=>update(contextDefault())}>Configure context</button></>}
    {config&&<>
      <Field label="Context projection"><select value={projection.mode} onChange={event=>setProjection(event.target.value==='consume'?{mode:'consume',paths:['/input']}:{mode:'omit'})}>
        <option value="omit">Do not expose context to this node</option><option value="consume">Expose selected context paths</option>
      </select></Field>
      {projection.mode==='consume'&&<div className="lp-context-paths"><p className="lp-hint">This node can bind only selected paths as <code>{'{{context.name}}'}</code>. Use <code>{'{{context["a/b"]}}'}</code> for keys with punctuation, spaces, or dots. RFC 6901 uses <code>~0</code> for <code>~</code> and <code>~1</code> for <code>/</code>.</p>
        {projection.paths.map((path,index)=><div className="lp-context-path" key={index}><Field label={`Projected path ${index+1}`}><input value={path} aria-invalid={Boolean(contextPathIssue(path))} onChange={event=>setProjection({mode:'consume',paths:projection.paths.map((value,position)=>position===index?event.target.value:value)})}/></Field><button type="button" className="lp-text-button danger" aria-label={`Remove projected path ${index+1}`} onClick={()=>setProjection({mode:'consume',paths:projection.paths.filter((_,position)=>position!==index)})}>Remove</button></div>)}
        <button type="button" onClick={()=>setProjection({mode:'consume',paths:[...projection.paths,'/input']})}>Add projected path</button>
      </div>}
      <Field label="Output patch"><select value={patch.mode} onChange={event=>{
        const mode=event.target.value as ContextPatch['mode'];
        if(mode==='omit'){setPatch({mode:'omit'});return;}
        setPatch(patch.mode==='omit'?{mode,target:'/result',source:{kind:'output'}}:{...patch,mode});
      }}><option value="omit">Do not change context</option><option value="append">Append to an existing array</option><option value="replace">Replace or create a value</option><option value="merge">Merge JSON objects</option></select></Field>
      {patch.mode!=='omit'&&<div className="lp-context-patch"><Field label="Context target JSON Pointer"><input value={patch.target} aria-invalid={Boolean(targetError)} onChange={event=>setPatch({...patch,target:event.target.value})}/></Field>
        <Field label="Patch source"><select value={patch.source.kind} onChange={event=>setPatch({...patch,source:event.target.value==='literal'?{kind:'literal',value:{literalJson:'null'}}:{kind:'output'}})}><option value="output">This node’s output</option><option value="literal">Typed JSON literal</option></select></Field>
        {patch.source.kind==='output'?<Field label="Output JSON Pointer (optional)"><input value={patch.source.path??''} aria-invalid={Boolean(outputPathError)} placeholder="Whole output" onChange={event=>setPatch({...patch,source:{kind:'output',...event.target.value?{path:event.target.value}:{}}})}/></Field>:<ValueEditor label="Literal patch value" value={patch.source.value} literals onChange={value=>setPatch({...patch,source:{kind:'literal',value}})}/>}</div>}
      {hasErrors&&<div className="danger" role="status">{errors.map((error,index)=><p key={index}>{error}</p>)}</div>}
    </>}
  </section>;
}
