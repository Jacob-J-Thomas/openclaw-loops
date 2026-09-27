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
function sameCapturedFile(left:Json,right:Json):boolean{
  if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)||Array.isArray(right))return false;
  const a=left as Record<string,Json>,b=right as Record<string,Json>;
  return typeof a.id==='string'&&a.id===b.id&&a.runId===b.runId&&a.ownerScope===b.ownerScope&&a.sha256===b.sha256;
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
type InputState={key:string;values:Record<string,Json>;types:Record<string,string>};
type InputMap=Partial<Record<Target,InputState>>;
type ActiveOperation={id:number;scope:string;field:string};
function compatibleValues(state:InputState|undefined,definition:Definition|null):Record<string,Json>{
  if(!state||!definition||state.key!==definition.id)return {};
  return Object.fromEntries(definition.inputSchema.filter(field=>state.types[field.name]===field.type&&Object.hasOwn(state.values,field.name)).map(field=>[field.name,state.values[field.name]]));
}
export type FileCustodyItem={reference:Json;status:'published'|'released';everLinked:boolean;operationId:string};
export type FileCustodyPage={items:FileCustodyItem[];nextCursor:string|null};
export function RunLauncher({draft,published,enabled,dirty,invalid,busy,authorized,onRun,onStageFile,onReleaseFile,onListFiles,onError}:{
  draft:Definition;published:Definition|null;enabled:boolean;dirty:boolean;invalid:boolean;busy:boolean;authorized:boolean;
  onRun:(request:{target:Target;definition:Definition;input:Record<string,Json>},origin?:HTMLElement)=>Promise<void>;
  onStageFile:(file:File)=>Promise<Json>;onReleaseFile:(reference:Json)=>Promise<FileRelease>;
  onListFiles:(cursor:string)=>Promise<FileCustodyPage>;onError:(error:unknown)=>void;
}){
  const [target,setTarget]=useState<Target>(published?'published':'draft');
  const [inputs,setInputs]=useState<InputMap>({});
  const inputsRef=useRef<InputMap>({});
  const [staging,setStaging]=useState('');
  const active=useRef<ActiveOperation|null>(null);
  const serial=useRef(0),generation=useRef(0),mounted=useRef(true),scopeRef=useRef('');
  const runPending=useRef(false);
  const [submitting,setSubmitting]=useState(false);
  const [custody,setCustody]=useState<FileCustodyPage|null>(null);
  const [custodyCursor,setCustodyCursor]=useState('');
  const [priorCursors,setPriorCursors]=useState<string[]>([]);
  const [inventoryBusy,setInventoryBusy]=useState(false);
  const inventoryPending=useRef(false);
  const current=useRef({busy,authorized});current.current={busy,authorized};
  const definition=target==='published'?published:draft;
  // Edits to the schema invalidate in-flight work, but not settled selections.
  // A field that disappears remains recoverable from the owner's durable inventory.
  const key=definition?.id??'';
  const scope=JSON.stringify([target,key,definition?.inputSchema]);
  if(scopeRef.current!==scope){scopeRef.current=scope;generation.current++;}
  const values=compatibleValues(inputs[target],definition);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const releaseTracked=async(reference:Json):Promise<FileRelease>=>{
    const result=await onReleaseFile(reference);
    if(result==='released'&&mounted.current)setCustody(previous=>previous?{...previous,items:previous.items.map(item=>sameCapturedFile(item.reference,reference)?{...item,status:'released'}:item)}:null);
    return result;
  };
  const setValue=(forTarget:Target,forKey:string,name:string,value:Json|undefined,expected?:{value:Json|undefined}):boolean=>{
    const prior=inputsRef.current[forTarget];
    if(prior&&prior.key!==forKey&&expected)return false;
    const values={...(prior?.key===forKey?prior.values:{})},types={...(prior?.key===forKey?prior.types:{})};
    if(expected&&values[name]!==expected.value)return false;
    if(value===undefined){delete values[name];delete types[name];}
    else{values[name]=value;const field=(forTarget==='published'?published:draft)?.inputSchema.find(item=>item.name===name);if(field)types[name]=field.type;}
    const next={...inputsRef.current,[forTarget]:{key:forKey,values,types}};
    inputsRef.current=next;if(mounted.current)setInputs(next);return true;
  };
  const change=(name:string,value:Json|undefined)=>{setValue(target,key,name,value);};
  const begin=(field:string):ActiveOperation|null=>{
    if(active.current||inventoryPending.current||current.current.busy||!current.current.authorized||runPending.current)return null;
    const operation={id:++serial.current,scope,field};active.current=operation;setStaging(field);return operation;
  };
  const finish=(operation:ActiveOperation)=>{if(active.current?.id===operation.id){active.current=null;if(mounted.current)setStaging('');}};
  const isCurrent=(operation:ActiveOperation,epoch:number)=>mounted.current&&active.current?.id===operation.id&&scopeRef.current===operation.scope&&generation.current===epoch&&!current.current.busy&&current.current.authorized&&!runPending.current;
  const chooseFile=(name:string,file:File)=>{
    const operation=begin(name);if(!operation)return;
    const epoch=generation.current,previous:Json|undefined=compatibleValues(inputsRef.current[target],definition)[name];
    // Compare the exact retained slot, even when its old type is hidden by the
    // current schema. Only a compatible artifact is eligible for prior release.
    let expected:Json|undefined=inputsRef.current[target]?.key===key?inputsRef.current[target]?.values[name]:undefined;
    void replaceCapturedFile({previous,release:releaseTracked,stage:()=>onStageFile(file),isCurrent:()=>isCurrent(operation,epoch),
      onPreviousReleased:()=>{const cleared=setValue(target,key,name,undefined,{value:previous});if(cleared)expected=undefined;return cleared;},
      onCaptured:reference=>setValue(target,key,name,reference,{value:expected}),
    }).catch(onError).finally(()=>finish(operation));
  };
  const releaseFile=(name:string,reference:Json)=>{
    const operation=begin(name);if(!operation)return;
    void releaseTracked(reference).then(result=>{
      if(result!=='released'&&result!=='linked-protected')throw new Error('File release returned an unknown result.');
      if(result==='linked-protected')throw new Error(`Captured file ${captureIdentity(reference)} is linked to a run and remains protected.`);
      setValue(target,key,name,undefined,{value:reference});
    }).catch(onError).finally(()=>finish(operation));
  };
  const clearReleasedReference=(reference:Json)=>{
    const next:InputMap={...inputsRef.current};let changed=false;
    for(const name of ['published','draft'] as const){const state=next[name];if(!state)continue;
      const values={...state.values},types={...state.types};let removed=false;
      for(const field of Object.keys(values))if(sameCapturedFile(values[field],reference)){delete values[field];delete types[field];removed=true;}
      if(removed){next[name]={...state,values,types};changed=true;}
    }
    if(changed){inputsRef.current=next;if(mounted.current)setInputs(next);}
  };
  const loadCustody=(cursor:string,history:string[])=>{if(inventoryPending.current||!authorized)return;inventoryPending.current=true;setInventoryBusy(true);
    void onListFiles(cursor).then(page=>{if(mounted.current){setCustody(page);setCustodyCursor(cursor);setPriorCursors(history);}}).catch(onError).finally(()=>{inventoryPending.current=false;if(mounted.current)setInventoryBusy(false);});};
  const releaseCustody=(item:FileCustodyItem)=>{
    if(inventoryPending.current||runPending.current||active.current||current.current.busy||!current.current.authorized||item.status!=='published'||item.everLinked)return;
    inventoryPending.current=true;setInventoryBusy(true);
    let confirmed=false;
    void releaseTracked(item.reference).then(result=>{
      if(result!=='released')throw new Error(`Captured file ${captureIdentity(item.reference)} remains protected or its release was not confirmed.`);
      confirmed=true;
      clearReleasedReference(item.reference);
      return onListFiles(custodyCursor);
    }).then(page=>{if(mounted.current)setCustody(page);}).catch(error=>{
      onError(new Error(confirmed?`Captured file ${captureIdentity(item.reference)} was released, but its inventory refresh failed. Refresh custody before continuing.`:`Captured file ${captureIdentity(item.reference)} release requires inspection.`,{cause:error}));
    }).finally(()=>{inventoryPending.current=false;if(mounted.current)setInventoryBusy(false);});
  };
  const start=(event:React.MouseEvent<HTMLButtonElement>)=>{
    if(!definition||active.current||inventoryPending.current||runPending.current||current.current.busy||!current.current.authorized)return;
    if(target==='draft'&&invalid){onError(new Error('Resolve invalid editor text or draft validation issues before testing this draft.'));return;}
    try{const input=runInput(definition,compatibleValues(inputsRef.current[target],definition));runPending.current=true;setSubmitting(true);
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
      {field.type==='artifact'?<><input type="file" aria-label={`Choose file for ${field.label}`} disabled={Boolean(staging)||inventoryBusy||busy||submitting||!authorized} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)chooseFile(field.name,file);}}/>{values[field.name]&&<><span className="lp-hint">Captured and verified: {String((values[field.name] as Record<string,Json>).id??'artifact')}</span><button type="button" className="lp-text-button" disabled={Boolean(staging)||inventoryBusy||busy||submitting||!authorized} onClick={()=>releaseFile(field.name,values[field.name])}>Release unused file</button></>}{staging===field.name&&<span className="lp-hint" role="status">Updating file custody…</span>}</>:field.type==='text'||field.type==='json'?<textarea rows={3} value={String(values[field.name]??'')} onChange={event=>change(field.name,event.target.value)}/>:field.type==='number'?<input type="number" value={Number(values[field.name]??0)} onChange={event=>change(field.name,Number(event.target.value))}/>:<input type="checkbox" checked={Boolean(values[field.name])} onChange={event=>change(field.name,event.target.checked)}/>}
      {!field.required&&field.type!=='artifact'&&<button type="button" className="lp-text-button" onClick={()=>change(field.name,undefined)}>Omit optional value{!Object.hasOwn(values,field.name)?' (omitted)':''}</button>}
    </label>)}
    <button type="button" className="primary lp-run-button" onClick={start} disabled={!definition||!authorized||busy||submitting||inventoryBusy||Boolean(staging)||(target==='published'?!enabled:invalid)}>{busy||submitting?'Running…':target==='published'?'▶ Run loop':'Test current draft'}</button>
    <section className="lp-file-custody" aria-label="Captured file custody"><h3>Captured file custody</h3>
      <p className="lp-hint">File captures stay with the agent and session that created them, even after a schema edit or loop switch. Return to that context to inspect or release an unused file.</p>
      <button type="button" onClick={()=>loadCustody(custodyCursor,priorCursors)} disabled={!authorized||inventoryBusy}>{inventoryBusy?'Checking file custody…':'Refresh captured files'}</button>
      {custody!==null&&<><ul>{custody.items.length===0?<li>No captured files on this page.</li>:custody.items.map(item=>{
        const reference=item.reference as Record<string,Json>,identity=captureIdentity(item.reference);
        return <li key={`${String(reference.id)}:${item.operationId}`}><code>{identity}</code> · {item.status}{item.everLinked?' · linked to a run':' · not linked'}
          {item.status==='published'&&!item.everLinked&&<button type="button" disabled={inventoryBusy||!authorized} onClick={()=>releaseCustody(item)}>Release this unused file</button>}
        </li>;
      })}</ul><div className="lp-history-pages"><button type="button" disabled={inventoryBusy||priorCursors.length===0} onClick={()=>loadCustody(priorCursors[priorCursors.length-1],priorCursors.slice(0,-1))}>Previous captured files</button><button type="button" disabled={inventoryBusy||custody.nextCursor===null} onClick={()=>custody.nextCursor&&loadCustody(custody.nextCursor,[...priorCursors,custodyCursor])}>Next captured files</button></div></>}
    </section>
    {target==='published'&&!enabled&&<p className="lp-hint">Enable the published revision to start new runs, or select the current draft to test it.</p>}
    {target==='draft'&&invalid&&<p className="lp-hint">Resolve draft validation issues before testing this draft.</p>}
    <p className="lp-hint">Also available through /loops and agent tools.</p>
  </div>;
}
