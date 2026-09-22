import {describe,expect,it} from 'vitest';
import {Engine,type Actor,type Run,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {receipt} from '../src/receipts.js';

const base:Run={id:'unicode-run',requestKey:'unicode-request',requestFingerprint:'unicode-fingerprint',owner:{agentId:'main',sessionKey:'agent:main:unicode',sessionId:'unicode-session'},source:'tool',definition:structuredClone(examples[0]),input:{},state:'completed',cursor:'return',outputs:{},trace:[],executions:2,activeMs:0,createdAt:'2026-09-21T00:00:00.000Z',updatedAt:'2026-09-21T00:00:00.000Z'};
const boundary='a'.repeat(999)+'😀';
const payload=boundary+'z'.repeat(4001);

describe('compact run receipts',()=>{
  it('keeps a complete emoji at the large-result preview boundary',()=>{
    const run={...base,result:payload},result=receipt(run);
    expect(result).toMatchObject({resultPreview:boundary,resultTruncated:true});
    expect(run.result).toBe(payload);expect(JSON.parse(JSON.stringify(result)).resultPreview).toBe(boundary);
  });
  it.each(['waiting','review'] as const)('keeps complete Unicode in %s checkpoint previews',state=>{
    const run={...base,state,pending:payload},result=receipt(run);
    expect(result.pending).toBe(boundary);expect(result.pendingTruncated).toBe(true);expect(run.pending).toBe(payload);
  });
  it('does not mark an exactly bounded Unicode checkpoint as truncated',()=>{
    const pending='😀'.repeat(1000);expect(receipt({...base,state:'waiting',pending})).toMatchObject({pending,pendingTruncated:false});
  });
  it('retains an explicitly empty checkpoint, distinct from an absent one',()=>{
    expect(receipt({...base,state:'waiting',pending:''})).toMatchObject({pending:'',pendingTruncated:false});
    expect(receipt(base)).not.toHaveProperty('pending');
  });
  it('preserves the existing ASCII and UTF-8 result thresholds',()=>{
    expect(receipt({...base,result:'a'.repeat(4000)})).toMatchObject({result:'a'.repeat(4000)});
    expect(receipt({...base,result:'a'.repeat(4001)})).toMatchObject({resultPreview:'a'.repeat(1000),resultTruncated:true});
    expect(receipt({...base,result:'😀'.repeat(1000)})).toMatchObject({result:'😀'.repeat(1000)});
    expect(receipt({...base,result:'😀'.repeat(1001)})).toMatchObject({resultPreview:'😀'.repeat(1000),resultTruncated:true});
  });
  it.each([null,false,0,''])('keeps the complete scalar result %j',result=>{expect(receipt({...base,result})).toHaveProperty('result',result);});
  it('leaves complete persisted output and Unicode paging intact after preview generation',async()=>{
    class Memory implements Storage{state:ReturnType<Storage['read']>;read(){return structuredClone(this.state);}write(state:Parameters<Storage['write']>[0]){this.state=structuredClone(state);}}
    const storage=new Memory(),host={check:()=>{},complete:async()=>{throw Error('No inference expected');},modelInfo:async()=>{throw Error('No action expected');}};
    const engine=new Engine(storage,host),actor:Actor={...base.owner,source:'tool',human:false,check:()=>{}};
    const definition={...structuredClone(examples[0]),schemaVersion:2 as const,id:'unicode-results',slug:'unicode-results',revision:0,inputSchema:[],capabilities:[],nodes:[{id:'input',kind:'input' as const,label:'Input'},{id:'return',kind:'return' as const,label:'Return',value:payload}],edges:[{id:'next',source:'input',target:'return',port:'next'}],layout:{},limits:{maxExecutions:10,maxOutputBytes:1048576}};
    engine.save(actor,definition,0,true);const run=await engine.run(actor,definition.slug,{},'unicode-persisted');
    expect(receipt(run)).toHaveProperty('resultPreview',boundary);
    const reopened=new Engine(storage,host);expect(reopened.status(actor,run.id).result).toBe(payload);
    const output=reopened.output(actor,run.id);expect(output.text).toBe(payload);
  });
});
