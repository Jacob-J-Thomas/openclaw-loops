import {Ajv2020,type ErrorObject,type ValidateFunction} from 'ajv/dist/2020.js';
import {parentPort} from 'node:worker_threads';
import {canonicalJson,evaluationDigest,evaluatorConfiguration,type EvaluationError,type EvaluationJson,type EvaluationPredicate,type EvaluationResult,type Evaluator} from './evaluation.js';

type Request={input:EvaluationJson;evaluator:Evaluator;limits:{maxInputBytes:number;maxSchemaBytes:number;maxResultBytes:number;maxErrors:number;timeoutMs:number}};
const error=(code:string,message:string,extra:Partial<EvaluationError>={}):EvaluationError=>({code,instancePath:'',message,...extra});
function isRemoteReference(value:EvaluationJson):boolean{
  if(Array.isArray(value))return value.some(isRemoteReference);
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>['$ref','$dynamicRef','$recursiveRef'].includes(key)&&typeof item==='string'&&!item.startsWith('#')||isRemoteReference(item));
}
function contains(value:EvaluationJson,expected:EvaluationJson):boolean{
  if(typeof value==='string'&&typeof expected==='string')return value.includes(expected);
  if(Array.isArray(value))return value.some(item=>canonicalJson(item)===canonicalJson(expected));
  return false;
}
function predicate(input:EvaluationJson,value:EvaluationPredicate):boolean{
  switch(value.op){
    case 'equals':return value.expected!==undefined&&canonicalJson(input)===canonicalJson(value.expected);
    case 'not-equals':return value.expected!==undefined&&canonicalJson(input)!==canonicalJson(value.expected);
    case 'contains':return value.expected!==undefined&&contains(input,value.expected);
    case 'less-than':return typeof input==='number'&&typeof value.expected==='number'&&input<value.expected;
    case 'greater-than':return typeof input==='number'&&typeof value.expected==='number'&&input>value.expected;
    case 'truthy':return input!==false&&input!==null&&input!==0&&input!=='';
  }
}
function result(input:EvaluationJson,evaluator:Evaluator,passed:boolean,errors:EvaluationError[]):EvaluationResult{
  const evaluatorDigest=evaluationDigest(evaluatorConfiguration(evaluator)),inputDigest=evaluationDigest(input);
  return {kind:'loops-evaluation',passed,errors,evaluatorVersion:evaluator.version,evaluatorDigest,inputDigest,evidenceDigest:evaluationDigest({evaluatorDigest,inputDigest,passed,errors:errors as EvaluationJson})};
}
function bounded(result:EvaluationResult,limits:Request['limits']):EvaluationResult{
  if(result.errors.length>limits.maxErrors)throw error('LOOPS_EVALUATION_RESOURCE_LIMIT',`Evaluation produced more than ${limits.maxErrors} errors.`);
  if(Buffer.byteLength(canonicalJson(result as unknown as EvaluationJson))>limits.maxResultBytes)throw error('LOOPS_EVALUATION_RESOURCE_LIMIT',`Evaluation result exceeds ${limits.maxResultBytes} bytes.`);
  return result;
}
function evaluateRequest({input,evaluator,limits}:Request):EvaluationResult{
  if(Buffer.byteLength(canonicalJson(input))>limits.maxInputBytes)throw error('LOOPS_EVALUATION_RESOURCE_LIMIT',`Evaluation input exceeds ${limits.maxInputBytes} bytes.`);
  if(Buffer.byteLength(canonicalJson(evaluatorConfiguration(evaluator)))>limits.maxSchemaBytes)throw error('LOOPS_EVALUATION_RESOURCE_LIMIT',`Evaluation configuration exceeds ${limits.maxSchemaBytes} bytes.`);
  if(evaluator.kind==='predicate'){
    const passed=predicate(input,evaluator.predicate);
    return bounded(result(input,evaluator,passed,passed?[]:[error('LOOPS_EVALUATION_PREDICATE_FAILED','Predicate did not match input.',{keyword:evaluator.predicate.op})]),limits);
  }
  if(isRemoteReference(evaluator.schema))throw error('LOOPS_EVALUATION_REMOTE_REF','Evaluation schemas may reference only local fragments.');
  let validate:ValidateFunction;
  try{validate=new Ajv2020({allErrors:true,strict:true,validateSchema:true,loadSchema:undefined}).compile(evaluator.schema as unknown as Parameters<Ajv2020['compile']>[0]);}catch(cause){throw error('LOOPS_EVALUATION_SCHEMA_INVALID',cause instanceof Error?cause.message:'Evaluation schema is invalid.');}
  const passed=validate(input);
  const errors=(validate.errors??[]).map((item:ErrorObject)=>error('LOOPS_EVALUATION_SCHEMA_FAILED',item.message??'Schema validation failed.',{instancePath:item.instancePath,schemaPath:item.schemaPath,keyword:item.keyword,params:item.params as EvaluationJson}));
  return bounded(result(input,evaluator,passed,errors),limits);
}
parentPort?.on('message',(request:Request)=>{
  try{parentPort?.postMessage({ok:true,result:evaluateRequest(request)});}
  catch(cause){parentPort?.postMessage({ok:false,error:typeof cause==='object'&&cause&&'code' in cause?cause:error('LOOPS_EVALUATION_WORKER_FAILED',cause instanceof Error?cause.message:'Evaluation worker failed.')});}
});
