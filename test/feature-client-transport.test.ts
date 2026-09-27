import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import type {FeatureTransport} from 'openclaw/plugin-sdk/feature-contract';
import {createLoopsClient} from '../src/feature-client.js';
import {textPage} from '../src/feature-json.js';
import {defaultBudgets} from '../src/budgets.js';

const readerId = '11111111-1111-4111-8111-111111111111', documentId = 'a'.repeat(64);
const capabilities = {configured: 'unknown', authorized: 'unknown', available: 'unknown', parameters: [], notes: [], budgets: defaultBudgets, concurrency: 1};
function fixture(value: unknown, failure?: 'page' | 'release' | 'lost-release') {
  const text = JSON.stringify(value), sha256 = createHash('sha256').update(text).digest('hex'), calls: string[] = []; let reserved = true;
  const error = (operation: string) => ({kind: 'loops-error', operation, error: {code: 'LOOPS_STORAGE_FULL', message: 'Loops storage is full.', phase: 'storage', retryable: false, recovery: 'Free space, then inspect before retrying.'}});
  const host = {pluginId: 'loops-poc', signal: new AbortController().signal, connection: {connected: true}, onEvent: () => () => {}, subscribe: () => () => {},
    request: async(_method: string, params: Record<string, unknown>) => {
      const operation = params.actionId as string, input = params.payload as Record<string, unknown>; calls.push(operation);
      if (operation === 'capabilities') return {ok: true, result: {kind: 'loops-document', documentId, readerId, sha256, bytes: Buffer.byteLength(text), read: 'loops_document', description: 'Fixture snapshot'}};
      if (operation === 'document_acquire') { expect(input).toEqual({documentId}); return {ok:true,result:{documentId,readerId}}; }
      if (operation === 'document') {
        expect(input.readerId).toBe(readerId); expect(reserved).toBe(true);
        return {ok: true, result: failure === 'page' && input.offset !== 0 ? error(operation) : {documentId, sha256, ...textPage(text, input.offset as number, 40)}};
      }
      expect(operation).toBe('document_release'); expect(input).toEqual({documentId, readerId});
      if (failure === 'release') return {ok: true, result: error(operation)};
      reserved = false;
      if (failure === 'lost-release') throw Error('Synthetic lost release acknowledgement');
      return {ok: true, result: {released: true}};
    },
  } as FeatureTransport;
  return {client: createLoopsClient(host), calls, reserved: () => reserved,sha256,bytes:Buffer.byteLength(text)};
}
describe('native document reader lifecycle', () => {
  it('releases only after complete pages, integrity and the operation result schema pass', async() => {
    const valid = fixture(capabilities); expect(await valid.client.invoke('capabilities', {})).toEqual(capabilities);
    expect(valid.calls.at(-1)).toBe('document_release'); expect(valid.reserved()).toBe(false);
    const invalid = fixture({validJsonButInvalidCapabilities: true});
    await expect(invalid.client.invoke('capabilities', {})).rejects.toThrow('Operation result does not match');
    expect(invalid.calls).not.toContain('document_release'); expect(invalid.reserved()).toBe(true);
  });
  it('keeps a failed paged retrieval reserved for inspection instead of presenting partial data', async() => {
    const source = fixture(capabilities, 'page');
    await expect(source.client.invoke('capabilities', {})).rejects.toMatchObject({detail: {code: 'LOOPS_STORAGE_FULL'}});
    expect(source.calls).not.toContain('document_release'); expect(source.reserved()).toBe(true);
  });
  it.each(['release', 'lost-release'] as const)('preserves a complete verified result after %s failure without replaying cleanup', async failure => {
    const source = fixture(capabilities, failure); expect(await source.client.invoke('capabilities', {})).toEqual(capabilities);
    expect(source.calls.filter(operation => operation === 'document_release')).toHaveLength(1);
    expect(source.reserved()).toBe(failure === 'release');
  });
  it('reads a retained source with verified paging and releases only after integrity succeeds',async()=>{
    const source=fixture({selected:0,nullable:null,unicode:'🦊'});
    expect(await source.client.readDocument(documentId,source.sha256,source.bytes)).toEqual({selected:0,nullable:null,unicode:'🦊'});
    expect(source.calls[0]).toBe('document_acquire');expect(source.calls.at(-1)).toBe('document_release');
    const mismatch=fixture({selected:0});
    await expect(mismatch.client.readDocument(documentId,'f'.repeat(64),mismatch.bytes)).rejects.toThrow('identity');
    expect(mismatch.calls).not.toContain('document_release');
  });
});

