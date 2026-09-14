import React,{useState} from 'react';
import type {LoopRecord} from './engine.js';
import type {Definition,Json} from './graph.js';

export function publishedDefinition(record:LoopRecord|null,definitionId:string|undefined):Definition|null{
  if(!record||record.definition.id!==definitionId||record.deletedAt||record.archived)return null;
  const revision=record.enabledRevision??record.publishedRevision;
  if(revision==null)return null;
  return record.revisions?.[revision]??(record.definition.revision===revision?record.definition:null);
}

export function runInput(definition:Definition,values:Record<string,Json>):Record<string,Json>{
  return Object.fromEntries(definition.inputSchema.filter(field=>field.required||Object.hasOwn(values,field.name)).map(field=>{
    const value=Object.hasOwn(values,field.name)?values[field.name]:undefined;
    return [field.name,field.type==='json'?JSON.parse(String(value??'null')):value??(field.type==='text'?'':field.type==='number'?0:false)];
  }));
}

type Target='published'|'draft';
type InputState={key:string;values:Record<string,Json>};
export function RunLauncher({draft,published,enabled,dirty,invalid,busy,authorized,onRun,onError}:{
  draft:Definition;published:Definition|null;enabled:boolean;dirty:boolean;invalid:boolean;busy:boolean;authorized:boolean;
  onRun:(request:{target:Target;definition:Definition;input:Record<string,Json>},origin?:HTMLElement)=>void;onError:(error:unknown)=>void;
}){
  const [target,setTarget]=useState<Target>(published?'published':'draft');
  const [inputs,setInputs]=useState<Partial<Record<Target,InputState>>>({});
  const definition=target==='published'?published:draft;
  const key=definition?JSON.stringify([definition.id,definition.inputSchema]):'';
  const values=inputs[target]?.key===key?inputs[target]!.values:{};
  const change=(name:string,value:Json|undefined)=>setInputs(previous=>{
    const values={...(previous[target]?.key===key?previous[target]!.values:{})};
    if(value===undefined)delete values[name];else values[name]=value;
    return {...previous,[target]:{key,values}};
  });
  const start=(event:React.MouseEvent<HTMLButtonElement>)=>{if(!definition)return;try{onRun({target,definition,input:runInput(definition,values)},event.currentTarget);}catch(error){onError(error);}};
  return <div className="lp-run-input">
    <div className="lp-section-heading"><h2>Run this loop</h2><span>{definition?`r${definition.revision}${target==='draft'&&dirty?' · unsaved':''}`:'—'}</span></div>
    <label className="lp-field"><span>Run target</span><select value={target} onChange={event=>setTarget(event.target.value as Target)}>
      <option value="published" disabled={!published}>{published?`Published r${published.revision}${enabled?'':' · disabled'}`:'No published revision'}</option>
      <option value="draft">Current draft r{draft.revision}{dirty?' · unsaved':''}</option>
    </select></label>
    {definition&&<p className="lp-hint">{definition.slug} · {target==='published'?'Uses the published definition and its inputs.':'Tests these edits without changing publication.'}</p>}
    {definition?.inputSchema.map(field=><label className="lp-field" key={field.name}><span>{field.label}{field.required?' *':''}</span>
      {field.type==='text'||field.type==='json'?<textarea rows={3} value={String(values[field.name]??'')} onChange={event=>change(field.name,event.target.value)}/>:field.type==='number'?<input type="number" value={Number(values[field.name]??0)} onChange={event=>change(field.name,Number(event.target.value))}/>:<input type="checkbox" checked={Boolean(values[field.name])} onChange={event=>change(field.name,event.target.checked)}/>}
      {!field.required&&<button type="button" className="lp-text-button" onClick={()=>change(field.name,undefined)}>Omit optional value{!Object.hasOwn(values,field.name)?' (omitted)':''}</button>}
    </label>)}
    <button type="button" className="primary lp-run-button" onClick={start} disabled={!definition||!authorized||busy||(target==='published'?!enabled:invalid)}>{busy?'Running…':target==='published'?'▶ Run loop':'Test current draft'}</button>
    {target==='published'&&!enabled&&<p className="lp-hint">Enable the published revision to start new runs, or select the current draft to test it.</p>}
    {target==='draft'&&invalid&&<p className="lp-hint">Resolve draft validation issues before testing this draft.</p>}
    <p className="lp-hint">Also available through /loops and agent tools.</p>
  </div>;
}
