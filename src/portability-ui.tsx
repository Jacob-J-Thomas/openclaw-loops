import {useState} from 'react';
import type {PortableBindingDeclaration,PortablePackage,PortablePreview} from './portability.js';

export type PortableImportRequest={package:unknown;environment:unknown;digest:string;resolvedDigest:string;libraryDigest:string;enabled:boolean};
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
  const [packageText,setPackageText]=useState(''),[environmentText,setEnvironmentText]=useState('{}');
  const [preview,setPreview]=useState<InspectedPortablePreview>(),[inspected,setInspected]=useState<{packageText:string;environmentText:string}>();
  const [availableBindings,setAvailableBindings]=useState<InspectedPortablePreview['bindings']>([]);
  const [bindingDrafts,setBindingDrafts]=useState<Record<string,string>>({}),[bindingErrors,setBindingErrors]=useState<Record<string,string>>({});
  const [enabled,setEnabled]=useState(false),[message,setMessage]=useState<string>(),[busy,setBusy]=useState(false);
  const [bindings,setBindings]=useState<PortableBindingDeclaration[]>([]),[bindingName,setBindingName]=useState(''),[bindingType,setBindingType]=useState<PortableBindingDeclaration['type']>('string'),[bindingPointer,setBindingPointer]=useState('/name');
  let environment:Record<string,unknown>={};
  try{const parsed=json(environmentText,'Environment');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))environment=parsed as Record<string,unknown>;}catch{/* Keep partial raw JSON editable. */}
  const invalidate=()=>{setPreview(undefined);setInspected(undefined);};
  const exportPackage=async()=>{setBusy(true);try{const value=await controls.exportPackage(bindings);setPackageText(JSON.stringify(value,null,2));invalidate();setAvailableBindings([]);setBindingDrafts({});setBindingErrors({});setMessage(`Exported portable package ${value.digest}.`);}catch(error){setMessage(error instanceof Error?error.message:'Export failed.');}finally{setBusy(false);}};
  const previewPackage=async()=>{setBusy(true);try{
    if(Object.keys(bindingErrors).length)throw Error('Correct the environment binding fields before previewing.');
    const next=await controls.previewImport(json(packageText,'Package'),json(environmentText,'Environment'));
    setPreview(next);setInspected({packageText,environmentText});setAvailableBindings(next.bindings);setBindingDrafts({});setMessage(`Previewed ${next.templates.length} template${next.templates.length===1?'':'s'} at ${next.digest}.`);
  }catch(error){invalidate();setMessage(error instanceof Error?error.message:'Preview failed.');}finally{setBusy(false);}};
  const applyPackage=async()=>{if(!preview||!inspected||inspected.packageText!==packageText||inspected.environmentText!==environmentText||Object.keys(bindingErrors).length){setMessage('Preview this exact package and environment before importing.');return;}setBusy(true);try{
    const result=await controls.importPackage({package:json(packageText,'Package'),environment:json(environmentText,'Environment'),digest:preview.digest,resolvedDigest:preview.resolvedDigest,libraryDigest:preview.libraryDigest,enabled});
    setMessage(`Imported ${result.imported.length} template${result.imported.length===1?'':'s'} as ${enabled?'enabled revisions':'drafts'}.`);invalidate();
  }catch(error){setMessage(error instanceof Error?error.message:'Import failed.');}finally{setBusy(false);}};
  const setBindingValue=(name:string,type:PortableBindingDeclaration['type'],raw:string|boolean)=>{
    invalidate();if(type!=='boolean')setBindingDrafts(current=>({...current,[name]:String(raw)}));
    try{
      const previous=json(environmentText,'Environment');
      if(!previous||typeof previous!=='object'||Array.isArray(previous))throw Error('Environment must be a JSON object.');
      let value:unknown=raw;
      if(type==='number'){
        if(typeof raw!=='string'||raw.trim()==='')throw Error(`Environment ${name} requires a number; blank is not zero.`);
        value=Number(raw);if(!Number.isFinite(value))throw Error(`Environment ${name} must be a finite number.`);
      }else if(type==='json')value=json(String(raw),`Environment ${name}`);
      setEnvironmentText(JSON.stringify({...previous,[name]:value},null,2));
      setBindingErrors(current=>{const next={...current};delete next[name];return next;});setMessage(undefined);
    }catch(error){const reason=error instanceof Error?error.message:'Invalid environment value.';setBindingErrors(current=>({...current,[name]:reason}));setMessage(reason);}
  };
  const displayValue=(name:string,type:PortableBindingDeclaration['type'])=>{
    if(Object.hasOwn(bindingDrafts,name))return bindingDrafts[name]!;
    const value=environment[name];if(value===undefined)return '';
    if(type==='json')return JSON.stringify(value,null,2)??'';
    return String(value);
  };
  return <section className="lp-portability" aria-label="Portable loop templates">
    <h3>Portable templates</h3>
    <p className="lp-hint">Preview validates pins, explicit environment bindings, resulting definitions and graph diagnostics. Import creates local revisions through your current authority.</p>
    <fieldset className="lp-portability-bindings"><legend>Export bindings</legend><label className="lp-field"><span>Binding name</span><input aria-label="Binding name" value={bindingName} onChange={event=>setBindingName(event.target.value)}/></label><label className="lp-field"><span>Type</span><select aria-label="Binding type" value={bindingType} onChange={event=>setBindingType(event.target.value as PortableBindingDeclaration['type'])}><option value="string">String</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="json">JSON</option></select></label><label className="lp-field"><span>Exact JSON Pointer</span><input aria-label="Binding JSON Pointer" value={bindingPointer} onChange={event=>setBindingPointer(event.target.value)}/></label><button type="button" onClick={()=>{if(!bindingName){setMessage('Binding name is required.');return;}setBindings(current=>[...current,{name:bindingName,type:bindingType,pointer:bindingPointer}]);setBindingName('');}}>Add binding</button><ul>{bindings.map(binding=><li key={binding.pointer}>{binding.name} · {binding.type} · {binding.pointer} <button type="button" onClick={()=>setBindings(current=>current.filter(item=>item.pointer!==binding.pointer))}>Remove {binding.name}</button></li>)}</ul></fieldset>
    <button type="button" onClick={exportPackage} disabled={busy}>Export package</button>
    <label className="lp-field"><span>Package JSON</span><textarea aria-label="Portable package JSON" value={packageText} onChange={event=>{setPackageText(event.target.value);invalidate();setAvailableBindings([]);setBindingDrafts({});setBindingErrors({});}} rows={8}/></label>
    <label className="lp-field"><span>Environment bindings JSON</span><textarea aria-label="Portable environment bindings JSON" value={environmentText} onChange={event=>{setEnvironmentText(event.target.value);invalidate();setBindingDrafts({});setBindingErrors({});}} rows={4}/></label>
    <label className="lp-field"><input type="checkbox" checked={enabled} onChange={event=>setEnabled(event.target.checked)}/> <span>Enable imported revisions after validation</span></label>
    <div className="lp-portability-actions"><button type="button" onClick={previewPackage} disabled={busy||!packageText||Object.keys(bindingErrors).length>0}>Preview import</button><button type="button" onClick={applyPackage} disabled={busy||!preview||Object.keys(bindingErrors).length>0}>Import inspected package</button></div>
    {preview&&<div className="lp-portability-preview" role="status"><strong>Preview package {preview.digest}</strong><p>Resolved environment and targets {preview.resolvedDigest}</p><ul>{preview.templates.map(template=>{const definition=template.definition as Record<string,unknown>;return <li key={template.templateId}><details><summary>{template.templateId} → {String(definition.slug??'unknown slug')} · {String(definition.name??'unnamed')} · {template.contentDigest}</summary><p>Local target ID: {String(definition.id??'unknown')}</p><pre>{JSON.stringify(template.definition,null,2)}</pre><p>Dependency pins: {template.dependencies.length?template.dependencies.map(item=>`${item.templateId} ${item.digest}`).join(', '):'none'}</p><p>{template.validation?template.validation.valid?'Graph valid for activation.':`Draft graph has ${template.validation.issues.length} validation issue(s).`:'Graph validation unavailable.'}</p>{template.validation?.issues.map((issue,index)=><p key={index} role="alert">{issue.nodeId?`${issue.nodeId}: `:''}{issue.message}</p>)}</details></li>;})}</ul><p>Binding resolution:</p><ul>{preview.bindings.map(binding=><li key={binding.name}>{binding.name} · {binding.type} → {binding.locations.map(location=>`${location.templateId}${location.pointer}`).join(', ')}</li>)}</ul></div>}
    {availableBindings.length>0&&<fieldset className="lp-portability-bindings"><legend>Environment values</legend>{availableBindings.map(binding=>binding.type==='boolean'?<label className="lp-field" key={binding.name}><input aria-label={`Environment ${binding.name}`} type="checkbox" checked={environment[binding.name]===true} onChange={event=>setBindingValue(binding.name,binding.type,event.target.checked)}/><span>{binding.name} · Boolean</span></label>:<label className="lp-field" key={binding.name}><span>{binding.name} · {binding.type}</span><textarea aria-label={`Environment ${binding.name}`} aria-invalid={Boolean(bindingErrors[binding.name])} value={displayValue(binding.name,binding.type)} onChange={event=>setBindingValue(binding.name,binding.type,event.target.value)} rows={binding.type==='json'?3:1}/>{bindingErrors[binding.name]&&<span role="alert">{bindingErrors[binding.name]}</span>}</label>)}</fieldset>}
    {message&&<p role="status" className="lp-hint">{message}</p>}
  </section>;
}
