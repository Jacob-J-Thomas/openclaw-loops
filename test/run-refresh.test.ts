import {describe,expect,it,vi} from 'vitest';
import {RunRefreshGate} from '../src/run-refresh.js';
import {acceptedRunView,clearRunView,readRunView,resolveRunView,saveRunView} from '../src/run-view-state.js';

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
  it('starts a reconnected inspection without waiting for the stale host request to settle',async()=>{
    const gate=new RunRefreshGate(),first=deferred<string>(),second=deferred<string>(),load=vi.fn<()=>Promise<string>>().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),received:string[]=[];gate.select({agentId:'a',sessionKey:'s',runId:'parked'});
    void gate.refresh(load,value=>received.push(value),()=>{});gate.invalidate();void gate.refresh(load,value=>received.push(value),()=>{});expect(load).toHaveBeenCalledTimes(2);second.resolve('current');await Promise.resolve();expect(received).toEqual(['current']);first.resolve('stale');await Promise.resolve();expect(received).toEqual(['current']);
  });
});

describe('selected run mutations',()=>{
  it('starts a post-action inspection immediately and cannot repaint pre-action controls',async()=>{
    const gate=new RunRefreshGate(),before=deferred<string>(),after=deferred<string>(),received:string[]=[];
    const load=vi.fn<()=>Promise<string>>().mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
    gate.select({agentId:'a',sessionKey:'s',runId:'same-run'});
    void gate.refresh(load,value=>received.push(value),()=>{});
    const action=gate.current();expect(gate.completeMutation(action)).toBe(true);
    gate.select({agentId:'a',sessionKey:'s',runId:'same-run'});
    void gate.refresh(load,value=>received.push(value),()=>{});expect(load).toHaveBeenCalledTimes(2);
    before.resolve('review');await Promise.resolve();expect(received).toEqual([]);
    after.resolve('completed');await Promise.resolve();expect(received).toEqual(['completed']);
    const newer=gate.current();expect(gate.completeMutation(action)).toBe(false);expect(gate.matches(newer)).toBe(true);
  });
});

describe('persisted run view reconciliation',()=>{
  it('restores identifiers only when the current host roster authorizes both agent and session',()=>{
    const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)};
    saveRunView({agentId:'qa66',sessionKey:'agent:qa66:approved',runId:'parked'},()=>storage);
    const saved=readRunView(()=>storage);
    expect(acceptedRunView(saved,['main','qa66'],['agent:qa66:approved'])).toEqual(saved);
    expect(resolveRunView(saved,[],['agent:qa66:approved'])).toBe('pending');
    expect(resolveRunView(saved,['main','qa66'],['agent:qa66:approved'])).toBe('accepted');
    expect(resolveRunView(saved,['main'],['agent:qa66:approved'])).toBe('rejected');
    expect(resolveRunView(saved,['main','qa66'],['agent:qa66:denied'])).toBe('rejected');
    expect(acceptedRunView(saved,['main'],['agent:qa66:approved'])).toBeUndefined();
    expect(acceptedRunView(saved,['main','qa66'],['agent:qa66:denied'])).toBeUndefined();
  });
  it('contains an unavailable browser storage getter',()=>{
    const unavailable=()=>{throw Error('storage disabled');};
    expect(readRunView(unavailable)).toBeUndefined();
    expect(()=>saveRunView({agentId:'a',sessionKey:'s',runId:'r'},unavailable)).not.toThrow();
    expect(()=>clearRunView(unavailable)).not.toThrow();
  });
});