describe('binary artifact capture over the bounded feature transport',()=>{
  it('stages large canonical Base64 JSON in pages and submits only its completed upload reference',async()=>{
    const bytes=Buffer.alloc(70_000);for(let index=0;index<bytes.length;index++)bytes[index]=index%256;
    const data={dataBase64:bytes.toString('base64'),mediaType:'application/octet-stream',name:'binary.bin'};
    const staged=JSON.stringify(data),expectedSha=createHash('sha256').update(staged).digest('hex');
    let text='',uploads=0,submitted=false;
    const host={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>{
      const operation=params.actionId,input=params.payload as Record<string,unknown>;
      if(operation==='upload'){
        uploads++;expect(input.offset).toBe(text.length);expect(String(input.text).length).toBeLessThanOrEqual(16_000);
        text+=input.text as string;
        if(input.complete){expect(input.sha256).toBe(expectedSha);expect(text).toBe(staged);return {ok:true,result:{uploadId:input.uploadId,offset:text.length,completed:true,reference:{$loopsUpload:'b'.repeat(64)}}};}
        return {ok:true,result:{uploadId:input.uploadId,offset:text.length,completed:false}};
      }
      expect(operation).toBe('artifact');expect(input.action).toBe('capture');expect(input.data).toEqual({$loopsUpload:'b'.repeat(64)});submitted=true;
      return {ok:true,result:{kind:'loops-artifact-result',action:'capture',result:{id:'captured'}}};
    }} as FeatureTransport;
    const result=await createLoopsClient(host).invoke('artifact',{action:'capture',operationId:'browser-capture',data});
    expect(result).toMatchObject({result:{id:'captured'}});expect(uploads).toBeGreaterThan(1);expect(submitted).toBe(true);
  });
  it('stages a portable import bundle in the shared public artifact data field',async()=>{
    const bytes=Buffer.alloc(70_000,0x42),sourceId='11111111-1111-4111-8111-111111111111';
    const data={bundle:{format:'loops-artifacts-v1',artifacts:[{sourceId,sha256:createHash('sha256').update(bytes).digest('hex'),mediaType:'application/octet-stream',bytes:bytes.length,sourceRunId:'exported',sourceNodeId:'file',mode:'embedded',dataBase64:bytes.toString('base64')}]}};
    const staged=JSON.stringify(data),expectedSha=createHash('sha256').update(staged).digest('hex');
    let text='',uploads=0,submitted=false;
    const host={pluginId:'loops-poc',signal:new AbortController().signal,connection:{connected:true},onEvent:()=>()=>{},subscribe:()=>()=>{},request:async(_method:string,params:Record<string,unknown>)=>{
      const operation=params.actionId,input=params.payload as Record<string,unknown>;
      if(operation==='upload'){
        uploads++;expect(input.offset).toBe(text.length);text+=input.text as string;
        if(input.complete){expect(input.sha256).toBe(expectedSha);expect(text).toBe(staged);return {ok:true,result:{uploadId:input.uploadId,offset:text.length,completed:true,reference:{$loopsUpload:'b'.repeat(64)}}};}
        return {ok:true,result:{uploadId:input.uploadId,offset:text.length,completed:false}};
      }
      expect(operation).toBe('artifact');expect(input).toMatchObject({action:'import',operationId:'browser-import',data:{$loopsUpload:'b'.repeat(64)}});submitted=true;
      return {ok:true,result:{kind:'loops-artifact-result',action:'import',result:[{id:'imported'}]}};
    }} as FeatureTransport;
    expect(await createLoopsClient(host).invoke('artifact',{action:'import',operationId:'browser-import',data})).toMatchObject({result:[{id:'imported'}]});
    expect(uploads).toBeGreaterThan(1);expect(submitted).toBe(true);
  });
});
