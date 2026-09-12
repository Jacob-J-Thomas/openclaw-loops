import {describe,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Engine,type Actor,type State,type HostCapabilities} from '../src/engine.js';
import {SqliteStorage} from '../src/storage.js';
import {parsePluginConfig} from '../src/budgets.js';
import {examples} from '../src/examples.js';

const actor:Actor={agentId:'main',sessionKey:'agent:main:budgets',sessionId:'budget-session',source:'tool',human:false,check:()=>{}};
const host=():HostCapabilities=>({check:()=>{},modelInfo:async()=>({}),complete:vi.fn(async()=>({text:'Done'}))});
function memory(){let state:State|undefined;return {read:()=>structuredClone(state),write:(next:State)=>{state=structuredClone(next);}};}
describe('operator execution budgets',()=>{
  it('checks known configuration fields and safe-integer resource limits',()=>{
    expect(parsePluginConfig({budgets:{defaultRepeat:50,inputBytes:2000000},maxConcurrentRuns:2})).toMatchObject({budgets:{defaultRepeat:50}});
    for(const config of [{budgets:{promptBytes:0}},{budgets:{definitionBytes:NaN}},{budgets:{inputBytes:1.5}},{budgets:{unknown:100}},{maxConcurrentRuns:Infinity}])expect(()=>parsePluginConfig(config),JSON.stringify(config)).toThrow('Invalid');
  });
  it('applies input and rendered prompt limits to new v2 execution and reports operator defaults',async()=>{
    const storage=memory(),capabilities=host(),engine=new Engine(storage,capabilities,{budgets:{inputBytes:1000,promptBytes:64,defaultRepeat:20,defaultExecutions:10000}});
    const definition={...structuredClone(examples[0]),schemaVersion:2 as const};
    await expect(engine.test(actor,definition,{text:'x'.repeat(1000)},'input-budget')).rejects.toThrow('1000 bytes');
    const failed=await engine.test(actor,definition,{text:'x'.repeat(100)},'prompt-budget');expect(failed).toMatchObject({state:'failed',error:expect.stringContaining('prompt')});expect(capabilities.complete).not.toHaveBeenCalled();
    expect(engine.capabilities(actor)).toMatchObject({budgets:{defaultRepeat:20,defaultExecutions:10000,inputBytes:1000,promptBytes:64}});
    // V1 retains its historical input/prompt contract.
    expect((await engine.test(actor,examples[0],{text:'x'.repeat(100)},'legacy-budget')).state).toBe('completed');
    await engine.close();
  });
  it('loads saved definitions larger than the default budget after an operator reduces new-work limits',async()=>{
    const root=mkdtempSync(join(tmpdir(),'loops-budget-store-'));let engine:Engine|undefined;
    try{
      const file=join(root,'loops.sqlite'),definition={...structuredClone(examples[0]),schemaVersion:2 as const};
      if(definition.nodes[1].kind!=='inference')throw Error();definition.nodes[1].prompt='x'.repeat(4*1024*1024+1);
      engine=new Engine(new SqliteStorage(file),host(),{budgets:{definitionBytes:6*1024*1024}});
      engine.draft(actor,{...definition,revision:1},1);await engine.close();engine=undefined;
      engine=new Engine(new SqliteStorage(file),host(),{budgets:{definitionBytes:4096}});
      const saved=engine.load(actor,definition.id);expect(saved.definition.nodes[1]).toMatchObject({prompt:definition.nodes[1].prompt});
      const reopened=engine;expect(()=>reopened.draft(actor,saved.definition,2)).toThrow('4096-byte');
    }finally{await engine?.close();rmSync(root,{recursive:true,force:true});}
  });
});
