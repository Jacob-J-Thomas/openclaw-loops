import {describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {commandReply,commandPage,commandReplyLimit,formatCommandResult} from '../src/commands.js';
import {textPage} from '../src/feature-json.js';
import type {DocumentReference} from '../src/wire-contract.js';

const reference:DocumentReference={kind:'loops-document',documentId:'a'.repeat(64),sha256:'b'.repeat(64),bytes:1,read:'loops_document',description:'Immutable result'};
describe('conversation reply envelope',()=>{
  it('measures the complete formatted reply, preserves the boundary and snapshots once above it',async()=>{
    const snapshot=vi.fn(async()=>reference);
    for(const size of [7999,8000])expect(await commandReply('x'.repeat(size),snapshot)).toBe('x'.repeat(size));
    expect(snapshot).not.toHaveBeenCalled();
    const value={text:'\u0000'.repeat(1400)};expect(JSON.stringify(value).length).toBeGreaterThan(commandReplyLimit);
    const reply=await commandReply(value,snapshot);expect(snapshot).toHaveBeenCalledExactlyOnceWith(value);
    expect(reply).toContain(reference.documentId);expect(reply).toContain('/loops document');expect(reply.length).toBeLessThanOrEqual(commandReplyLimit);
  });
  it('preserves structured failures and reports snapshot failure rather than returning an oversized success',async()=>{
    const failure={kind:'loops-error',operation:'test',error:{code:'LOOPS_INVALID_REQUEST',message:'m'.repeat(4000),phase:'operation',retryable:false,recovery:'r'.repeat(4000)}};
    const snapshot=vi.fn(async()=>reference);expect((await commandReply(failure,snapshot)).length).toBeLessThanOrEqual(commandReplyLimit);expect(snapshot).toHaveBeenCalledWith(failure);
    await expect(commandReply('x'.repeat(8001),async()=>{throw Error('Snapshot failed');})).rejects.toThrow('Snapshot failed');
  });
  it.each(['x','🙂','\u0000','"\\\r\n','e\u0301','\ud800'])('reconstructs exact text with escaped-envelope sizing and stable code-point offsets (%#)',sample=>{
    const text=sample.repeat(17000),sha256=createHash('sha256').update(text).digest('hex');let offset=0,full='';
    while(true){
      const original={documentId:reference.documentId,sha256,...textPage(text,offset,16000)},page=commandPage(original),formatted=formatCommandResult(page);
      expect(formatted.length).toBeLessThanOrEqual(commandReplyLimit);expect(JSON.parse(formatted)).toEqual(page);
      expect(page.offset).toBe(offset);expect(page.totalCharacters).toBe(Array.from(text).length);expect(page.documentId).toBe(reference.documentId);expect(page.sha256).toBe(sha256);
      const count=Array.from(page.text).length;expect(page.text).toBe(Array.from(text).slice(offset,offset+count).join(''));full+=page.text;
      if(page.nextOffset===null)break;
      expect(page.nextOffset).toBe(offset+count);expect(page.nextOffset).toBeGreaterThan(offset);
      if(count<Array.from(original.text).length){const longer={...page,text:page.text+Array.from(original.text)[count],nextOffset:page.nextOffset+1};expect(formatCommandResult(longer).length).toBeGreaterThan(commandReplyLimit);}
      offset=page.nextOffset;
    }
    expect(full).toBe(text);expect(createHash('sha256').update(full).digest('hex')).toBe(sha256);
  });
  it('keeps small, empty, final and beyond-end pages and explicit small limits unchanged',()=>{
    for(const offset of [0,1,3,20])for(const limit of [1,2,16000]){const page={runId:'run',nodeId:null,format:'text',...textPage('🙂ab',offset,limit)};expect(commandPage(page)).toBe(page);}
  });
});
