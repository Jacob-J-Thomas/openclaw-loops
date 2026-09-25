import {it,expect,vi} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Engine,type Actor} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {MemoryCore} from '../src/memory-core.js';
import {fingerprintJson} from '../src/fingerprint.js';
import type {Definition} from '../src/graph.js';
import {examples} from '../src/examples.js';

it('carries exact pre-custody Memory JSON through a real Engine consume without granting artifact authority',async()=>{
  const root=mkdtempSync(join(tmpdir(),'loops-legacy-artifact-probe-')),file=join(root,'loops.sqlite');
  const actor:Actor={agentId:'main',sessionKey:'agent:main:legacy-artifact',sessionId:'legacy',source:'tool',human:false,check:()=>{}};
  const host={check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'unused'})};
  const definition:Definition={schemaVersion:3,id:'legacy-memory-read',slug:'legacy-memory-read',name:'Legacy memory read',description:'',revision:0,
    inputSchema:[],capabilities:[],limits:{maxExecutions:4,maxOutputBytes:4096},layout:{},
    nodes:[{id:'input',kind:'input',label:'Input'},{id:'remember',kind:'memory',label:'Remember',memory:{operation:'consume',key:'notes.fact'}},{id:'return',kind:'return',label:'Return',value:'{{nodes.remember.value}}'}],
    edges:[{id:'a',source:'input',target:'remember',port:'next'},{id:'b',source:'remember',target:'return',port:'next'}],
    memoryPolicy:{version:1,enabled:true,nodes:{remember:{readPrefixes:['notes'],writeScopes:[],forgetPrefixes:[]}}},
    memorySchemas:[{id:'fact',version:1,schema:{type:'object',properties:{},additionalProperties:true}}]};
  const store=new SqliteStorage(file),engine=new Engine(store,host);
  try{
    expect(engine.save(actor,definition,0,true).issues).toEqual([]);
    const memory=new MemoryCore(store,{check:()=>true});
    const invocation={owner:{agentId:actor.agentId,sessionKey:actor.sessionKey,sessionId:actor.sessionId},loopId:definition.id,loopRevision:1,runId:'v4-writer',nodeId:'writer',grantGeneration:'v4',
      policy:{version:1 as const,enabled:true,nodes:{writer:{readPrefixes:['notes'],writeScopes:[{prefix:'notes',schemaId:'fact',schemaVersion:1,retentionDays:30}],forgetPrefixes:['notes']}}},assertAuthorized:()=>{}};
    memory.write(invocation,'notes.fact',{text:'v4 placeholder'},'v4_mutation',Date.parse('2026-09-24T00:00:00Z'));
  }finally{await engine.close();}
  const legacy=new DatabaseSync(file);
  const marker={kind:'loops-artifact',id:randomUUID(),sha256:'a'.repeat(64),mediaType:'application/octet-stream',bytes:3,ownerScope:'b'.repeat(64),runId:'legacy',nodeId:'upload',createdAt:'2026-09-24T00:00:00.000Z',expiresAt:'2026-10-24T00:00:00.000Z'};
  legacy.exec('DROP TABLE artifact_legacy_run_refs; DROP TABLE artifact_legacy_origins; DROP TABLE artifact_memory_links; DROP TABLE artifact_memory_opaque; DROP TABLE artifact_links; DROP TABLE artifact_items; DROP TABLE artifact_operations; DROP TABLE artifact_gc; DROP TABLE artifact_gc_receipts; DROP TABLE artifact_recovery_receipts; PRAGMA user_version=4; PRAGMA journal_mode=DELETE;');
  const row=JSON.parse((legacy.prepare("SELECT record FROM memory_records WHERE key='notes.fact'").get() as {record:string}).record);
  row.value={artifact:marker};row.valueSha256=fingerprintJson(row.value);
  legacy.prepare("UPDATE memory_records SET value_bytes=?,record=? WHERE key='notes.fact'").run(Buffer.byteLength(JSON.stringify(row.value)),JSON.stringify(row));
  legacy.close();
  const upgraded=new SqliteStorage(file),failures:string[]=[],writeRun=upgraded.writeRun.bind(upgraded);
  upgraded.writeRun=(run)=>{try{return writeRun(run);}catch(error){failures.push(String((error as Error & {cause?:Error}).cause??error));throw error;}};
  const after=new Engine(upgraded,host);let closed=false;
  try{
    const result=await after.run(actor,definition.slug,{},'v5-consume');
    expect(result.state,JSON.stringify({error:result.error,errorDetail:result.errorDetail,trace:result.trace,failures},null,2)).toBe('completed');
    expect(result.result).toEqual({artifact:marker});
    const saved=upgraded.readRun(result.id,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))!;
    for(const changed of [{id:randomUUID()},{ownerScope:'c'.repeat(64)},{sha256:'d'.repeat(64)}]){
      const altered={...saved,result:{artifact:{...marker,...changed}},updatedAt:new Date().toISOString()};
      expect(()=>upgraded.writeRun(altered)).toThrow(/artifact/i);
    }
    expect(()=>upgraded.writeRun({...saved,input:{injected:marker},updatedAt:new Date().toISOString()})).toThrow(/artifact/i);
    const fresh=await after.test(actor,examples[0],{text:'ordinary'},'fresh-output-forgery');
    expect(()=>upgraded.writeRun({...fresh,outputs:{...fresh.outputs,forged:{artifact:marker}},updatedAt:new Date().toISOString()})).toThrow(/artifact/i);
    const forged={...saved,id:randomUUID(),requestKey:'forged-memory-output',requestFingerprint:'f'.repeat(64),requestFingerprintVersion:2 as const,
      trace:saved.trace.filter(item=>item.nodeId!=='remember'),updatedAt:new Date().toISOString()};
    expect(()=>upgraded.writeRun(forged)).toThrow(/artifact/i);
    const search=structuredClone(definition);search.revision=1;
    search.nodes[1]={id:'remember',kind:'memory',label:'Remember',memory:{operation:'search',key:'notes'}};
    search.nodes[2]={id:'return',kind:'return',label:'Return',value:'{{nodes.remember.items}}'};
    expect(after.save(actor,search,1,true).issues).toEqual([]);
    const searched=await after.run(actor,search.slug,{},'v5-search');
    expect(searched.state).toBe('completed');
    expect(searched.result).toMatchObject([{value:{artifact:marker}}]);
    await after.close();closed=true;
    const cold=new SqliteStorage(file);
    try{expect(cold.readRun(result.id,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))?.result).toEqual({artifact:marker});}
    finally{await cold.close();}
    const wrongNode=new DatabaseSync(file);
    wrongNode.prepare("UPDATE artifact_legacy_run_refs SET proof_source='input' WHERE proof_kind='memory' AND run_id=?").run(result.id);
    wrongNode.exec('PRAGMA journal_mode=DELETE');wrongNode.close();
    const wrongNodeBytes=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/legacy Memory authored proof/);
    await vi.waitFor(()=>expect(existsSync(file+'.lock')).toBe(false));
    expect(readFileSync(file)).toEqual(wrongNodeBytes);
    const repaired=new DatabaseSync(file);
    repaired.prepare("UPDATE artifact_legacy_run_refs SET proof_source='remember' WHERE proof_kind='memory' AND run_id=?").run(result.id);
    repaired.close();
    const damaged=new DatabaseSync(file);
    damaged.prepare("UPDATE artifact_legacy_origins SET ref_hash=? WHERE source_kind='v4-memory'").run('f'.repeat(64));
    damaged.exec('PRAGMA journal_mode=DELETE');damaged.close();
    const before=readFileSync(file);
    expect(()=>new SqliteStorage(file)).toThrow(/legacy opaque origin identity/);
    await vi.waitFor(()=>expect(existsSync(file+'.lock')).toBe(false));
    expect(readFileSync(file)).toEqual(before);
  }finally{if(!closed)await after.close();rmSync(root,{recursive:true,force:true});}
});

