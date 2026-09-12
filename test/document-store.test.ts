import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentStore} from '../src/document-store.js';
import {fitsFeatureJson} from '../src/feature-json.js';
import type {Actor} from '../src/engine.js';

const roots:string[]=[];
const actor:Actor={agentId:'main',sessionKey:'agent:main:documents',sessionId:'generation-1',source:'tool',human:false,check:()=>{}};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function setup(maxBytes?:number){const root=mkdtempSync(join(tmpdir(),'loops-documents-'));roots.push(root);return {root,store:new DocumentStore(root,maxBytes)};}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('large feature transport',()=>{
  it('reconstructs an immutable Unicode result after restart and cannot read it from another conversation',()=>{
    const {root,store}=setup();const source={value:'🙂\u0000"\\'.repeat(30000),nested:Array.from({length:5000},(_,index)=>({index}))};
    const reference=store.snapshot(actor,source),reopened=new DocumentStore(root);
    let text='',offset=0;while(true){const page=reopened.read(actor,reference.documentId,offset,100000);expect(fitsFeatureJson(page)).toBe(true);text+=page.text;if(page.nextOffset===null)break;offset=page.nextOffset;}
    expect(JSON.parse(text)).toEqual(source);expect(digest(text)).toBe(reference.sha256);
    for(const other of [{sessionId:'generation-2'},{agentId:'other'},{sessionKey:'other-conversation'}])expect(()=>reopened.read({...actor,...other},reference.documentId)).toThrow('not found');
    const check=vi.fn(()=>{throw Error('revoked');});expect(()=>reopened.read({...actor,check},reference.documentId)).toThrow('revoked');expect(check).toHaveBeenCalledOnce();
  });
  it('stages idempotent chunks, validates the final digest and preserves state after bad writes',()=>{
    const {root,store}=setup();const first='{"value":"🙂',second='done"}',full=first+second;
    const a={uploadId:'request-1',offset:0,text:first};expect(store.upload(actor,a).offset).toBe(Array.from(first).length);
    expect(store.upload(actor,a).offset).toBe(Array.from(first).length);
    expect(()=>store.upload(actor,{...a,text:'changed'})).toThrow('conflict');
    const finish={uploadId:'request-1',offset:Array.from(first).length,text:second,complete:true,sha256:digest(full)};
    expect(()=>store.upload(actor,{...finish,sha256:'0'.repeat(64)})).toThrow('sha256');
    const reopened=new DocumentStore(root),completed=reopened.upload(actor,finish);
    expect(completed.completed).toBe(true);expect(reopened.upload(actor,finish)).toEqual(completed);expect(reopened.resolve(actor,completed.reference!)).toEqual({value:'🙂done'});
    expect(()=>reopened.resolve({...actor,sessionId:'other'},completed.reference!)).toThrow('not found');
  });
  it('rejects a damaged snapshot and checks upload resource limits before committing',()=>{
    const {root,store}=setup(16);expect(()=>store.upload(actor,{uploadId:'too-big',offset:0,text:'x'.repeat(17)})).toThrow('staging budget');
    expect(store.upload(actor,{uploadId:'too-big',offset:0,text:'{}',complete:true,sha256:digest('{}')}).completed).toBe(true);
    const reference=store.snapshot(actor,{saved:true}),path=join(root,`document-${reference.documentId}.json`);
    const record=JSON.parse(readFileSync(path,'utf8'));record.text='{"saved":false}';writeFileSync(path,JSON.stringify(record));
    expect(()=>store.read(actor,reference.documentId)).toThrow('integrity');
  });
});
