import {describe,expect,it,vi} from 'vitest';
import {RunRefreshGate} from '../src/run-refresh.js';

const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

describe('selected run refresh gate',()=>{
  it('coalesces many invalidations behind one delayed inspect and follows up once',async()=>{
    const gate=new RunRefreshGate(),first=deferred<string>(),second=deferred<string>(),load=vi.fn<()=>Promise<string>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),received:string[]=[];gate.select({agentId:'a',sessionKey:'s',runId:'one'});
    void gate.refresh(load,value=>received.push(value),()=>{});for(let index=0;index<20;index++)void gate.refresh(load,value=>received.push(value),()=>{});expect(load).toHaveBeenCalledOnce();first.resolve('first');await Promise.resolve();await Promise.resolve();expect(load).toHaveBeenCalledTimes(2);second.resolve('second');await Promise.resolve();expect(received).toEqual(['first','second']);
  });
  it('drops stale success after a selection change and clears only a current inspection failure',async()=>{
    const gate=new RunRefreshGate(),old=deferred<string>(),current=deferred<string>(),received:string[]=[],failed:unknown[]=[];gate.select({agentId:'a',sessionKey:'s',runId:'old'});void gate.refresh(()=>old.promise,value=>received.push(value),error=>failed.push(error));gate.select({agentId:'a',sessionKey:'s',runId:'current'});void gate.refresh(()=>current.promise,value=>received.push(value),error=>failed.push(error));old.resolve('private-old');current.reject(Error('lost authority'));await Promise.resolve();await Promise.resolve();expect(received).toEqual([]);expect(failed).toHaveLength(1);
  });
  it('preserves an action result only while its captured selection remains current',()=>{
    const gate=new RunRefreshGate();gate.select({agentId:'a',sessionKey:'s',runId:''});const action=gate.current();gate.select({agentId:'a',sessionKey:'s',runId:'other'});expect(gate.matches(action)).toBe(false);gate.select({agentId:'a',sessionKey:'s',runId:''});expect(gate.matches(action)).toBe(false);expect(gate.matches(gate.current())).toBe(true);gate.clear();expect(gate.matches(action)).toBe(false);
  });
});
