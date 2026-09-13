import type {MessagePort} from 'node:worker_threads';
import type {Actor,Engine} from './engine.js';
import type {InferenceSettings} from './inference-settings.js';
import {LoopError,type LoopErrorData} from './errors.js';

// Private, same-process worker protocol. It is not a second host API or a
// capability token that callers can supply through the feature contract.
export const engineMethods=['browse','retention','test','retry','draft','versions','publish','restore','archive','deleted','recover','output','history','capabilities','validate','list','describe','run','status','resume','cancel','library','load','save','create','edit','delete','enable','revoke','runs','review','documentWrap','documentRead','documentUpload','documentResolve'] as const satisfies ReadonlyArray<keyof Engine>;
export type EngineMethod=typeof engineMethods[number];
export type EngineArgs<M extends EngineMethod>=Parameters<Engine[M]> extends [Actor,...infer A]?A:never;
export type EngineResult<M extends EngineMethod>=Awaited<ReturnType<Engine[M]>>;
export type ActorData=Omit<Actor,'check'|'complete'|'signal'>;
export type ActorRef={id:string;data:ActorData;aborted:boolean};
export const actorIdentity=Symbol('worker invocation');
export type WorkerActor=Actor&{[actorIdentity]:string};
export type ErrorData={name:string;message:string;detail?:LoopErrorData;code?:string;status?:number;cause?:ErrorData};
export type Reply={ok:true;value:unknown}|{ok:false;error:ErrorData};
export type HostRequest={type:'host';id:string;actorId:string;execution:Pick<Actor,'model'|'reasoning'|'authProfileId'>;method:'checkActor'|'check'|'capabilities'|'complete'|'modelInfo';args:unknown[];port?:MessagePort;signal?:SharedArrayBuffer};
export type ServiceRequest={type:'invoke';id:string;operation:EngineMethod;actor:ActorRef;args:unknown[]}|{type:'close';id:string;operation:'close'}|{type:'abortActor';actorId:string}|{type:'disposeActor';actorId:string}|{type:'hostResult';id:string;reply:Reply};
export type ServiceResponse={type:'ready';reply:Reply}|{type:'result';id:string;reply:Reply}|{type:'changed'}|{type:'retain'|'release';actorId:string}|{type:'abortHost';id:string}|HostRequest;
export type HostCompletionArgs=[prompt:string,timeoutMs:number|undefined,settings:InferenceSettings|undefined];

// Structured clone drops custom Error properties. Keep only fields used by the
// existing error classifier; raw causes remain private and are never receipts.
export function encodeError(error:unknown,depth=0):ErrorData{
  if(!error||typeof error!=='object')return {name:'Error',message:typeof error==='string'?error:'Unknown worker failure.'};
  const field=(name:string):unknown=>Object.getOwnPropertyDescriptor(error,name)?.value;
  const name=field('name'),message=field('message'),code=field('code'),status=field('status')??field('statusCode')??field('httpStatusCode'),cause=field('cause');
  return {name:typeof name==='string'?name:'Error',message:typeof message==='string'?message:'Unknown worker failure.',
    ...error instanceof LoopError?{detail:error.detail}:{},...typeof code==='string'?{code}:{},...typeof status==='number'?{status}:{},...cause&&depth<4?{cause:encodeError(cause,depth+1)}:{}};
}
export function decodeError(error:ErrorData):Error{
  const options=error.cause?{cause:decodeError(error.cause)}:undefined;
  const result=error.detail?new LoopError(error.detail,options):new Error(error.message,options);
  result.name=error.name;
  if(error.code!==undefined&&!error.detail)Object.assign(result,{code:error.code});
  if(error.status!==undefined)Object.assign(result,{status:error.status});
  return result;
}
