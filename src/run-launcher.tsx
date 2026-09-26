import React,{useEffect,useRef,useState} from 'react';
import type {LoopRecord} from './engine.js';
import type {Definition,Json} from './graph.js';
import {LoopError} from './errors.js';

export function publishedDefinition(record:LoopRecord|null,definitionId:string|undefined):Definition|null{
  if(!record||record.definition.id!==definitionId||record.deletedAt||record.archived)return null;
  const revision=record.enabledRevision??record.publishedRevision;
  if(revision==null)return null;
  return record.revisions?.[revision]??(record.definition.revision===revision?record.definition:null);
}

export function runInput(definition:Definition,values:Record<string,Json>):Record<string,Json>{
  return Object.fromEntries(definition.inputSchema.filter(field=>field.required||Object.hasOwn(values,field.name)).map(field=>{
    const value=Object.hasOwn(values,field.name)?values[field.name]:undefined;
    if(field.type==='artifact'&&value===undefined)throw new Error(`Choose a file for ${field.label} before running.`);
    return [field.name,field.type==='json'?JSON.parse(String(value??'null')):value??(field.type==='text'?'':field.type==='number'?0:false)];
  }));
}

export type FileRelease='released'|'linked-protected';
export async function captureWithRecoveryId(operationId:string,capture:()=>Promise<Json>):Promise<Json>{
  try{return await capture();}catch(error){
    const context=`Capture operation ${operationId} did not return a verified file reference. Inspect artifact publication before retrying.`;
    if(error instanceof LoopError)throw new LoopError({...error.detail,message:`${context} ${error.detail.message}`,recovery:`${context} ${error.detail.recovery}`},{cause:error});
    throw new Error(context,{cause:error});
  }
}
function captureIdentity(reference:Json):string{
  if(!reference||typeof reference!=='object'||Array.isArray(reference))return 'unknown identity';
  const value=reference as Record<string,Json>;
  return typeof value.id==='string'&&typeof value.runId==='string'&&typeof value.ownerScope==='string'?`${value.id} (${value.runId}, owner ${value.ownerScope})`:'unknown identity';
}

// Keep the order of custody effects explicit. An acknowledged release removes
// the old selection before capture; an uncertain release never starts capture.
export async function replaceCapturedFile({previous,release,stage,isCurrent,onPreviousReleased,onCaptured}:{
  previous:Json|undefined;release:(reference:Json)=>Promise<FileRelease>;stage:()=>Promise<Json>;isCurrent:()=>boolean;
  onPreviousReleased:()=>boolean;onCaptured:(reference:Json)=>boolean;
}):Promise<void>{
  if(previous!==undefined){
    const result=await release(previous);
    if(result==='released'){
      if(!onPreviousReleased()){
        if(!isCurrent())return;
        throw new Error('The released file selection changed before it could be cleared. Inspect the current input before retrying.');
      }
    }else if(result!=='linked-protected')throw new Error('File release returned an unknown result.');
  }
  if(!isCurrent())return;
  const reference=await stage();
  if(!isCurrent()||!onCaptured(reference)){
    let result:FileRelease;
    try{result=await release(reference);}catch(error){throw new Error(`Captured file ${captureIdentity(reference)} could not be confirmed released. Inspect its custody before trying again.`,{cause:error});}
    if(result!=='released')throw new Error(`Captured file ${captureIdentity(reference)} could not be confirmed released. Inspect its custody before trying again.`);
  }
}

