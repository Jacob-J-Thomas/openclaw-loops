import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {Engine,type Actor} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {fingerprintJson} from '../src/fingerprint.js';
import type {Definition} from '../src/graph.js';

const cleanup:Array<()=>void|Promise<void>>=[];
afterEach(async()=>{for(const item of cleanup.splice(0).reverse())await item();});
const actor:Actor={agentId:'memory-owner',sessionKey:'agent:memory-owner:fixture',sessionId:'session',source:'tool',human:false,check:()=>{}};
const definition:Definition={schemaVersion:3,id:'memory-grant',slug:'memory-grant',name:'Memory grant',description:'',revision:0,
  inputSchema:[{name:'value',label:'Value',type:'json',required:true}],capabilities:[],limits:{maxExecutions:5,maxOutputBytes:4096},layout:{},
  nodes:[{id:'input',kind:'input',label:'Input'},{id:'remember',kind:'memory',label:'Remember',memory:{operation:'write',key:'notes.fact',value:'{{input.value}}'}},{id:'return',kind:'return',label:'Return',value:'{{nodes.remember.version}}'}],
  edges:[{id:'a',source:'input',target:'remember',port:'next'},{id:'b',source:'remember',target:'return',port:'next'}],
  memoryPolicy:{version:1,enabled:true,nodes:{remember:{readPrefixes:[],writeScopes:[{prefix:'notes',schemaId:'fact',schemaVersion:1,retentionDays:30}],forgetPrefixes:[]}}},
  memorySchemas:[{id:'fact',version:1,schema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false}}]};

async function committedRun(){
  const directory=mkdtempSync(join(tmpdir(),'loops-memory-grant-sql-')),file=join(directory,'loops.sqlite');
  cleanup.push(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new SqliteStorage(file);cleanup.push(()=>store.close());
  const engine=new Engine(store,{check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'unused'})});
  expect(engine.save(actor,structuredClone(definition),0,true).issues).toEqual([]);
  const run=await engine.run(actor,definition.slug,{value:{text:'stored'}},'grant-run');
  expect(run.memoryWriteGrant).toEqual({runId:run.id,ownerKey:JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]),loopId:run.definition.id,
    revision:run.definition.revision,grantGeneration:run.grantGeneration,policySha256:fingerprintJson(run.definition.memoryPolicy??null)});
  return {file,store,engine,run};
}

describe('persisted memory writer grant consistency',()=>{
  it('preserves a valid issued grant and rejects changed, removed or mismatched grants at the write barrier',async()=>{
    const {file,store,engine,run}=await committedRun();
    const legacyId=randomUUID(),legacy={...structuredClone(run),id:legacyId,requestKey:fingerprintJson(`legacy:${legacyId}`),
      requestFingerprint:fingerprintJson({legacyId}),memoryWriteGrant:undefined};
    store.writeRun(legacy);
    const before=store.read()!;
    expect(()=>store.writeRun({...run,memoryWriteGrant:{...run.memoryWriteGrant!,ownerKey:'foreign'}})).toThrow(/memory write grant/i);
    expect(()=>store.writeRun({...run,memoryWriteGrant:undefined})).toThrow(/memory write grant.*immutable/i);
    expect(()=>store.writeRun({...run,definition:{...run.definition,memoryPolicy:{...run.definition.memoryPolicy!,enabled:false}}})).toThrow(/memory write grant/i);
    expect(()=>store.writeRun({...legacy,memoryWriteGrant:{...run.memoryWriteGrant!,runId:legacyId}})).toThrow(/memory write grant.*immutable/i);
    expect(store.read()).toEqual(before);
    await engine.close();
    const reopened=new SqliteStorage(file);cleanup.push(()=>reopened.close());
    expect(reopened.readRun(run.id,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))?.memoryWriteGrant).toEqual(run.memoryWriteGrant);
  });

  it.each(['other-run',null])('rejects a changed cold grant (%s) before writable admission or altering the original bytes',async damagedRunId=>{
    const {file,engine,run}=await committedRun();await engine.close();
    const fault=new DatabaseSync(file);
    if(damagedRunId===null)fault.prepare("UPDATE runs SET record=json_set(record,'$.memoryWriteGrant',json('null')) WHERE id=?").run(run.id);
    else fault.prepare("UPDATE runs SET record=json_set(record,'$.memoryWriteGrant.runId',?) WHERE id=?").run(damagedRunId,run.id);
    fault.exec('PRAGMA journal_mode=DELETE');fault.close();
    const bytes=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/memory write grant/i);
    expect(readFileSync(file)).toEqual(bytes);
    await vi.waitFor(()=>{
      const lease=new DatabaseSync(file+'.owner.sqlite');
      try{lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; ROLLBACK;');}
      finally{lease.close();}
    });
  });
});
