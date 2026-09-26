import {afterEach,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Engine,type Actor,type HostCapabilities} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {parseDefinition,validateGraph,type Definition} from '../src/graph.js';
import type {ArtifactReference} from '../src/artifact-custody.js';

const roots:string[]=[],engines:Engine[]=[];
afterEach(async()=>{for(const engine of engines.splice(0).reverse())await engine.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const actor:Actor={agentId:'main',sessionKey:'agent:main:artifact',sessionId:'artifact-session',source:'tool',human:false,check:()=>{}};
const host:HostCapabilities={check:()=>{},complete:async()=>({text:'unused'}),modelInfo:async()=>({})};
function setup(){const root=mkdtempSync(join(tmpdir(),'loops-artifact-integration-'));roots.push(root);const file=join(root,'loops.sqlite');const engine=new Engine(new SqliteStorage(file),host,{artifactDirectory:join(root,'artifacts')});engines.push(engine);return {root,file,engine};}
function definition(mode:'capture'|'import'='capture',park=false):Definition{
  const artifact=mode==='capture'?{operation:'capture' as const,value:'{{input.file}}',retentionDays:30}:{operation:'import' as const,bundle:'{{input.bundle}}',retentionDays:30};
  const nodes:Definition['nodes']=[{id:'input',kind:'input',label:'Input'},{id:'file',kind:'artifact',label:'File',artifact},...park?[{id:'wait',kind:'wait',label:'Wait',message:'hold'} as const]:[],{id:'return',kind:'return',label:'Return',value:mode==='capture'?'{{nodes.file.reference}}':'{{nodes.file.references}}'}];
  const edges:Definition['edges']=[{id:'a',source:'input',target:'file',port:'next'},{id:'b',source:'file',target:park?'wait':'return',port:'next'},...park?[{id:'c',source:'wait',target:'return',port:'next'}]:[]];
  return {schemaVersion:3,id:'artifact-loop',slug:'artifact-loop',name:'Artifact loop',description:'',revision:0,inputSchema:[mode==='capture'?{name:'file',label:'File',type:'artifact',required:true}:{name:'bundle',label:'Bundle',type:'json',required:true}],nodes,edges,layout:{},capabilities:[],limits:{maxExecutions:8,maxOutputBytes:4096}};
}
function capture(engine:Engine,bytes:Uint8Array,operationId:string=randomUUID()){
  return engine.artifact(actor,{action:'capture',operationId,data:{dataBase64:Buffer.from(bytes).toString('base64'),mediaType:'application/octet-stream'}}).result as ArtifactReference;
}
function page(engine:Engine,ref:ArtifactReference,offset:number,limit=2){return engine.artifact(actor,{action:'page',artifactId:ref.id,offset,limit}).result as {reference:ArtifactReference;offset:number;dataBase64:string;nextOffset:number|null};}

describe('authored artifact graph and public custody operations',()=>{
  it.each([2,3] as const)('preserves version-%i ordinary JSON markers while retaining exact published children',async schemaVersion=>{
    const {root,file,engine}=setup();
    const ordinary:Definition={schemaVersion,id:`ordinary-json-${schemaVersion}`,slug:`ordinary-json-${schemaVersion}`,name:'Ordinary JSON',description:'',revision:0,
      inputSchema:[{name:'value',label:'Value',type:'json',required:true}],nodes:[{id:'input',kind:'input',label:'Input'},
        {id:'return',kind:'return',label:'Return',value:'{{input.value}}'}],edges:[{id:'a',source:'input',target:'return',port:'next'}],
      layout:{},capabilities:[],limits:{maxExecutions:4,maxOutputBytes:4096}};
    expect(engine.save(actor,ordinary,0,true).issues).toEqual([]);
    const marker={kind:'loops-artifact',id:randomUUID(),sha256:'a'.repeat(64),mediaType:'application/octet-stream',bytes:3,
      ownerScope:'b'.repeat(64),runId:'business-order',nodeId:'invoice',createdAt:'2026-09-24T00:00:00.000Z',expiresAt:'2026-10-24T00:00:00.000Z'};
    const inert={kind:'loops-artifact',label:'ordinary business record',detail:marker};
    const plain=await engine.run(actor,ordinary.slug,{value:inert},`ordinary-${schemaVersion}`);
    expect(plain).toMatchObject({state:'completed',result:inert});
    if(schemaVersion===2){
      let boundary:unknown='leaf';for(let depth=0;depth<100;depth++)boundary={next:boundary};
      expect(await engine.run(actor,ordinary.slug,{value:boundary},'json-depth-100')).toMatchObject({state:'completed',result:boundary});
      await expect(engine.run(actor,ordinary.slug,{value:{next:boundary}},'json-depth-101')).rejects.toThrow(/valid JSON/);
    }
    const noLinks=new DatabaseSync(file,{readOnly:true});
    try{expect(noLinks.prepare('SELECT count(*) AS n FROM artifact_links WHERE run_id=?').get(plain.id)).toEqual({n:0});}
    finally{noLinks.close();}
    expect(()=>engine.artifact(actor,{action:'page',artifactId:marker.id,offset:0,limit:1})).toThrow();
    const literal:Definition={...ordinary,id:`ordinary-literal-${schemaVersion}`,slug:`ordinary-literal-${schemaVersion}`,
      nodes:[ordinary.nodes[0],{id:'return',kind:'return',label:'Return',value:{literalJson:JSON.stringify(inert)}}]};
    expect(engine.save(actor,literal,0,true).issues).toEqual([]);
    expect(await engine.run(actor,literal.slug,{value:null},`literal-${schemaVersion}`)).toMatchObject({state:'completed',result:inert});

    const ref=capture(engine,Uint8Array.of(0,255,7));
    const carried={...inert,payload:{reference:ref}};
    const run=await engine.run(actor,ordinary.slug,{value:carried},`carried-${schemaVersion}`);
    expect(run).toMatchObject({state:'completed',result:carried});
    const links=new DatabaseSync(file,{readOnly:true});
    try{
      expect(links.prepare('SELECT count(*) AS n FROM artifact_links WHERE run_id=? AND artifact_id=? AND active=1').get(run.id,ref.id)).toEqual({n:schemaVersion===3?4:3});
      expect(links.prepare('SELECT count(*) AS n FROM artifact_links WHERE run_id=? AND artifact_id=?').get(run.id,marker.id)).toEqual({n:0});
    }finally{links.close();}
    // Completed runs retain exact links for inspection; retention policy may
    // later clean up their bytes. Parked runs are protected separately below.
    await engine.close();engines.splice(engines.indexOf(engine),1);
    const reopened=new Engine(new SqliteStorage(file),host,{artifactDirectory:join(root,'artifacts')});engines.push(reopened);
    expect(reopened.status(actor,run.id).result).toEqual(carried);
    expect(Buffer.from(page(reopened,ref,0,3).dataBase64,'base64')).toEqual(Buffer.from([0,255,7]));
  });
  it('captures a browser-shaped binary file, binds its typed reference, and reads the exact bytes after restart',async()=>{
    const {root,file,engine}=setup(),bytes=Uint8Array.from([0,255,1,0,128,42,0]);
    const authored=definition();expect(parseDefinition(authored)).toEqual(authored);expect(validateGraph(authored)).toEqual([]);
    engine.save(actor,authored,0,true);
    const ref=capture(engine,bytes),retry=capture(engine,bytes,ref.runId.slice('capture-'.length));
    expect(retry).toEqual(ref);
    const run=await engine.run(actor,'artifact-loop',{file:ref},'file-run');
    expect(run).toMatchObject({state:'completed',result:ref});
    expect(run.outputs.file).toEqual({reference:ref});
    await engine.close();engines.splice(engines.indexOf(engine),1);
    const guarded=new SqliteStorage(file);
    try{
      const saved=guarded.readRun(run.id,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))!;
      const changed={...ref,sha256:'0'.repeat(64)};
      expect(()=>guarded.writeRun({...saved,input:{file:changed}})).toThrow(/artifact/i);
      expect(()=>guarded.writeRun({...saved,outputs:{...saved.outputs,file:{reference:changed}}})).toThrow(/artifact/i);
      expect(guarded.readRun(run.id,JSON.stringify([actor.agentId,actor.sessionKey,actor.sessionId]))?.outputs.file).toEqual({reference:ref});
    }finally{await guarded.close();}
    const reopened=new Engine(new SqliteStorage(file),host,{artifactDirectory:join(root,'artifacts')});engines.push(reopened);
    expect(reopened.status(actor,run.id).result).toEqual(ref);
    const chunks:Buffer[]=[];let next:number|null=0;while(next!==null){const part=page(reopened,ref,next);chunks.push(Buffer.from(part.dataBase64,'base64'));next=part.nextOffset;}
    const observed=Buffer.concat(chunks);
    expect([...observed]).toEqual([...bytes]);expect(createHash('sha256').update(observed).digest('hex')).toBe(ref.sha256);
    expect(reopened.artifact(actor,{action:'list'}).result).toMatchObject({items:[{reference:ref,status:'published'}]});
    expect(reopened.artifact(actor,{action:'export',selections:[{id:ref.id,mode:'embedded'}]}).result).toMatchObject({format:'loops-artifacts-v1',artifacts:[{sha256:ref.sha256,bytes:bytes.length,dataBase64:Buffer.from(bytes).toString('base64')}]});
  });
  it('rejects foreign and changed references before admission, and preserves a parked reference during cleanup',async()=>{
    const {engine}=setup(),bytes=Uint8Array.from([0,255,3]);engine.save(actor,definition('capture',true),0,true);
    const ref=capture(engine,bytes);
    expect(()=>engine.artifact({...actor,sessionId:'foreign'},{action:'page',artifactId:ref.id})).toThrow();
    await expect(engine.run(actor,'artifact-loop',{file:{...ref,sha256:'0'.repeat(64)}},'bad-ref')).rejects.toThrow();
    const parked=await engine.run(actor,'artifact-loop',{file:ref},'park-file');expect(parked.state).toBe('waiting');
    const preview=engine.artifact(actor,{action:'cleanup-preview',policy:{olderThanDays:0}}).result as {planId:string;candidates:ArtifactReference[]};
    expect(preview.candidates.some(item=>item.id===ref.id)).toBe(false);
    expect(engine.artifact(actor,{action:'cleanup-apply',policy:{olderThanDays:0},planId:preview.planId}).result).toMatchObject({removed:0});
    expect(Buffer.from(page(engine,ref,0,3).dataBase64,'base64')).toEqual(Buffer.from(bytes));
  });
  it('releases a standalone unlinked capture for cleanup and refuses reuse, while preserving linked files',async()=>{
    const {engine}=setup(),bytes=Uint8Array.from([0,255,31,0]);
    const operationId=randomUUID(),unused=capture(engine,bytes,operationId);
    const released=engine.artifact(actor,{action:'release-unused',artifactId:unused.id,operationId}).result;
    expect(released).toMatchObject({status:'released',id:unused.id,operationId});
    expect(engine.artifact(actor,{action:'release-unused',artifactId:unused.id,operationId}).result).toEqual(released);
    expect(engine.artifact(actor,{action:'metadata',artifactId:unused.id}).result).toMatchObject({reference:unused,status:'released'});
    expect(engine.artifact(actor,{action:'list'}).result).toMatchObject({items:[{reference:unused,status:'released'}]});
    expect(()=>engine.artifact(actor,{action:'page',artifactId:unused.id})).toThrow();
    expect(()=>capture(engine,bytes,operationId)).toThrow();
    engine.save(actor,definition(),0,true);
    await expect(engine.run(actor,'artifact-loop',{file:unused},'released-file')).rejects.toThrow();
    const preview=engine.artifact(actor,{action:'cleanup-preview',policy:{olderThanDays:0}}).result as {planId:string;candidates:ArtifactReference[]};
    expect(preview.candidates.map(ref=>ref.id)).toContain(unused.id);
    expect(engine.artifact(actor,{action:'cleanup-apply',policy:{olderThanDays:0},planId:preview.planId}).result).toMatchObject({removed:1});
    expect(()=>engine.artifact(actor,{action:'metadata',artifactId:unused.id})).toThrow();
    expect(engine.artifact(actor,{action:'release-unused',artifactId:unused.id,operationId}).result).toMatchObject({status:'retired',releasedAt:(released as {releasedAt:string}).releasedAt});
    const linkedId=randomUUID(),linked=capture(engine,bytes,linkedId);
    expect((await engine.run(actor,'artifact-loop',{file:linked},'linked-file')).state).toBe('completed');
    expect(()=>engine.artifact(actor,{action:'release-unused',artifactId:linked.id,operationId:linkedId})).toThrow();
    expect(Buffer.from(page(engine,linked,0,4).dataBase64,'base64')).toEqual(Buffer.from(bytes));
  });
  it('validates every embedded import dependency before publication and returns new typed references',async()=>{
    const {engine}=setup(),bytes=Uint8Array.from([4,0,255,9]);const original=capture(engine,bytes);
    const bundle=engine.artifact(actor,{action:'export',selections:[{id:original.id,mode:'embedded'}]}).result;
    const authored=definition('import');engine.save(actor,authored,0,true);
    const imported=await engine.run(actor,'artifact-loop',{bundle},'import-file');
    expect(imported).toMatchObject({state:'completed'});
    const copied=(imported.result as ArtifactReference[])[0];expect(copied).toMatchObject({sha256:original.sha256,bytes:bytes.length,runId:imported.id,nodeId:'file'});expect(copied.id).not.toBe(original.id);
    const missing=structuredClone(bundle) as {artifacts:Array<{mode:string;dataBase64?:string}>};missing.artifacts[0].mode='external';delete missing.artifacts[0].dataBase64;
    const before=engine.artifact(actor,{action:'list'}).result;
    const rejected=await engine.run(actor,'artifact-loop',{bundle:missing},'missing-external');
    expect(rejected).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_ARTIFACT_DEPENDENCY_MISSING'}});
    expect(engine.artifact(actor,{action:'list'}).result).toEqual(before);
  });
});