it('keeps pre-custody Run output usable through a checkpoint and retry',async()=>{
  const root=mkdtempSync(join(tmpdir(),'loops-legacy-run-probe-')),file=join(root,'loops.sqlite');
  const actor:Actor={agentId:'main',sessionKey:'agent:main:legacy-run',sessionId:'legacy-run',source:'tool',human:false,check:()=>{}};
  const host={check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'fixture'})};
  const store=new SqliteStorage(file),engine=new Engine(store,host);
  let runId:string;
  try{runId=(await engine.test(actor,examples[0],{text:'old'},'legacy-run')).id;}finally{await engine.close();}
  const marker={kind:'loops-artifact',id:randomUUID(),sha256:'a'.repeat(64),mediaType:'application/octet-stream',bytes:3,ownerScope:'b'.repeat(64),runId:'legacy',nodeId:'upload',createdAt:'2026-09-24T00:00:00.000Z',expiresAt:'2026-10-24T00:00:00.000Z'};
  const legacy=new DatabaseSync(file);
  legacy.exec('DROP TABLE artifact_legacy_run_refs; DROP TABLE artifact_legacy_origins; DROP TABLE artifact_memory_links; DROP TABLE artifact_memory_opaque; DROP TABLE artifact_links; DROP TABLE artifact_items; DROP TABLE artifact_operations; DROP TABLE artifact_gc; DROP TABLE artifact_gc_receipts; DROP TABLE artifact_recovery_receipts; PRAGMA user_version=4; PRAGMA journal_mode=DELETE;');
  const row=JSON.parse((legacy.prepare('SELECT record FROM runs WHERE id=?').get(runId) as {record:string}).record);
  row.outputs.legacy_value={artifact:marker};
  legacy.prepare('UPDATE runs SET record=? WHERE id=?').run(JSON.stringify(row),runId);
  legacy.prepare('INSERT INTO outputs(run_id,node_id,value) VALUES (?,?,?)').run(runId,'legacy_value',JSON.stringify({artifact:marker}));
  legacy.close();
  const upgraded=new SqliteStorage(file);
  try{
    expect(upgraded.readRun(runId,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))?.outputs.legacy_value).toEqual({artifact:marker});
    const saved=upgraded.readRun(runId,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))!;
    expect(()=>upgraded.writeRun({...saved,updatedAt:new Date().toISOString()})).not.toThrow();
    upgraded.writeRun({...saved,state:'failed',error:'Legacy execution failed.',updatedAt:new Date().toISOString()});
    const after=new Engine(upgraded,host);
    const retried=await after.retry(actor,runId,'retry-node','retry-legacy-run');
    expect(retried.parentRunId).toBe(runId);
    expect(retried.outputs.legacy_value).toEqual({artifact:marker});
  }finally{await upgraded.close();rmSync(root,{recursive:true,force:true});}
});

