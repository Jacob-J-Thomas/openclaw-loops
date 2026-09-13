import {describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {commandReply,commandPage,commandReplyLimit,formatCommandResult,parseCommandInvocation} from '../src/commands.js';
import type {PluginCommandContext} from 'openclaw/plugin-sdk/plugin-entry';
import {textPage} from '../src/feature-json.js';
import type {DocumentReference} from '../src/wire-contract.js';
import {fitsToolReply,toolPage} from '../src/tool-replies.js';
import {jsonResult} from 'openclaw/plugin-sdk/tool-results';

const reference:DocumentReference={kind:'loops-document',documentId:'a'.repeat(64),sha256:'b'.repeat(64),bytes:1,read:'loops_document',description:'Immutable result'};
describe('conversation reply envelope',()=>{
  it.each([false,true])('preserves all public operation diagnostics in a command reply, retryable=%s',retryable=>{
    const detail={code:'HOST_TIMEOUT',message:'The selected runtime timed out.',phase:'inference',nodeId:'research',model:'fake/selected',retryable,recovery:'Inspect the uncertain attempt before explicitly retrying.'};
    const text=formatCommandResult({kind:'loops-error',operation:'run',error:detail});
    expect(text).toMatch(/^Loops \[HOST_TIMEOUT\]/);
    for(const value of ['Phase: inference','Node: research','Model: fake/selected',retryable?'Retryable: Yes, after the recovery step':'Retryable: Resolve the failure first','Next step: '+detail.recovery])expect(text).toContain(value);
  });
  it('decodes lossless command arguments before the unchanged operation schema',()=>{
    const input={uploadId:'escaped',offset:0,text:JSON.stringify({text:'🙂\u0000"\\\n\\n'})},args='upload --json-base64 '+Buffer.from(JSON.stringify(input)).toString('base64');
    // The pinned host normalizes literal backslash-n before plugin dispatch.
    expect(args.replace(/\\n/g,' ')).toBe(args);
    expect(parseCommandInvocation({args,commandBody:'/loops '+args} as PluginCommandContext,100000)).toEqual({kind:'invoke',operation:'upload',input,format:'json'});
    const invoke=(encoded:string)=>parseCommandInvocation({args:'upload --json-base64 '+encoded} as PluginCommandContext,100000);
    for(const encoded of ['!',Buffer.from([0xff]).toString('base64'),Buffer.from('{').toString('base64'),'e30','e30=!',Buffer.from(JSON.stringify({...input,human:true})).toString('base64'),Buffer.from('[]').toString('base64')])expect(()=>invoke(encoded)).toThrow();
    expect(()=>parseCommandInvocation({args,commandBody:'/loops '+args+'changed'} as PluginCommandContext,100000)).toThrow('changed this command');
  });
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
  it.each(['x','🙂','\u0000','"\\\r\n'])('fits direct and deferred SDK tool results without losing content (%#)',sample=>{
    const text=sample.repeat(17000);let offset=0,full='';
    while(true){
      const source={documentId:reference.documentId,sha256:reference.sha256,...textPage(text,offset)},page=toolPage(source,'loops_document'),result=jsonResult(page);
      expect(fitsToolReply(page,'loops_document')).toBe(true);expect(result.content[0].type).toBe('text');
      expect(JSON.stringify({tool:{id:'openclaw:loops-poc:loops_document',name:'loops_document',source:'openclaw'},result},null,2).length).toBeLessThanOrEqual(16000);
      full+=page.text;if(page.nextOffset===null)break;expect(page.nextOffset).toBe(offset+Array.from(page.text).length);expect(page.nextOffset).toBeGreaterThan(offset);offset=page.nextOffset;
    }
    expect(full).toBe(text);
  });
});
