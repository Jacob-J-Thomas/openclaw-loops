import {afterAll,describe,expect,it} from 'vitest';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {parseEvaluationDraft} from '../src/evaluation-editor.js';

const directory=mkdtempSync(join(tmpdir(),'loops-evaluation-'));
await build({entryPoints:['src/evaluation.ts','src/evaluation-worker.ts'],outdir:directory,bundle:true,platform:'node',format:'esm',target:'node24'});
const runtime=await import(pathToFileURL(join(directory,'evaluation.js')).href);
const workerUrl=pathToFileURL(join(directory,'evaluation-worker.js'));
const hangingWorkerUrl=pathToFileURL(new URL('./helpers/evaluation-hang-worker.mjs',import.meta.url).pathname);
const exitingWorkerUrl=pathToFileURL(new URL('./helpers/evaluation-exit-worker.mjs',import.meta.url).pathname);
afterAll(()=>rmSync(directory,{recursive:true,force:true}));

describe('deterministic evaluation worker',()=>{
  const schema={kind:'json-schema-2020' as const,version:'2020-12',schema:{type:'object',required:['count'],properties:{count:{type:'number',minimum:0}},additionalProperties:false}};
  it('returns canonical durable evidence for valid, invalid, zero and null input',async()=>{
    const zero=await runtime.evaluate({count:0},schema,{workerUrl});
    const invalid=await runtime.evaluate({count:-1},schema,{workerUrl});
    const missing=await runtime.evaluate({},schema,{workerUrl});
    const reordered=await runtime.evaluate({count:0},schema,{workerUrl});
    expect(zero).toMatchObject({passed:true,evaluatorVersion:'2020-12'});expect(zero.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);expect(reordered.evidenceDigest).toBe(zero.evidenceDigest);
    expect(runtime.evaluationDigest({a:0,b:null})).toBe(runtime.evaluationDigest({b:null,a:0}));
    expect(invalid).toMatchObject({passed:false,errors:[{code:'LOOPS_EVALUATION_SCHEMA_FAILED',instancePath:'/count'}]});
    expect(missing.errors[0]).toMatchObject({keyword:'required'});
    await expect(runtime.evaluate(null,{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl})).resolves.toMatchObject({passed:false});
    await expect(runtime.evaluate({'a/b':0},{kind:'json-schema-2020',version:'2020-12',schema:{type:'object',properties:{'a/b':{type:'string'}}}},{workerUrl})).resolves.toMatchObject({passed:false,errors:[{instancePath:'/a~1b'}]});
  });
  it('distinguishes invalid schemas from failed evaluations and rejects remote refs and bounded input/output',async()=>{
    await expect(runtime.evaluate('x',{kind:'json-schema-2020',version:'2020-12',schema:{$ref:'https://example.test/schema'}},{workerUrl})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_REMOTE_REF'}});
    for(const key of ['$dynamicRef','$recursiveRef'])for(const target of ['#local','https://example.test/schema'])await expect(runtime.evaluate('x',{kind:'json-schema-2020',version:'2020-12',schema:{[key]:target}},{workerUrl})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_REMOTE_REF'}});
    await expect(runtime.evaluate('x',{kind:'json-schema-2020',version:'2020-12',schema:{type:'not-a-real-type'}},{workerUrl})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_SCHEMA_INVALID'}});
    await expect(runtime.evaluate('abc',{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl,limits:{maxInputBytes:2}})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_RESOURCE_LIMIT'}});
    await expect(runtime.evaluate('x',{kind:'json-schema-2020',version:'2020-12',schema:{type:'string'}},{workerUrl,limits:{maxSchemaBytes:2}})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_RESOURCE_LIMIT'}});
    await expect(runtime.evaluate('x',{kind:'predicate',version:'v'.repeat(64),predicate:{op:'equals',expected:'x'.repeat(64)}},{workerUrl,limits:{maxSchemaBytes:32}})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_RESOURCE_LIMIT'}});
    await expect(runtime.evaluate({a:0,b:0},{kind:'json-schema-2020',version:'2020-12',schema:{type:'object',properties:{a:{type:'string'},b:{type:'string'}}}},{workerUrl,limits:{maxErrors:1}})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_RESOURCE_LIMIT'}});
    await expect(runtime.evaluate('x',{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl,limits:{maxResultBytes:2}})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_RESOURCE_LIMIT'}});
    let deep:unknown=null;for(let index=0;index<102;index++)deep=[deep];await expect(runtime.evaluate(deep,{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_RESOURCE_LIMIT'}});
  });
  it('terminates a controlled hanging worker on timeout and cancellation before or during work',async()=>{
    await pause(40);
    const before=process.getActiveResourcesInfo().filter(value=>value==='MessagePort').length;
    await expect(runtime.evaluate('x',{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl:hangingWorkerUrl,limits:{timeoutMs:30}})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_TIMEOUT'}});
    await pause(40);expect(process.getActiveResourcesInfo().filter(value=>value==='MessagePort').length).toBe(before);
    const controller=new AbortController();controller.abort();await expect(runtime.evaluate('x',{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl:new URL('file:///definitely-not-created.js'),signal:controller.signal})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_CANCELLED'}});
    const during=new AbortController(),pending=runtime.evaluate('x',{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl:hangingWorkerUrl,signal:during.signal});setTimeout(()=>during.abort(),20);await expect(pending).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_CANCELLED'}});
    await pause(40);expect(process.getActiveResourcesInfo().filter(value=>value==='MessagePort').length).toBe(before);
  });
  it('reports a worker exit without waiting for its full timeout',async()=>{
    const started=Date.now();await expect(runtime.evaluate('x',{kind:'predicate',version:'p1',predicate:{op:'truthy'}},{workerUrl:exitingWorkerUrl,limits:{timeoutMs:1000}})).rejects.toMatchObject({detail:{code:'LOOPS_EVALUATION_WORKER_EXITED'}});expect(Date.now()-started).toBeLessThan(500);
  });
  it('keeps editor configuration typed and rejects invalid JSON before graph integration',()=>{
    expect(parseEvaluationDraft({kind:'predicate',version:'p1',schemaSource:'{}',predicateOp:'equals',expectedSource:'0'}).evaluator).toMatchObject({kind:'predicate',predicate:{expected:0}});
    expect(parseEvaluationDraft({kind:'json-schema-2020',version:'',schemaSource:'{}',predicateOp:'truthy',expectedSource:'null'})).toMatchObject({error:'Evaluator version is required.'});
    expect(parseEvaluationDraft({kind:'json-schema-2020',version:'v',schemaSource:'{',predicateOp:'truthy',expectedSource:'null'}).error).toMatch(/valid JSON/);
  });
});
