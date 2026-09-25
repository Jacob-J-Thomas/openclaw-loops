import {MessageChannel,receiveMessageOnPort,parentPort,workerData} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {dirname,join} from 'node:path';
import {Engine,type Actor,type HostCapabilities} from './engine.js';
import {SqliteStorage} from './storage.js';
import {requestError} from './errors.js';
import type {ServiceOptions} from './engine-service.js';
import {actorIdentity,engineMethods,encodeError,decodeError,type ActorRef,type WorkerActor,type Reply,type ServiceRequest,type ServiceResponse,type HostRequest} from './engine-service-protocol.js';

const port=parentPort!;
const send=(message:ServiceResponse)=>port.postMessage(message);
const actors=new Map<string,AbortController>();
const calls=new Map<string,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void}>();
const hostRequest=(actor:Actor,method:HostRequest['method'],args:unknown[]):HostRequest=>({type:'host',id:randomUUID(),actorId:(actor as WorkerActor)[actorIdentity],method,args,execution:{model:actor.model,reasoning:actor.reasoning,authProfileId:actor.authProfileId}});
function syncHost(actor:Actor,method:HostRequest['method'],args:unknown[]=[]):unknown{
  // Only this worker waits. The Gateway processes the bound host check and can
  // continue serving unrelated work while SQLite acknowledgements are pending.
  const {port1,port2}=new MessageChannel(),signal=new SharedArrayBuffer(4);
  try{
    port.postMessage({...hostRequest(actor,method,args),port:port2,signal},[port2]);
    if(Atomics.wait(new Int32Array(signal),0,0,30000)==='timed-out')throw requestError('The Gateway did not acknowledge the invocation check.','LOOPS_SERVICE_UNAVAILABLE');
    const response=receiveMessageOnPort(port1)?.message as Reply|undefined;
    if(!response)throw requestError('The Gateway returned no invocation check.','LOOPS_SERVICE_UNAVAILABLE');
    if(!response.ok)throw decodeError(response.error);return response.value;
  }finally{port1.close();port2.close();}
}
function asyncHost(actor:Actor,method:HostRequest['method'],args:unknown[]=[],signal?:AbortSignal):Promise<unknown>{
  signal?.throwIfAborted();
  const message=hostRequest(actor,method,args);
  const abort=()=>send({type:'abortHost',id:message.id});
  const result=new Promise<unknown>((resolve,reject)=>{calls.set(message.id,{resolve,reject});try{send(message);}catch(error){calls.delete(message.id);reject(error);}});
  signal?.addEventListener('abort',abort,{once:true});
  return result.finally(()=>signal?.removeEventListener('abort',abort));
}
function actorFor(ref:ActorRef):WorkerActor{
  const controller=new AbortController();actors.set(ref.id,controller);
  if(ref.aborted)controller.abort(requestError('The invoking request was cancelled.','HOST_ABORTED'));
  const actor:WorkerActor={...ref.data,[actorIdentity]:ref.id,signal:controller.signal,check:()=>{syncHost(actor,'checkActor');}};
  return actor;
}
const host:HostCapabilities={
  check:(actor,capability)=>{syncHost(actor,'check',[capability]);},
  capabilities:(actor,settings)=>syncHost(actor,'capabilities',[settings]) as ReturnType<NonNullable<HostCapabilities['capabilities']>>,
  complete:(actor,prompt,signal,timeout,settings,structured)=>asyncHost(actor,'complete',[prompt,timeout,settings,structured],signal) as ReturnType<HostCapabilities['complete']>,
  modelInfo:actor=>asyncHost(actor,'modelInfo') as ReturnType<HostCapabilities['modelInfo']>,
};
let engine:Engine|undefined,storage:SqliteStorage|undefined,closing=false;
try{
  const {file,legacyFile,...options}=workerData as ServiceOptions;
  storage=new SqliteStorage(file,legacyFile);
  engine=new Engine(storage,host,{...options,documentDirectory:join(dirname(file),'documents'),onChange:()=>send({type:'changed'}),retainActor:actor=>send({type:'retain',actorId:(actor as WorkerActor)[actorIdentity]}),releaseActor:actor=>send({type:'release',actorId:(actor as WorkerActor)[actorIdentity]})});
  send({type:'ready',reply:{ok:true,value:undefined}});
}catch(error){
  try{await storage?.close();}catch{/* Preserve the startup error; parent termination still joins the worker tree. */}
  send({type:'ready',reply:{ok:false,error:encodeError(error)}});
  port.close();
}
if(engine)port.on('message',(message:ServiceRequest)=>{
  if(message.type==='hostResult'){
    const pending=calls.get(message.id);calls.delete(message.id);
    if(message.reply.ok)pending?.resolve(message.reply.value);else pending?.reject(decodeError(message.reply.error));
  }else if(message.type==='abortActor')actors.get(message.actorId)?.abort(requestError('The invoking request was cancelled.','HOST_ABORTED'));
  else if(message.type==='disposeActor')actors.delete(message.actorId);
  else{
    const respond=(reply:Reply)=>send({type:'result',id:message.id,reply});
    const fail=(error:unknown)=>respond({ok:false,error:encodeError(error)});
    try{
      if(message.type==='close'){
        closing=true;
        if(message.operation!=='close')throw new Error('Unknown service operation.');
        void engine!.close().then(()=>respond({ok:true,value:undefined}),fail);return;
      }
      if(closing)throw requestError('Loops service is stopping.','LOOPS_SERVICE_UNAVAILABLE');
      if(!engineMethods.includes(message.operation))throw requestError('Unknown service operation.');
      const method=engine![message.operation] as unknown as (actor:Actor,...args:unknown[])=>unknown;
      const result=method.call(engine,actorFor(message.actor),...message.args);
      // Snapshot synchronous results before another message can mutate state.
      if(result instanceof Promise)void result.then(value=>respond({ok:true,value}),fail).catch(fail);
      else respond({ok:true,value:result});
    }catch(error){fail(error);}
  }
});