it('keeps pre-custody Run input opaque through restart retry while fresh input remains strict',async()=>{
  const root=mkdtempSync(join(tmpdir(),'loops-legacy-input-probe-')),file=join(root,'loops.sqlite');
  const actor:Actor={agentId:'main',sessionKey:'agent:main:legacy-input',sessionId:'legacy-input',source:'tool',human:false,check:()=>{}};
  const host={check:()=>{},modelInfo:async()=>({}),complete:async()=>({text:'unused'})};
  const definition:Definition={schemaVersion:3,id:'legacy-input',slug:'legacy-input',name:'Legacy input',description:'',revision:0,
    inputSchema:[{name:'value',label:'Value',type:'json',required:true}],capabilities:[],limits:{maxExecutions:3,maxOutputBytes:4096},layout:{},
    nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'{{input.value}}'}],
    edges:[{id:'a',source:'input',target:'return',port:'next'}]};
  const store=new SqliteStorage(file),engine=new Engine(store,host);
  let runId:string;
  try{runId=(await engine.test(actor,definition,{value:{text:'plain'}},'legacy-input-run')).id;}finally{await engine.close();}
  const marker={kind:'loops-artifact',id:randomUUID(),sha256:'a'.repeat(64),mediaType:'application/octet-stream',bytes:3,ownerScope:'b'.repeat(64),runId:'legacy',nodeId:'upload',createdAt:'2026-09-24T00:00:00.000Z',expiresAt:'2026-10-24T00:00:00.000Z'};
  const legacy=new DatabaseSync(file);
  legacy.exec('DROP TABLE artifact_legacy_run_refs; DROP TABLE artifact_legacy_origins; DROP TABLE artifact_memory_links; DROP TABLE artifact_memory_opaque; DROP TABLE artifact_links; DROP TABLE artifact_items; DROP TABLE artifact_operations; DROP TABLE artifact_gc; DROP TABLE artifact_gc_receipts; DROP TABLE artifact_recovery_receipts; PRAGMA user_version=4; PRAGMA journal_mode=DELETE;');
  const row=JSON.parse((legacy.prepare('SELECT record FROM runs WHERE id=?').get(runId) as {record:string}).record);
  row.input.value={artifact:marker};row.state='failed';row.error='Legacy failure.';
  legacy.prepare('UPDATE runs SET state=?,record=? WHERE id=?').run(row.state,JSON.stringify(row),runId);
  legacy.close();
  const upgraded=new SqliteStorage(file);
  try{
    const saved=upgraded.readRun(runId,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))!;
    expect(()=>upgraded.writeRun({...saved,updatedAt:new Date().toISOString()})).not.toThrow();
    const after=new Engine(upgraded,host);
    const retried=await after.retry(actor,runId,'restart','retry-legacy-input');
    expect(retried.state).toBe('completed');expect(retried.input.value).toEqual({artifact:marker});
    expect(retried.result).toEqual({artifact:marker});
    await expect(after.test(actor,definition,{value:{artifact:marker}},'fresh-forgery')).rejects.toThrow(/artifact/i);
    const first=after.retention(actor,{keepLatest:0});
    expect(first.candidates.map(item=>item.id)).not.toContain(runId);
    expect(first.protected.ancestry).toBeGreaterThan(0);
    after.retention(actor,first.policy,first.planId);
    const second=after.retention(actor,{keepLatest:0});
    expect(second.candidates.map(item=>item.id)).toContain(runId);
    after.retention(actor,second.policy,second.planId);
    await after.close();
    const cold=new SqliteStorage(file);
    try{expect(cold.integrity()).toEqual([{integrity_check:'ok'}]);}
    finally{await cold.close();}
  }finally{await upgraded.close();rmSync(root,{recursive:true,force:true});}
});
