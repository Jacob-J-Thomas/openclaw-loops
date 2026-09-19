import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,renameSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DocumentStore} from '../src/document-store.js';
import {fitsFeatureJson} from '../src/feature-json.js';
import type {Actor} from '../src/engine.js';

vi.mock('node:fs',async importOriginal=>{
  const fs=await importOriginal<typeof import('node:fs')>();
  return {...fs,writeFileSync:vi.fn(fs.writeFileSync),renameSync:vi.fn(fs.renameSync),readFileSync:vi.fn(fs.readFileSync)};
});

const roots:string[]=[];
const actor:Actor={agentId:'main',sessionKey:'agent:main:documents',sessionId:'generation-1',source:'tool',human:false,check:()=>{}};
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
function setup(maxBytes?:number){const root=mkdtempSync(join(tmpdir(),'loops-documents-'));roots.push(root);return {root,store:new DocumentStore(root,maxBytes)};}
afterEach(()=>{vi.resetAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});

describe('large feature transport',()=>{
  it('decodes encoded chunks losslessly through empty fragments, mixed retries and restart',()=>{
    const {root,store}=setup(),value={value:'\uFEFF🙂\nquote" and slash\\'},full=JSON.stringify(value),characters=Array.from(full),cut=full.indexOf('\uFEFF');
    const first=characters.slice(0,cut).join(''),last=characters.slice(cut).join(''),encode=(text:string)=>Buffer.from(text).toString('base64');
    expect(store.upload(actor,{uploadId:'encoded',offset:0,textBase64:''})).toMatchObject({offset:0,completed:false});
    const input={uploadId:'encoded',offset:0,textBase64:encode(first)};
    expect(store.upload(actor,input).offset).toBe(cut);
    expect(store.upload(actor,{uploadId:'encoded',offset:0,text:first}).offset).toBe(cut);
    const reopened=new DocumentStore(root);expect(reopened.upload(actor,input).offset).toBe(cut);
    // The second fragment begins with a real BOM inside a JSON string. Decoding
    // must not strip it, replace Unicode, or interpret the fragment as JSON.
    expect(reopened.upload(actor,{uploadId:'encoded',offset:cut,textBase64:encode(last)}).offset).toBe(characters.length);
    const finish={uploadId:'encoded',offset:characters.length,textBase64:'',complete:true,sha256:digest(full)};
    const completed=new DocumentStore(root).upload(actor,finish);expect(completed.completed).toBe(true);
    expect(reopened.upload(actor,finish)).toEqual(completed);expect(reopened.resolve(actor,completed.reference!)).toEqual(value);
    expect(()=>reopened.resolve({...actor,sessionId:'other'},completed.reference!)).toThrow('not found');
  });
  it.each(['e30','e30=\n','e30=extra','e30===','e3-=','Zh==',Buffer.from([0xc3,0x28]).toString('base64')])('rejects invalid encoded chunks without changing staging (%#)',textBase64=>{
    const {root,store}=setup();store.upload(actor,{uploadId:'encoded-invalid',offset:0,text:'{"value":'});
    const before=readdirSync(root).map(name=>[name,readFileSync(join(root,name),'utf8')]);
    expect(()=>store.upload(actor,{uploadId:'encoded-invalid',offset:9,textBase64})).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_UPLOAD_ENCODING'})}));
    expect(readdirSync(root).map(name=>[name,readFileSync(join(root,name),'utf8')])).toEqual(before);
  });
  it('requires exactly one upload representation and checks authority before decoding',()=>{
    const {root,store}=setup();
    for(const fields of [{},{text:'',textBase64:''}])expect(()=>store.upload(actor,{uploadId:'exclusive',offset:0,...fields})).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_UPLOAD_ENCODING'})}));
    expect(()=>store.upload({...actor,check:()=>{throw Error('revoked');}},{uploadId:'exclusive',offset:0,textBase64:'invalid'})).toThrow('revoked');
    expect(readdirSync(root)).toEqual([]);
  });
  it('applies encoded upload limits to decoded data and keeps rejected uploads uncommitted',()=>{
    const {root,store}=setup(2),encode=(text:string)=>Buffer.from(text).toString('base64');
    expect(()=>store.upload(actor,{uploadId:'budget',offset:0,textBase64:encode('🙂')})).toThrow('staging budget');
    expect(readdirSync(root)).toEqual([]);
    expect(store.upload(actor,{uploadId:'budget',offset:0,textBase64:encode('{}'),complete:true,sha256:digest('{}')})).toMatchObject({completed:true,offset:2});
    const large=setup();expect(()=>large.store.upload(actor,{uploadId:'chunk',offset:0,textBase64:encode('x'.repeat(16001))})).toThrow('16,000 Unicode characters');
    expect(readdirSync(large.root)).toEqual([]);
    const boundary=encode('🙂'.repeat(12288));expect(boundary.length).toBe(65536);
    expect(large.store.upload(actor,{uploadId:'boundary',offset:0,textBase64:boundary}).offset).toBe(12288);
    const before=readdirSync(large.root).map(name=>[name,readFileSync(join(large.root,name),'utf8')]);
    expect(()=>large.store.upload(actor,{uploadId:'boundary',offset:12288,textBase64:encode('🙂'.repeat(12289))})).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_UPLOAD_ENCODING'})}));
    expect(readdirSync(large.root).map(name=>[name,readFileSync(join(large.root,name),'utf8')])).toEqual(before);
  });
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
  it('preserves committed staging and removes its partial file after a disk-full write',()=>{
    const {root,store}=setup(),first='{"value":"',last='recovered"}',full=first+last;
    store.upload(actor,{uploadId:'disk-full',offset:0,text:first});
    const before=readdirSync(root).map(name=>[name,readFileSync(join(root,name),'utf8')]);
    const native=Object.assign(new Error('Private volume path and payload'),{code:'ENOSPC'});
    const realWrite=vi.mocked(writeFileSync).getMockImplementation()!;
    vi.mocked(writeFileSync).mockImplementationOnce((file)=>{realWrite(file,'partial uncommitted content');throw native;});
    expect(()=>store.upload(actor,{uploadId:'disk-full',offset:first.length,text:last})).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_STORAGE_FULL',phase:'storage',retryable:false}),cause:native}));
    expect(readdirSync(root).map(name=>[name,readFileSync(join(root,name),'utf8')])).toEqual(before);
    const reopened=new DocumentStore(root),completed=reopened.upload(actor,{uploadId:'disk-full',offset:first.length,text:last,complete:true,sha256:digest(full)});
    expect(reopened.resolve(actor,completed.reference!)).toEqual({value:'recovered'});
  });
  it('recovers a final upload whose snapshot committed but completion marker could not be renamed',()=>{
    const {root,store}=setup(),text='{"value":"saved snapshot"}',input={uploadId:'rename-failure',offset:0,text,complete:true,sha256:digest(text)};
    store.upload(actor,{uploadId:input.uploadId,offset:0,text});
    const before=readdirSync(root).map(name=>[name,readFileSync(join(root,name),'utf8')]);
    const rename=vi.mocked(renameSync).getMockImplementation()!,native=Object.assign(new Error('Private rename target'),{code:'EIO'});
    vi.mocked(renameSync).mockImplementation((from,to)=>{if(String(to).includes('upload-'))throw native;rename(from,to);});
    expect(()=>store.upload(actor,input)).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_STORAGE_IO'}),cause:native}));
    expect(readdirSync(root).filter(name=>name.endsWith('.tmp'))).toEqual([]);
    for(const [name,value] of before)expect(readFileSync(join(root,name),'utf8')).toBe(value);
    expect(readdirSync(root).filter(name=>name.startsWith('document-'))).toHaveLength(1);
    vi.mocked(renameSync).mockReset();
    const reopened=new DocumentStore(root),completed=reopened.upload(actor,input);
    expect(completed.completed).toBe(true);expect(reopened.upload(actor,input)).toEqual(completed);
    expect(reopened.resolve(actor,completed.reference!)).toEqual({value:'saved snapshot'});
  });
  it('distinguishes a storage read failure from an absent or foreign document without exposing the cause',()=>{
    const {store}=setup(),reference=store.snapshot(actor,{value:'committed'});
    for(const code of ['EACCES','EIO']){
      const native=Object.assign(new Error('Private filesystem path'),{code});
      vi.mocked(readFileSync).mockImplementationOnce(()=>{throw native;});
      expect(()=>store.read(actor,reference.documentId)).toThrow(expect.objectContaining({detail:expect.objectContaining({code:code==='EIO'?'LOOPS_STORAGE_IO':'LOOPS_STORAGE_ACCESS',phase:'storage'}),cause:native}));
    }
    for(const [reader,id] of [[actor,'0'.repeat(64)],[{...actor,sessionId:'foreign'},reference.documentId]] as const){
      expect(()=>store.read(reader,id)).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_DOCUMENT_NOT_FOUND',message:'Document not found in this conversation.'})}));
    }
    expect(store.read(actor,reference.documentId).text).toBe('{"value":"committed"}');
  });
  it.each(['{private malformed content',JSON.stringify({text:42,completed:false})])('preserves damaged upload records and reports a safe corruption error (%#)',damaged=>{
    const {root,store}=setup(),input={uploadId:'damaged',offset:0,text:'{}'};store.upload(actor,input);
    const filename=join(root,readdirSync(root)[0]);writeFileSync(filename,damaged);
    expect(()=>store.upload(actor,input)).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_DOCUMENT_CORRUPT',phase:'storage',recovery:expect.stringMatching(/Preserve/)})}));
    expect(readFileSync(filename,'utf8')).toBe(damaged);expect(readdirSync(root)).toHaveLength(1);
  });
  it('does not return or overwrite an existing corrupt snapshot when asked to snapshot the same result again',()=>{
    const {root,store}=setup(),value={saved:true},reference=store.snapshot(actor,value),filename=join(root,`document-${reference.documentId}.json`);
    writeFileSync(filename,'{private damaged content');
    expect(()=>store.snapshot(actor,value)).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_DOCUMENT_CORRUPT'})}));
    expect(readFileSync(filename,'utf8')).toBe('{private damaged content');
  });
  it('returns actionable validation errors without committing invalid final JSON or exposing its content',()=>{
    const {root,store}=setup(),text='private non-JSON input';
    expect(()=>store.upload(actor,{uploadId:'invalid-json',offset:0,text,complete:true,sha256:digest(text)})).toThrow(expect.objectContaining({detail:expect.objectContaining({code:'LOOPS_INVALID_REQUEST',message:'The completed upload must contain one valid JSON value.'})}));
    expect(readdirSync(root)).toEqual([]);
    expect(store.upload(actor,{uploadId:'invalid-json',offset:0,text:'{}',complete:true,sha256:digest('{}')}).completed).toBe(true);
  });
});
