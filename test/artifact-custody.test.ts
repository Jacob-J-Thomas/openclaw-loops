import {afterEach,describe,expect,it} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ArtifactCustody,type ArtifactOwner,type ArtifactBundle} from '../src/artifact-custody.js';

const directories:string[]=[];
const owner:ArtifactOwner={agentId:'agent',sessionKey:'session',sessionId:'generation'};
const foreign:ArtifactOwner={agentId:'other',sessionKey:'session',sessionId:'generation'};
const origin={runId:'run-one',nodeId:'file-output'};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function setup(budget?:ConstructorParameters<typeof ArtifactCustody>[1]){
  const directory=mkdtempSync(join(tmpdir(),'loops-artifact-'));directories.push(directory);
  return {directory,store:new ArtifactCustody(directory,budget)};
}
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});

describe('artifact custody core',()=>{
  it('round trips binary bytes and provenance across restart with bounded byte/metadata pages',()=>{
    const {directory,store}=setup({maxPageBytes:3});
    const bytes=Uint8Array.from([0,255,7,0,128,10,11]);
    const ref=store.put(owner,origin,bytes,'application/octet-stream',30,Date.parse('2026-09-24T00:00:00.000Z'));
    bytes[0]=77;
    expect(ref).toMatchObject({kind:'loops-artifact',sha256:sha(Uint8Array.from([0,255,7,0,128,10,11])),bytes:7,runId:origin.runId,nodeId:origin.nodeId});
    const reopened=new ArtifactCustody(directory,{maxPageBytes:3});
    const first=reopened.readPage(owner,ref.id,0,3,Date.parse('2026-09-25T00:00:00.000Z'));
    const second=reopened.readPage(owner,ref.id,first.nextOffset!,3,Date.parse('2026-09-25T00:00:00.000Z'));
    const third=reopened.readPage(owner,ref.id,second.nextOffset!,3,Date.parse('2026-09-25T00:00:00.000Z'));
    expect([...first.bytes,...second.bytes,...third.bytes]).toEqual([0,255,7,0,128,10,11]);
    expect(third.nextOffset).toBeNull();
    expect(reopened.list(owner,0,1)).toEqual({items:[ref],nextCursor:null,total:1});
    expect(()=>reopened.readPage(foreign,ref.id)).toThrow(/not found/i);
    expect(reopened.list(foreign).total).toBe(0);
    expect(()=>reopened.readPage(owner,ref.id,0,3,Date.parse('2026-10-25T00:00:00.000Z'))).toThrow(/expired/i);
    expect(()=>reopened.export(owner,[{id:ref.id,mode:'embedded'}],Date.parse('2026-10-25T00:00:00.000Z'))).toThrow(/expired/i);
  });

  it('rejects over-limit, quota and malformed input without changing committed files',()=>{
    const {directory,store}=setup({maxArtifactBytes:4,maxTotalBytes:4,maxBundleBytes:4,maxArtifacts:1});
    expect(()=>store.put(owner,origin,Uint8Array.from([1,2,3,4,5]),'application/octet-stream')).toThrow(/limit/i);
    expect(readdirSync(directory).filter(name=>name.startsWith('batch-')||name.startsWith('.staging-'))).toEqual([]);
    const ref=store.put(owner,origin,Uint8Array.from([1,2,3]),'application/octet-stream');
    expect(()=>store.put(owner,origin,Uint8Array.from([4,5]),'application/octet-stream')).toThrow(/quota/i);
    expect(()=>store.put(owner,origin,Uint8Array.from([1]),'bad-mime')).toThrow(/media type/i);
    expect(store.list(owner).items).toEqual([ref]);
    expect(()=>store.readPage(owner,ref.id,0,0)).toThrow(/bounds/i);
  });

  it('shares byte and item capacity across owners without changing existing custody on refusal',()=>{
    for(const budget of [
      {maxArtifactBytes:3,maxTotalBytes:4,maxBundleBytes:3,maxArtifacts:2},
      {maxArtifactBytes:2,maxTotalBytes:4,maxBundleBytes:2,maxArtifacts:1},
    ]){
      const {directory,store}=setup(budget),bytes=Uint8Array.from(budget.maxArtifacts===2?[0,255,7]:[0,255]);
      const ref=store.put(owner,origin,bytes,'application/octet-stream');
      const committed=readdirSync(directory).filter(name=>name.startsWith('batch-'));
      expect(()=>store.put(foreign,origin,Uint8Array.from([3,4]),'application/octet-stream')).toThrow(/quota/i);
      expect(readdirSync(directory).filter(name=>name.startsWith('batch-'))).toEqual(committed);
      const reopened=new ArtifactCustody(directory,budget);
      expect(reopened.list(foreign).total).toBe(0);
      expect(reopened.list(owner).items).toEqual([ref]);
      expect([...reopened.readPage(owner,ref.id).bytes]).toEqual([...bytes]);
    }
  });

  it('rejects corrupt payloads and symlinks without replacing evidence',()=>{
    const {directory,store}=setup();
    const ref=store.put(owner,origin,Uint8Array.from([1,2,3]),'application/octet-stream');
    const batch=readdirSync(directory).find(name=>name.startsWith('batch-'))!;
    const file=join(directory,batch,`artifact-${ref.id}.json`);
    const original=readFileSync(file,'utf8');
    writeFileSync(file,original.replace('AQID','AQIE'));
    expect(()=>store.readPage(owner,ref.id)).toThrow(/validation/i);
    expect(readFileSync(file,'utf8')).toContain('AQIE');
    writeFileSync(file,original);
    const outside=mkdtempSync(join(tmpdir(),'loops-artifact-outside-'));directories.push(outside);
    symlinkSync(outside,join(directory,'batch-00000000-0000-0000-0000-000000000000'));
    expect(()=>store.list(owner)).toThrow(/validation/i);
  });

  it('exports embedded and external dependencies explicitly and imports atomically under a new owner',()=>{
    const source=setup().store,target=setup().store;
    const a=source.put(owner,origin,Uint8Array.from([0,1,255]),'image/png');
    const b=source.put(owner,origin,Uint8Array.from([9,8]),'application/pdf');
    const bundle=source.export(owner,[{id:a.id,mode:'embedded'},{id:b.id,mode:'external'}]);
    expect(bundle.artifacts.map(item=>item.mode)).toEqual(['embedded','external']);
    expect(JSON.stringify(bundle)).not.toContain(owner.sessionKey);
    const rebound={runId:'new-run',nodeId:'import'};
    expect(()=>target.import(foreign,rebound,bundle)).toThrow(/dependency is missing/i);
    expect(target.list(foreign).total).toBe(0);
    expect(()=>target.import(foreign,rebound,bundle,{[b.id]:Uint8Array.from([9,7])})).toThrow(/digest or length/i);
    expect(target.list(foreign).total).toBe(0);
    const refs=target.import(foreign,rebound,bundle,{[b.id]:Uint8Array.from([9,8])});
    expect(refs).toHaveLength(2);
    expect(refs.map(ref=>ref.id)).not.toContain(a.id);
    expect(refs.map(ref=>ref.id)).not.toContain(b.id);
    expect(refs.map(ref=>[ref.runId,ref.nodeId])).toEqual([['new-run','import'],['new-run','import']]);
    expect([...target.readPage(foreign,refs[0].id).bytes]).toEqual([0,1,255]);
    expect(()=>target.readPage(owner,refs[0].id)).toThrow(/not found/i);
    const forged=structuredClone(bundle) as ArtifactBundle;
    if(forged.artifacts[0].mode==='embedded')forged.artifacts[0].dataBase64='AAE=';
    expect(()=>target.import(foreign,rebound,forged,{[b.id]:Uint8Array.from([9,8])})).toThrow(/digest or length/i);
    expect(target.list(foreign).total).toBe(2);
  });

  it('previews retention, protects active references, rejects changed plans and reads back cleanup',()=>{
    const {store}=setup();const at=Date.parse('2026-09-24T00:00:00.000Z');
    const old=store.put(owner,origin,Uint8Array.from([1]),'application/octet-stream',0,at);
    const active=store.put(owner,origin,Uint8Array.from([2]),'application/octet-stream',0,at+1);
    const protectedIds=new Set([active.id]);
    const policy={olderThanDays:0};
    const plan=store.previewCleanup(owner,policy,protectedIds,at+1000);
    expect(plan.candidates.map(item=>item.id)).toEqual([old.id]);
    expect(plan.protected.active).toBe(1);
    expect(()=>store.applyCleanup(owner,policy,new Set(),plan.planId,at+1000)).toThrow(/changed since preview/i);
    expect(store.list(owner).total).toBe(2);
    const receipt=store.applyCleanup(owner,policy,protectedIds,plan.planId,at+1001);
    expect(receipt.removed).toBe(1);
    expect(store.list(owner).items.map(item=>item.id)).toEqual([active.id]);
  });

  it('fails closed on another custody owner or unresolved staging instead of bypassing quota checks',()=>{
    const {directory,store}=setup();
    mkdirSync(join(directory,'.custody-lock'));
    expect(()=>store.put(owner,origin,Uint8Array.from([1]),'application/octet-stream')).toThrow(/unresolved legacy lock/i);
    rmSync(join(directory,'.custody-lock'),{recursive:true});
    mkdirSync(join(directory,'.staging-00000000-0000-0000-0000-000000000000'));
    expect(()=>store.put(owner,origin,Uint8Array.from([1]),'application/octet-stream')).toThrow(/uncertain storage outcome/i);
    expect(readdirSync(directory).filter(name=>name.startsWith('.staging-'))).toEqual(['.staging-00000000-0000-0000-0000-000000000000']);
  });

  it('holds one reentrant custody lease across SQL reserve, file publication and SQL status',()=>{
    const {directory,store}=setup(),competing=new ArtifactCustody(directory),events:string[]=[];
    const ref=store.putCoordinated(owner,origin,Uint8Array.from([0,255]),'application/octet-stream',{
      operationId:'operation_one',
      reserve:refs=>{events.push('reserved');expect(refs).toHaveLength(1);expect(existsSync(join(directory,'.custody-owner.sqlite'))).toBe(true);
        expect(store.list(owner).total).toBe(0);expect(()=>competing.list(owner)).toThrow(/owned by another operation/i);},
      published:refs=>{events.push('published');expect(store.list(owner).items).toEqual([...refs]);expect(existsSync(join(directory,'.custody-owner.sqlite'))).toBe(true);},
    });
    expect(events).toEqual(['reserved','published']);
    expect(store.list(owner).items).toEqual([ref]);
    expect(existsSync(join(directory,'.custody-owner.sqlite'))).toBe(true);
    expect(()=>store.withCoordinationLease(()=>Promise.resolve('unsafe'))).toThrow(/uncertain storage outcome/i);
    expect(competing.list(owner).items).toEqual([ref]);
  });

  it('reserves all imported references before batch publication and preserves ambiguous committed files',()=>{
    const source=setup().store,{store:target}=setup();
    const a=source.put(owner,origin,Uint8Array.from([1]),'application/octet-stream');
    const b=source.put(owner,origin,Uint8Array.from([2]),'application/octet-stream');
    const bundle=source.export(owner,[{id:a.id,mode:'embedded'},{id:b.id,mode:'embedded'}]);
    const events:string[]=[];let reservedIds:string[]=[];
    expect(()=>target.importCoordinated(foreign,{runId:'new-run',nodeId:'import'},bundle,{}, {
      operationId:'operation_import',
      reserve:refs=>{events.push('reserved');reservedIds=refs.map(ref=>ref.id);expect(target.list(foreign).total).toBe(0);},
      published:refs=>{events.push('published');expect(refs.map(ref=>ref.id)).toEqual(reservedIds);expect(target.list(foreign).total).toBe(2);throw Error('SQL status reply lost');},
    })).toThrow(/uncertain storage outcome/i);
    expect(events).toEqual(['reserved','published']);
    expect(target.list(foreign).items.map(ref=>ref.id).sort()).toEqual(reservedIds.sort());
    const empty=setup().store;
    expect(()=>empty.putCoordinated(owner,origin,Uint8Array.from([1]),'application/octet-stream',{
      operationId:'operation_reserve',reserve:()=>{throw Error('SQL reservation uncertain');},published:()=>{throw Error('must not publish');},
    })).toThrow(/uncertain storage outcome/i);
    expect(empty.list(owner).total).toBe(0);
  });

  it('gets a fresh durable GC protection snapshot under the same lease and leaves ambiguous GC for reconciliation',()=>{
    const {store}=setup(),at=Date.parse('2026-09-24T00:00:00.000Z');
    const old=store.put(owner,origin,Uint8Array.from([1]),'application/octet-stream',0,at);
    const active=store.put(owner,origin,Uint8Array.from([2]),'application/octet-stream',0,at+1);
    const plan=store.previewCleanupCoordinated(owner,{olderThanDays:0},()=>new Set([active.id]),at+1000);
    expect(plan.candidates.map(ref=>ref.id)).toEqual([old.id]);
    let began=0,finished=0;
    const receipt=store.applyCleanupCoordinated(owner,{olderThanDays:0},plan.planId,{
      begin:()=>{began++;expect(store.list(owner).total).toBe(2);return new Set([active.id]);},
      finish:value=>{finished++;expect(value.removed).toBe(1);expect(store.list(owner).items.map(ref=>ref.id)).toEqual([active.id]);},
    },at+1001);
    expect(receipt.removed).toBe(1);expect([began,finished]).toEqual([1,1]);
    const second=store.previewCleanupCoordinated(owner,{olderThanDays:0},()=>new Set(),at+1002);
    expect(()=>store.applyCleanupCoordinated(owner,{olderThanDays:0},second.planId,{
      begin:()=>new Set(),finish:()=>{throw Error('SQL GC finalization uncertain');},
    },at+1003)).toThrow(/uncertain storage outcome/i);
    expect(store.list(owner).total).toBe(0);
  });

  it('reads back exact reserved IDs despite unrelated staging and never auto-publishes staged bytes',()=>{
    const {directory,store}=setup();
    const published=store.put(owner,origin,Uint8Array.from([4,5]),'application/octet-stream');
    const stage=join(directory,`.staging-${randomUUID()}`);mkdirSync(stage);
    expect(store.inspectRecovery(owner,[published.id])).toEqual([{id:published.id,status:'published',reference:published}]);
    expect([...store.readPage(owner,published.id).bytes]).toEqual([4,5]);
    expect(store.list(owner).total).toBe(1);
    expect(()=>store.put(owner,origin,Uint8Array.from([6]),'application/octet-stream')).toThrow(/uncertain storage outcome/i);
    const batch=readdirSync(directory).find(name=>name.startsWith('batch-'))!;
    const file=`artifact-${published.id}.json`;
    renameSync(join(directory,batch,file),join(stage,file));
    expect(store.inspectRecovery(owner,[published.id])).toEqual([{id:published.id,status:'staged',reference:published}]);
    expect(store.list(owner).total).toBe(0);
    expect(()=>store.readPage(owner,published.id)).toThrow(/not found/i);
    const absent=randomUUID();
    expect(store.inspectRecovery(owner,[absent])).toEqual([{id:absent,status:'missing'}]);
    writeFileSync(join(stage,`artifact-${absent}.json`),'{partial');
    expect(store.inspectRecovery(owner,[absent])).toEqual([{id:absent,status:'uncertain'}]);
    expect(existsSync(join(stage,file))).toBe(true);
    expect(existsSync(join(stage,`artifact-${absent}.json`))).toBe(true);
  });
});
