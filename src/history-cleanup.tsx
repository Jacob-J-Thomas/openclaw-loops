import React,{useState} from 'react';
import type {RetentionPolicy,RetentionResult} from './retention.js';
import {FailureNotice,displayFailure,type DisplayFailure} from './failure-notice.js';

export function HistoryCleanup({invoke,onApplied,disabled}:{invoke:(policy:RetentionPolicy,planId?:string)=>Promise<RetentionResult>;onApplied:(ids:string[])=>void;disabled:boolean}){
  const [days,setDays]=useState(''),[keep,setKeep]=useState('');
  const [preview,setPreview]=useState<RetentionResult>(),[error,setError]=useState<DisplayFailure>(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const act=async(apply=false)=>{
    setBusy(true);setError('');setMessage('');
    try{
      const policy=apply?preview!.policy:{...days!==''?{olderThanDays:Number(days)}:{},...keep!==''?{keepLatest:Number(keep)}:{}};
      const result=await invoke(policy,apply?preview!.planId:undefined);
      if(result.applied){setPreview(undefined);setMessage(`Removed ${result.candidates.length} ${result.candidates.length===1?'run':'runs'} from this conversation's history.`);onApplied(result.candidates.map(run=>run.id));}else setPreview(result);
    }catch(error){setError(displayFailure(error));setPreview(undefined);}finally{setBusy(false);}
  };
  const change=(set:(value:string)=>void,value:string)=>{set(value);setPreview(undefined);setMessage('');};
  return <details className="lp-history-cleanup"><summary>History cleanup</summary>
    <p className="lp-hint">Choose a policy, then preview the runs it would remove. Active runs and recovery parents are protected. Loop definitions are preserved.</p>
    <label className="lp-field"><span>Older than (days)</span><input type="number" min={0} step="any" placeholder="Any age" disabled={busy} value={days} onChange={event=>change(setDays,event.target.value)}/></label>
    <label className="lp-field"><span>Keep at least the latest runs</span><input type="number" min={0} step={1} placeholder="No minimum" disabled={busy} value={keep} onChange={event=>change(setKeep,event.target.value)}/></label>
    <button disabled={disabled||busy||days===''&&keep===''} onClick={()=>void act()}>Preview history cleanup</button>
    {preview&&<><p role="status">{preview.candidates.length} eligible of {preview.total}. Protected: {preview.protected.active} active or settling, {preview.protected.ancestry} recovery parents, {preview.protected.recent} recent.</p>
      <details><summary>Runs to remove</summary><ul>{preview.candidates.map(run=><li key={run.id}><code>{run.id}</code> · {run.updatedAt}</li>)}</ul></details>
      <p className="lp-hint">Deleted run evidence cannot be restored here. Existing backups and transport documents are retained separately. Old request IDs will remain reserved.</p>
      <button className="danger" disabled={disabled||busy||!preview.candidates.length} onClick={()=>void act(true)}>Delete {preview.candidates.length} eligible {preview.candidates.length===1?'run':'runs'}</button>
    </>}
    <FailureNotice failure={error} label="History cleanup failure"/>{message&&<p role="status">{message}</p>}
  </details>;
}