type Target='published'|'draft';
type InputState={key:string;values:Record<string,Json>};
type InputMap=Partial<Record<Target,InputState>>;
type ActiveOperation={id:number;scope:string;field:string};
export function RunLauncher({draft,published,enabled,dirty,invalid,busy,authorized,onRun,onStageFile,onReleaseFile,onError}:{
  draft:Definition;published:Definition|null;enabled:boolean;dirty:boolean;invalid:boolean;busy:boolean;authorized:boolean;
  onRun:(request:{target:Target;definition:Definition;input:Record<string,Json>},origin?:HTMLElement)=>Promise<void>;
  onStageFile:(file:File)=>Promise<Json>;onReleaseFile:(reference:Json)=>Promise<FileRelease>;onError:(error:unknown)=>void;
}){
  const [target,setTarget]=useState<Target>(published?'published':'draft');
  const [inputs,setInputs]=useState<InputMap>({});
  const inputsRef=useRef<InputMap>({});
  const [staging,setStaging]=useState('');
  const active=useRef<ActiveOperation|null>(null);
  const serial=useRef(0),generation=useRef(0),mounted=useRef(true),scopeRef=useRef('');
  const runPending=useRef(false);
  const [submitting,setSubmitting]=useState(false);
  const current=useRef({busy,authorized});current.current={busy,authorized};
  const definition=target==='published'?published:draft;
  const key=definition?JSON.stringify([definition.id,definition.inputSchema]):'';
  const scope=JSON.stringify([target,key]);
  if(scopeRef.current!==scope){scopeRef.current=scope;generation.current++;}
  const values=inputs[target]?.key===key?inputs[target]!.values:{};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const setValue=(forTarget:Target,forKey:string,name:string,value:Json|undefined,expected?:{value:Json|undefined}):boolean=>{
    const prior=inputsRef.current[forTarget];
    if(prior&&prior.key!==forKey&&expected)return false;
    const values={...(prior?.key===forKey?prior.values:{})};
    if(expected&&values[name]!==expected.value)return false;
    if(value===undefined)delete values[name];else values[name]=value;
    const next={...inputsRef.current,[forTarget]:{key:forKey,values}};
    inputsRef.current=next;if(mounted.current)setInputs(next);return true;
  };
  const change=(name:string,value:Json|undefined)=>{setValue(target,key,name,value);};
  const begin=(field:string):ActiveOperation|null=>{
    if(active.current||current.current.busy||!current.current.authorized||runPending.current)return null;
    const operation={id:++serial.current,scope,field};active.current=operation;setStaging(field);return operation;
  };
  const finish=(operation:ActiveOperation)=>{if(active.current?.id===operation.id){active.current=null;if(mounted.current)setStaging('');}};
  const isCurrent=(operation:ActiveOperation,epoch:number)=>mounted.current&&active.current?.id===operation.id&&scopeRef.current===operation.scope&&generation.current===epoch&&!current.current.busy&&current.current.authorized&&!runPending.current;
  const chooseFile=(name:string,file:File)=>{
    const operation=begin(name);if(!operation)return;
    const epoch=generation.current,previous=inputsRef.current[target]?.key===key?inputsRef.current[target]!.values[name]:undefined;
    let expected=previous;
    void replaceCapturedFile({previous,release:onReleaseFile,stage:()=>onStageFile(file),isCurrent:()=>isCurrent(operation,epoch),
      onPreviousReleased:()=>{const cleared=setValue(target,key,name,undefined,{value:previous});if(cleared)expected=undefined;return cleared;},
      onCaptured:reference=>setValue(target,key,name,reference,{value:expected}),
    }).catch(onError).finally(()=>finish(operation));
  };
  const releaseFile=(name:string,reference:Json)=>{
    const operation=begin(name);if(!operation)return;
    void onReleaseFile(reference).then(result=>{
      if(result!=='released'&&result!=='linked-protected')throw new Error('File release returned an unknown result.');
      setValue(target,key,name,undefined,{value:reference});
    }).catch(onError).finally(()=>finish(operation));
  };
  const start=(event:React.MouseEvent<HTMLButtonElement>)=>{
    if(!definition||active.current||runPending.current||current.current.busy||!current.current.authorized)return;
    if(target==='draft'&&invalid){onError(new Error('Resolve invalid editor text or draft validation issues before testing this draft.'));return;}
    try{const input=runInput(definition,inputsRef.current[target]?.key===key?inputsRef.current[target]!.values:{});runPending.current=true;setSubmitting(true);
      void onRun({target,definition,input},event.currentTarget).catch(onError).finally(()=>{runPending.current=false;if(mounted.current)setSubmitting(false);});}
    catch(error){runPending.current=false;setSubmitting(false);onError(error);}
  };
  return <div className="lp-run-input">
    <div className="lp-section-heading"><h2>Run this loop</h2><span>{definition?`r${definition.revision}${target==='draft'&&dirty?' · unsaved':''}`:'—'}</span></div>
    <label className="lp-field"><span>Run target</span><select value={target} disabled={Boolean(staging)||busy||submitting} onChange={event=>{generation.current++;scopeRef.current='switching';setTarget(event.target.value as Target);}}>
      <option value="published" disabled={!published}>{published?`Published r${published.revision}${enabled?'':' · disabled'}`:'No published revision'}</option>
      <option value="draft">Current draft r{draft.revision}{dirty?' · unsaved':''}</option>
    </select></label>
    {definition&&<p className="lp-hint">{definition.slug} · {target==='published'?'Uses the published definition and its inputs.':'Tests these edits without changing publication.'}</p>}
    {definition?.inputSchema.map(field=><label className="lp-field" key={field.name}><span>{field.label}{field.required?' *':''}</span>
      {field.type==='artifact'?<><input type="file" aria-label={`Choose file for ${field.label}`} disabled={Boolean(staging)||busy||submitting||!authorized} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)chooseFile(field.name,file);}}/>{values[field.name]&&<><span className="lp-hint">Captured and verified: {String((values[field.name] as Record<string,Json>).id??'artifact')}</span><button type="button" className="lp-text-button" disabled={Boolean(staging)||busy||submitting||!authorized} onClick={()=>releaseFile(field.name,values[field.name])}>Release unused file</button></>}{staging===field.name&&<span className="lp-hint" role="status">Updating file custody…</span>}</>:field.type==='text'||field.type==='json'?<textarea rows={3} value={String(values[field.name]??'')} onChange={event=>change(field.name,event.target.value)}/>:field.type==='number'?<input type="number" value={Number(values[field.name]??0)} onChange={event=>change(field.name,Number(event.target.value))}/>:<input type="checkbox" checked={Boolean(values[field.name])} onChange={event=>change(field.name,event.target.checked)}/>}
      {!field.required&&field.type!=='artifact'&&<button type="button" className="lp-text-button" onClick={()=>change(field.name,undefined)}>Omit optional value{!Object.hasOwn(values,field.name)?' (omitted)':''}</button>}
    </label>)}
    <button type="button" className="primary lp-run-button" onClick={start} disabled={!definition||!authorized||busy||submitting||Boolean(staging)||(target==='published'?!enabled:invalid)}>{busy||submitting?'Running…':target==='published'?'▶ Run loop':'Test current draft'}</button>
    {target==='published'&&!enabled&&<p className="lp-hint">Enable the published revision to start new runs, or select the current draft to test it.</p>}
    {target==='draft'&&invalid&&<p className="lp-hint">Resolve draft validation issues before testing this draft.</p>}
    <p className="lp-hint">Also available through /loops and agent tools.</p>
  </div>;
}
