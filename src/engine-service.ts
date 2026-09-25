import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import type {Actor,HostCapabilities} from './engine.js';
import type {Budgets} from './budgets.js';
import type {Capability} from './graph.js';
import type {InferenceSettings} from './inference-settings.js';
import {requestError} from './errors.js';
import {decodeError,encodeError,type EngineMethod,type EngineArgs,type EngineResult,type ActorData,type HostRequest,type HostCompletionArgs,type Reply,type ServiceResponse} from './engine-service-protocol.js';

type Pending={resolve:(value:unknown)=>void;reject:(error:unknown)=>void};
type Invocation={actor:Actor;references:number;unlisten:()=>void;settled:()=>void};
export type ServiceOptions={file:string;legacyFile?:string;budgets?:Partial<Budgets>;concurrency?:number;replyTimeoutMs?:number};
const unavailable=()=>requestError('Loops service is unavailable or stopping.','LOOPS_SERVICE_UNAVAILABLE','Restart the plugin and inspect committed runs before retrying uncertain work.');

// The Gateway never waits synchronously for database acknowledgements. The
// worker owns the existing engine's committed-state ordering; host capabilities
// stay bound to the original authenticated invocation in this thread.
export class EngineService{
  private worker:Worker;
  private pending=new Map<string,Pending>();
  private actors=new Map<string,Invocation>();
  private hostCalls=new Map<string,AbortController>();
  private hostSettlements=new Set<Promise<void>>();
  private closed=false;
  private shutdown?:Promise<void>;
  private termination?:Promise<void>;
  readonly ready:Promise<void>;
  constructor(options:ServiceOptions,private host:HostCapabilities,onChange?:()=>void){
    this.worker=new Worker(new URL('../dist/engine-service-worker.js',import.meta.url),{workerData:options});
    this.ready=new Promise<void>((resolve,reject)=>this.pending.set('ready',{resolve:()=>resolve(),reject}));
    // A caller may register/start a service before awaiting readiness.
    void this.ready.catch(()=>{});
    this.worker.on('message',(message:ServiceResponse)=>{
      if(message.type==='ready'||message.type==='result'){
        const id=message.type==='ready'?'ready':message.id,pending=this.pending.get(id);this.pending.delete(id);
        if(message.reply.ok)pending?.resolve(message.reply.value);else pending?.reject(decodeError(message.reply.error));
        if(message.type==='ready'&&!message.reply.ok)this.fail(decodeError(message.reply.error));
      }else if(message.type==='host')this.callHost(message);
      else if(message.type==='abortHost')this.hostCalls.get(message.id)?.abort(unavailable());
      else if(message.type==='retain')this.retain(message.actorId);
      else if(message.type==='release')this.release(message.actorId);
      else if(message.type==='changed'){try{onChange?.();}catch{/* Committed state is independent of event subscribers. */}}
    });
    this.worker.on('error',error=>this.fail(error));
    this.worker.on('exit',()=>this.fail(unavailable()));
  }
  async invoke<M extends EngineMethod>(operation:M,actor:Actor,...args:EngineArgs<M>):Promise<EngineResult<M>>{
    return (await this.invokeTracked(operation,actor,args)).result;
  }
  // Native tool and command handlers keep their host invocation live until the
  // worker releases this actor after queue, pump and physical host settlement.
  // UI session actions continue to use invoke() and its inspectable 10s handle.
  async invokeJoined<M extends 'run'|'test'|'retry'|'resume'|'review'>(operation:M,actor:Actor,...args:EngineArgs<M>):Promise<EngineResult<M>>{
    return this.invokeJoinedWithHandle(operation,actor,undefined,...args);
  }
  // A UI action may publish its running handle while a separate host session
  // work admission remains awaited until this same invocation settles.
  async invokeJoinedWithHandle<M extends 'run'|'test'|'retry'|'resume'|'review'>(operation:M,actor:Actor,onHandle:((result:EngineResult<M>)=>void)|undefined,...args:EngineArgs<M>):Promise<EngineResult<M>>{
    const {result,settled}=await this.invokeTracked(operation,actor,args);
    let handle:EngineResult<M>;
    try{handle=await result;onHandle?.(handle);}
    catch(error){await settled;throw error;}
    await settled;
    return await this.invoke('status',actor,(handle as {id:string}).id) as EngineResult<M>;
  }
  private async invokeTracked<M extends EngineMethod>(operation:M,actor:Actor,args:EngineArgs<M>):Promise<{result:Promise<EngineResult<M>>;settled:Promise<void>}>{
    await this.ready;if(this.closed)throw unavailable();actor.check();
    const id=randomUUID(),actorId=randomUUID();
    let resolveSettlement!:()=>void;
    const settled=new Promise<void>(resolve=>{resolveSettlement=resolve;});
    const abort=()=>{if(!this.closed)this.worker.postMessage({type:'abortActor',actorId});};
    actor.signal?.addEventListener('abort',abort,{once:true});
    this.actors.set(actorId,{actor,references:1,unlisten:()=>actor.signal?.removeEventListener('abort',abort),settled:resolveSettlement});
    const data:ActorData={agentId:actor.agentId,sessionKey:actor.sessionKey,sessionId:actor.sessionId,source:actor.source,human:actor.human,canManage:actor.canManage,requester:actor.requester,model:actor.model,reasoning:actor.reasoning,authProfileId:actor.authProfileId};
    const result=this.request(id,{type:'invoke',id,operation,actor:{id:actorId,data,aborted:actor.signal?.aborted??false},args}) as Promise<EngineResult<M>>;
    // Release the request reference on either outcome. The worker and host
    // retain their own references while physical work remains outstanding.
    void result.then(()=>this.release(actorId),()=>this.release(actorId));
    return {result,settled};
  }
  private request(id:string,message:unknown){
    return new Promise<unknown>((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{this.worker.postMessage(message);}catch(error){this.pending.delete(id);reject(error);}});
  }
  private retain(id:string){const entry=this.actors.get(id);if(entry)entry.references++;}
  private release(id:string){const entry=this.actors.get(id);if(entry&&--entry.references===0){entry.unlisten();this.actors.delete(id);entry.settled();if(!this.closed)this.worker.postMessage({type:'disposeActor',actorId:id});}}
  private callHost(request:HostRequest){
    const reply=(result:Reply)=>{
      if(request.port&&request.signal){
        try{request.port.postMessage(result);}catch(error){request.port.postMessage({ok:false,error:encodeError(error)});}
        finally{Atomics.store(new Int32Array(request.signal),0,1);Atomics.notify(new Int32Array(request.signal),0);request.port.close();}
      }else if(!this.closed)this.worker.postMessage({type:'hostResult',id:request.id,reply:result});
    };
    const failed=(error:unknown)=>reply({ok:false,error:encodeError(error)});
    const entry=this.actors.get(request.actorId);
    if(this.closed||!entry){failed(unavailable());return;}
    // Only execution settings are pinned by the worker. Identity, permissions,
    // signal and request-bound completion always come from the original actor.
    const actor:Actor={...entry.actor,...request.execution};
    try{
      actor.check();
      if(request.method==='checkActor'){reply({ok:true,value:undefined});return;}
      if(request.method==='check'){this.host.check(actor,request.args[0] as Capability);reply({ok:true,value:undefined});return;}
      if(request.method==='capabilities'){reply({ok:true,value:this.host.capabilities?.(actor,request.args[0] as InferenceSettings)});return;}
      const controller=new AbortController();this.hostCalls.set(request.id,controller);this.retain(request.actorId);
      const signal=actor.signal?AbortSignal.any([controller.signal,actor.signal]):controller.signal;
      const [prompt,timeoutMs,settings,structured]=request.args as HostCompletionArgs;
      const work=Promise.resolve().then(()=>{actor.check();signal.throwIfAborted();return request.method==='complete'?this.host.complete(actor,prompt,signal,timeoutMs,settings,structured):this.host.modelInfo(actor);})
        .then(value=>reply({ok:true,value})).catch(failed).catch(()=>{/* A terminated worker cannot receive a late host result. */})
        .finally(()=>{this.hostCalls.delete(request.id);this.release(request.actorId);});
      this.hostSettlements.add(work);
      void work.then(()=>this.hostSettlements.delete(work),()=>this.hostSettlements.delete(work));
    }catch(error){failed(error);}
  }
  close():Promise<void>{
    if(!this.shutdown)this.shutdown=(async()=>{
      try{await this.ready;if(!this.closed){const id=randomUUID();await this.request(id,{type:'close',operation:'close',id});}}
      finally{this.fail(unavailable());await this.termination;}
    })();
    return this.shutdown;
  }
  private fail(error:unknown){
    if(this.closed)return;this.closed=true;
    for(const pending of this.pending.values())pending.reject(error);this.pending.clear();
    for(const controller of this.hostCalls.values())controller.abort(error);
    const actors=[...this.actors.values()];
    for(const entry of actors)entry.unlisten();this.actors.clear();
    // A worker failure can precede an abort-ignoring host promise. The joined
    // admission cannot settle until both the worker tree and every local host
    // call have actually settled. This does not assert remote provider stop.
    this.termination=Promise.allSettled([this.worker.terminate(),...this.hostSettlements]).then(()=>{for(const entry of actors)entry.settled();});
  }
}
