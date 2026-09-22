import {useState} from 'react';
import type {PortableBindingDeclaration,PortablePackage,PortablePreview} from './portability.js';

export type PortableImportRequest={package:unknown;environment:unknown;digest:string;libraryDigest:string;enabled:boolean};
export type PortableImportResult={imported:Array<{id:string;slug:string;revision:number;enabled:boolean}>};
export type InspectedPortablePreview=PortablePreview&{libraryDigest:string};
export type PortablePackageControls={
  exportPackage:(bindings:PortableBindingDeclaration[])=>Promise<PortablePackage>;
  previewImport:(packageValue:unknown,environment:unknown)=>Promise<InspectedPortablePreview>;
  importPackage:(request:PortableImportRequest)=>Promise<PortableImportResult>;
};

function json(text:string,label:string):unknown{
  try{return JSON.parse(text) as unknown;}catch{throw Error(`${label} must be valid JSON.`);}
}

/**
 * A deliberately thin graphical control. The host-facing editor supplies the
 * three typed operations; this component never hashes, mutates storage, or
 * treats a displayed preview as an import authorization.
 */
export function PortablePackageControls({controls}:{controls:PortablePackageControls}){
  const [packageText,setPackageText]=useState(''),[environmentText,setEnvironmentText]=useState('{}'),[preview,setPreview]=useState<InspectedPortablePreview>(),[inspected,setInspected]=useState<{packageText:string;environmentText:string}>(),[enabled,setEnabled]=useState(false),[message,setMessage]=useState<string>(),[busy,setBusy]=useState(false),[bindings,setBindings]=useState<PortableBindingDeclaration[]>([]),[bindingName,setBindingName]=useState(''),[bindingType,setBindingType]=useState<PortableBindingDeclaration['type']>('string'),[bindingPointer,setBindingPointer]=useState('/name');
  const exportPackage=async()=>{setBusy(true);try{const value=await controls.exportPackage(bindings);const text=JSON.stringify(value,null,2);setPackageText(text);setPreview(undefined);setInspected(undefined);setMessage(`Exported portable package ${value.digest}.`);}catch(error){setMessage(error instanceof Error?error.message:'Export failed.');}finally{setBusy(false);}};
  const previewPackage=async()=>{setBusy(true);try{const next=await controls.previewImport(json(packageText,'Package'),json(environmentText,'Environment'));setPreview(next);setInspected({packageText,environmentText});setMessage(`Previewed ${next.templates.length} template${next.templates.length===1?'':'s'} at ${next.digest}.`);}catch(error){setPreview(undefined);setInspected(undefined);setMessage(error instanceof Error?error.message:'Preview failed.');}finally{setBusy(false);}};
  const applyPackage=async()=>{if(!preview||!inspected||inspected.packageText!==packageText||inspected.environmentText!==environmentText){setMessage('Preview this exact package and environment before importing.');return;}setBusy(true);try{const result=await controls.importPackage({package:json(packageText,'Package'),environment:json(environmentText,'Environment'),digest:preview.digest,libraryDigest:preview.libraryDigest,enabled});setMessage(`Imported ${result.imported.length} template${result.imported.length===1?'':'s'} as ${enabled?'enabled revisions':'drafts'}.`);setPreview(undefined);setInspected(undefined);}catch(error){setMessage(error instanceof Error?error.message:'Import failed.');}finally{setBusy(false);}};
  const setBindingValue=(name:string,type:PortableBindingDeclaration['type'],raw:string|boolean)=>{let value:unknown=raw;try{if(type==='number')value=Number(raw);else if(type==='boolean')value=raw;else if(type==='json')value=json(String(raw),`Environment ${name}`);}catch(error){setMessage(error instanceof Error?error.message:'Invalid environment value.');return;}const previous=json(environmentText,'Environment') as Record<string,unknown>;setEnvironmentText(JSON.stringify({...previous,[name]:value},null,2));};
  return <section className="lp-portability" aria-label="Portable loop templates">
    <h3>Portable templates</h3>
    <p className="lp-hint">Preview validates pins and explicit environment bindings. Import creates local revisions through your current authority.</p>
    <fieldset className="lp-portability-bindings"><legend>Export bindings</legend><label className="lp-field"><span>Binding name</span><input aria-label="Binding name" value={bindingName} onChange={event=>setBindingName(event.target.value)}/></label><label className="lp-field"><span>Type</span><select aria-label="Binding type" value={bindingType} onChange={event=>setBindingType(event.target.value as PortableBindingDeclaration['type'])}><option value="string">String</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="json">JSON</option></select></label><label className="lp-field"><span>Exact JSON Pointer</span><input aria-label="Binding JSON Pointer" value={bindingPointer} onChange={event=>setBindingPointer(event.target.value)}/></label><button type="button" onClick={()=>{if(!bindingName){setMessage('Binding name is required.');return;}setBindings(current=>[...current,{name:bindingName,type:bindingType,pointer:bindingPointer}]);setBindingName('');}}>Add binding</button><ul>{bindings.map(binding=><li key={binding.pointer}>{binding.name} · {binding.type} · {binding.pointer} <button type="button" onClick={()=>setBindings(current=>current.filter(item=>item.pointer!==binding.pointer))}>Remove {binding.name}</button></li>)}</ul></fieldset>
    <button type="button" onClick={exportPackage} disabled={busy}>Export package</button>
    <label className="lp-field"><span>Package JSON</span><textarea aria-label="Portable package JSON" value={packageText} onChange={event=>{setPackageText(event.target.value);setPreview(undefined);setInspected(undefined);}} rows={8}/></label>
    <label className="lp-field"><span>Environment bindings JSON</span><textarea aria-label="Portable environment bindings JSON" value={environmentText} onChange={event=>{setEnvironmentText(event.target.value);setPreview(undefined);setInspected(undefined);}} rows={4}/></label>
    <label className="lp-field"><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/> <span>Enable imported revisions after validation</span></label>
    <div className="lp-portability-actions"><button type="button" onClick={previewPackage} disabled={busy||!packageText}>Preview import</button><button type="button" onClick={applyPackage} disabled={busy||!preview||!inspected}>Import inspected package</button></div>
    {preview&&<div className="lp-portability-preview" role="status"><strong>Preview {preview.digest}</strong><ul>{preview.templates.map(template=><li key={template.templateId}>{template.templateId} · {template.contentDigest}</li>)}</ul></div>}
    {preview&&<fieldset className="lp-portability-bindings"><legend>Environment values</legend>{preview.bindings.map(binding=>binding.type==='boolean'?<label className="lp-field" key={binding.name}><input aria-label={`Environment ${binding.name}`} type="checkbox" checked={Boolean((json(environmentText,'Environment') as Record<string,unknown>)[binding.name])} onChange={event=>setBindingValue(binding.name,binding.type,event.target.checked)}/><span>{binding.name} · Boolean</span></label>:<label className="lp-field" key={binding.name}><span>{binding.name} · {binding.type}</span><textarea aria-label={`Environment ${binding.name}`} value={String((json(environmentText,'Environment') as Record<string,unknown>)[binding.name]??'')} onChange={event=>setBindingValue(binding.name,binding.type,event.target.value)} rows={binding.type==='json'?3:1}/></label>)}</fieldset>}
    {message&&<p role="status" className="lp-hint">{message}</p>}
  </section>;
}
