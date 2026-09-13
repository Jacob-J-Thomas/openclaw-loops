import React,{useCallback,useEffect,useRef,useState} from 'react';
import type {createLoopsClient} from './feature-client.js';
import type {Engine,LoopRecord} from './engine.js';

type Page=ReturnType<Engine['browse']>;
const empty=():Page=>({items:[],offset:0,total:0,nextCursor:null});
function Pages({page,previous,busy,label,onPrevious,onNext}:{page:Page;previous:boolean;busy:boolean;label:string;onPrevious:()=>void;onNext:()=>void}){
  return <nav className="lp-library-pages" aria-label={`${label} pages`}>
    <button disabled={busy||!previous} onClick={onPrevious}>Previous {label}</button>
    <span aria-live="polite">{page.total?`${page.offset+1}–${page.offset+page.items.length} of ${page.total}`:'0 results'}</span>
    <button disabled={busy||page.nextCursor===null} onClick={onNext}>Next {label}</button>
  </nav>;
}
export function LibraryBrowser({feature,options,selectedId,onPage,onSelect,onRecovered,children}:{feature:ReturnType<typeof createLoopsClient>;options:{agentId:string;sessionKey:string};selectedId?:string;onPage:(items:Page['items'])=>void;onSelect:(id:string)=>Promise<void>;onRecovered:(record:LoopRecord)=>void;children?:React.ReactNode}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(empty),[recovery,setRecovery]=useState(empty);
  const [cursors,setCursors]=useState<string[]>([]),[recoveryCursors,setRecoveryCursors]=useState<string[]>([]),[recoveryOpen,setRecoveryOpen]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const cursor=cursors.at(-1),recoveryCursor=recoveryCursors.at(-1);
  const scope=JSON.stringify(options),view=JSON.stringify([scope,search,cursor,recoveryCursor,recoveryOpen]),current=useRef(view);current.current=view;
  const serial=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++serial.current;const matches=()=>serial.current===request&&current.current===view;
    if(!options.sessionKey){setPage(empty());setRecovery(empty());onPage([]);return;}
    setBusy(true);
    try{
      const [active,hidden]=await Promise.allSettled([feature.invoke('browse',{search,...cursor?{cursor}:{},limit:50},options),recoveryOpen?feature.invoke('browse',{view:'recoverable',search,...recoveryCursor?{cursor:recoveryCursor}:{},limit:50},options):undefined]);
      if(!matches())return;
      const errors:string[]=[];
      const failed=(error:unknown,reset:()=>void)=>{
        if(error instanceof Error&&'code' in error&&error.code==='LOOPS_LIBRARY_CHANGED'){
          reset();setNotice('Library changed. Browsing restarts on the first page; your editor stays open.');
        }else errors.push(error instanceof Error?error.message:String(error));
      };
      if(active.status==='fulfilled'){setPage(active.value);onPage(active.value.items);}else failed(active.reason,()=>setCursors([]));
      if(hidden.status==='fulfilled'){if(hidden.value)setRecovery(hidden.value);}else{setRecovery(empty());failed(hidden.reason,()=>setRecoveryCursors([]));}
      setError(errors.join(' '));
    }catch(error){
      if(!matches())return;
      if(error instanceof Error&&'code' in error&&error.code==='LOOPS_LIBRARY_CHANGED'){
        setCursors([]);setRecoveryCursors([]);setNotice('Library changed. Browsing restarts on the first page; your editor stays open.');
      }else setError(error instanceof Error?error.message:String(error));
    }finally{if(matches())setBusy(false);}
  },[feature,options,search,cursor,recoveryCursor,recoveryOpen,view,onPage]);
  useEffect(()=>{setCursors([]);setRecoveryCursors([]);setPage(empty());setRecovery(empty());setError('');setNotice('');},[scope]);
  useEffect(()=>{
    void refresh();const off=feature.on('changed',()=>void refresh());const timer=setInterval(()=>void refresh(),5000);
    return()=>{serial.current++;off();clearInterval(timer);};
  },[feature,refresh]);
  const next=(target:Page,set:React.Dispatch<React.SetStateAction<string[]>>)=>{if(target.nextCursor)set(previous=>previous.at(-1)===target.nextCursor?previous:[...previous,target.nextCursor!]);};
  const recover=async(record:Page['items'][number])=>{
    setError('');
    try{const result=await feature.invoke('recover',{id:record.id,expectedRevision:record.revision},options);if(current.current!==view)return;onRecovered(result);await refresh();}
    catch(error){if(current.current===view)setError(error instanceof Error?error.message:String(error));}
  };
  return <aside className="lp-library" aria-label="Loop library" aria-busy={busy}>
    <div className="lp-section-heading"><h2>Library</h2><span>{page.total}</span></div>
    <label className="lp-field lp-library-search"><span>Search loops</span><input maxLength={500} value={search} onChange={event=>{setSearch(event.target.value);setCursors([]);setRecoveryCursors([]);setNotice('');}}/></label>
    {error&&<p className="lp-library-notice" role="alert">{error}</p>}{notice&&<p className="lp-library-notice" role="status">{notice}</p>}
    <div className="lp-loop-list">{page.items.map(item=><button key={item.id} className={`lp-loop-card ${selectedId===item.id?'active':''}`} onClick={()=>void onSelect(item.id)}><div><span className={`lp-dot ${item.enabledRevision?'completed':''}`}/><span className="lp-revision">r{item.revision}</span></div><strong>{item.name}</strong><small>{item.description}</small><span className="lp-loop-state">{item.enabledRevision?`Enabled r${item.enabledRevision}`:'Disabled'}{item.hasDraft?' · draft':''}</span></button>)}</div>
    <Pages label="loops" page={page} previous={cursors.length>0} busy={busy} onPrevious={()=>setCursors(previous=>previous.slice(0,-1))} onNext={()=>next(page,setCursors)}/>
    <details className="lp-library-recovery" onToggle={event=>setRecoveryOpen(event.currentTarget.open)}><summary>Archived & deleted loops</summary>
      {recovery.items.map(item=><div key={item.id}><strong>{item.slug}</strong><small>{item.deletedAt?'Deleted':'Archived'} · r{item.revision}</small><button onClick={()=>void recover(item)}>Recover {item.slug}</button></div>)}
      {!recovery.items.length&&!busy&&!error&&<p>No matching archived or deleted loops.</p>}
      <Pages label="recoverable loops" page={recovery} previous={recoveryCursors.length>0} busy={busy} onPrevious={()=>setRecoveryCursors(previous=>previous.slice(0,-1))} onNext={()=>next(recovery,setRecoveryCursors)}/>
    </details>{children}
  </aside>;
}
