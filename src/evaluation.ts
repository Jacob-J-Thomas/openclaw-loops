import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';

export type EvaluationJson=null|boolean|number|string|EvaluationJson[]|{[key:string]:EvaluationJson};
export type EvaluationPredicate={op:'equals'|'not-equals'|'contains'|'less-than'|'greater-than'|'truthy';expected?:EvaluationJson};
export type Evaluator={kind:'json-schema-2020';schema:EvaluationJson;version:string}|{kind:'predicate';predicate:EvaluationPredicate;version:string};
export type EvaluationError={code:string;instancePath:string;schemaPath?:string;keyword?:string;message:string;params?:EvaluationJson};
export type EvaluationResult={kind:'loops-evaluation';passed:boolean;errors:EvaluationError[];evaluatorVersion:string;evaluatorDigest:string;inputDigest:string;evidenceDigest:string};
export type EvaluationLimits={maxInputBytes:number;maxSchemaBytes:number;maxResultBytes:number;maxErrors:number;timeoutMs:number};
export const defaultEvaluationLimits:EvaluationLimits={maxInputBytes:131072,maxSchemaBytes:131072,maxResultBytes:131072,maxErrors:100,timeoutMs:1000};
// Evaluation inputs are at most 128 KiB by default. These caps leave the
// 16-GB host ample room for its single inference worker while bounding an
// untrusted schema compiler to a small, disposable isolate.
export const evaluationWorkerResourceLimits={maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4} as const;

type WorkerRequest={input:EvaluationJson;evaluator:Evaluator;limits:EvaluationLimits};
type WorkerReply={ok:true;result:EvaluationResult}|{ok:false;error:EvaluationError};

export class EvaluationFailure extends Error{
  constructor(readonly detail:EvaluationError){super(detail.message);this.name='EvaluationFailure';}
}

export function canonicalJson(value:EvaluationJson):string{
  const visit=(current:EvaluationJson,depth=0):string=>{
    if(depth>100)throw new EvaluationFailure({code:'LOOPS_EVALUATION_RESOURCE_LIMIT',instancePath:'',message:'Evaluation JSON exceeds 100 nesting levels.'});
    if(current===null)return 'null';
    if(typeof current==='boolean')return current?'true':'false';
    if(typeof current==='number'){if(!Number.isFinite(current))throw new EvaluationFailure({code:'LOOPS_EVALUATION_INPUT_INVALID',instancePath:'',message:'Evaluation JSON requires finite numbers.'});return JSON.stringify(current);}
    if(typeof current==='string')return JSON.stringify(current);
    if(Array.isArray(current))return `[${current.map(item=>visit(item,depth+1)).join(',')}]`;
    const record=current as Record<string,EvaluationJson>;
    if(Object.getPrototypeOf(record)!==Object.prototype)throw new EvaluationFailure({code:'LOOPS_EVALUATION_INPUT_INVALID',instancePath:'',message:'Evaluation JSON must use plain objects.'});
    const keys=Object.keys(record);if(keys.some(key=>['__proto__','prototype','constructor'].includes(key)))throw new EvaluationFailure({code:'LOOPS_EVALUATION_INPUT_INVALID',instancePath:'',message:'Evaluation JSON cannot use prototype-related object keys.'});
    return `{${keys.sort().map(key=>`${JSON.stringify(key)}:${visit(record[key]!,depth+1)}`).join(',')}}`;
  };
  return visit(value);
}

export function evaluationDigest(value:EvaluationJson):string{return createHash('sha256').update(canonicalJson(value)).digest('hex');}
export function evaluatorConfiguration(evaluator:Evaluator):EvaluationJson{return evaluator.kind==='json-schema-2020'?{kind:evaluator.kind,version:evaluator.version,schema:evaluator.schema}:{kind:evaluator.kind,version:evaluator.version,predicate:evaluator.predicate};}

function checkedRequest(input:EvaluationJson,evaluator:Evaluator,limits:EvaluationLimits):WorkerRequest{
  if(Object.values(limits).some(value=>!Number.isInteger(value)||value<1))throw new EvaluationFailure({code:'LOOPS_EVALUATION_LIMIT_INVALID',instancePath:'',message:'Evaluation limits must be positive integers.'});
  const inputBytes=Buffer.byteLength(canonicalJson(input));
  if(inputBytes>limits.maxInputBytes)throw new EvaluationFailure({code:'LOOPS_EVALUATION_RESOURCE_LIMIT',instancePath:'',message:`Evaluation input exceeds ${limits.maxInputBytes} bytes.`});
  if(Buffer.byteLength(canonicalJson(evaluatorConfiguration(evaluator)))>limits.maxSchemaBytes)throw new EvaluationFailure({code:'LOOPS_EVALUATION_RESOURCE_LIMIT',instancePath:'',message:`Evaluation configuration exceeds ${limits.maxSchemaBytes} bytes.`});
  return {input,evaluator,limits};
}

export async function evaluate(input:EvaluationJson,evaluator:Evaluator,options:{limits?:Partial<EvaluationLimits>;signal?:AbortSignal;workerUrl?:URL}={}):Promise<EvaluationResult>{
  const limits={...defaultEvaluationLimits,...options.limits};
  const request=checkedRequest(input,evaluator,limits);
  if(options.signal?.aborted)throw new EvaluationFailure({code:'LOOPS_EVALUATION_CANCELLED',instancePath:'',message:'Evaluation was cancelled.'});
  const worker=new Worker(options.workerUrl??new URL('./evaluation-worker.js',import.meta.url),{resourceLimits:evaluationWorkerResourceLimits});
  return await new Promise<EvaluationResult>((resolve,reject)=>{
    let settled=false;
    const finish=(result:EvaluationResult|undefined,error:unknown)=>{
      if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);
      void worker.terminate().catch(()=>undefined).then(()=>{if(error)reject(error);else resolve(result!);});
    };
    const abort=()=>finish(undefined,new EvaluationFailure({code:'LOOPS_EVALUATION_CANCELLED',instancePath:'',message:'Evaluation was cancelled.'}));
    const timer=setTimeout(()=>finish(undefined,new EvaluationFailure({code:'LOOPS_EVALUATION_TIMEOUT',instancePath:'',message:`Evaluation exceeded ${limits.timeoutMs} ms.`})),limits.timeoutMs);
    options.signal?.addEventListener('abort',abort,{once:true});
    worker.once('error',cause=>finish(undefined,new EvaluationFailure({code:'LOOPS_EVALUATION_WORKER_FAILED',instancePath:'',message:`Evaluation worker failed: ${cause instanceof Error?cause.message:String(cause)}`})));
    worker.once('message',(reply:WorkerReply)=>reply.ok?finish(reply.result,undefined):finish(undefined,new EvaluationFailure(reply.error)));
    worker.once('exit',code=>finish(undefined,new EvaluationFailure({code:'LOOPS_EVALUATION_WORKER_EXITED',instancePath:'',message:`Evaluation worker exited before replying (code ${code}).`})));
    worker.postMessage(request);
  });
}
