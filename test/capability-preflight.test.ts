import {describe,expect,it,vi} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {InferenceEditor} from '../src/inference-editor.js';
import {type Advanced,type ParameterDescriptor,validateAdvanced} from '../src/inference-settings.js';

const actor:Actor={agentId:'fixture-agent',sessionKey:'agent:fixture:capabilities',sessionId:'capability-session',source:'tool',human:false,check:()=>{}};
class Memory implements Storage {
  private state: ReturnType<Storage['read']>;
  read(){return structuredClone(this.state);}
  write(value:Parameters<Storage['write']>[0]){this.state=structuredClone(value);}
}
const descriptors:ParameterDescriptor[]=[
  {key:'temperature',label:'Temperature',type:'number',support:'supported',reason:'Fixture runtime applies temperature.',minimum:0},
  {key:'maxTokens',label:'Output tokens',type:'integer',support:'advisory',reason:'Fixture runtime may ignore output-token hints.',minimum:1},
  {key:'topP',label:'Top p',type:'number',support:'unsupported',reason:'Fixture runtime rejects top p.',minimum:0,maximum:1},
  {key:'minP',label:'Min p',type:'number',support:'unknown',reason:'Fixture runtime did not describe min p.',minimum:0,maximum:1},
];
function definition(advanced?:Advanced,model='fixture/target'){
  const definition=structuredClone(examples[0]);
  const inference=definition.nodes.find(node=>node.kind==='inference');
  if(!inference||inference.kind!=='inference')throw Error('Expected inference fixture.');
  inference.model=model;
  if(advanced)inference.advanced=advanced;else delete inference.advanced;
  return definition;
}
function capabilityFixture(){
  const complete=vi.fn(async()=>({text:'Fixture completion'}));
  const host:HostCapabilities={check:()=>{},complete,modelInfo:async()=>({}),capabilities:()=>({model:'fixture/target',configured:'unknown',authorized:'unknown',available:'unknown',parameters:descriptors,notes:['Deterministic descriptor fixture; not public-host runtime evidence.']})};
  return {complete,engine:new Engine(new Memory(),host)};
}

describe('capability descriptor preflight',()=>{
  it('keeps inherited and supported/advisory zero overrides usable, while explaining explicit unsupported and unknown overrides',async()=>{
    expect(validateAdvanced(undefined,descriptors)).toEqual([]);
    expect(validateAdvanced({temperature:0,maxTokens:1},descriptors)).toEqual([]);
    expect(validateAdvanced({topP:0},descriptors)).toEqual(['Top p: Fixture runtime rejects top p.']);
    expect(validateAdvanced({minP:0},descriptors)).toEqual(['Min p: Fixture runtime did not describe min p.']);

    const {engine,complete}=capabilityFixture();
    await expect(engine.test(actor,definition(),{text:'Inherited settings'},'inherit')).resolves.toMatchObject({state:'completed'});
    await expect(engine.test(actor,definition({temperature:0,maxTokens:1}),{text:'Explicit portable values'},'portable-zero')).resolves.toMatchObject({state:'completed'});
    await expect(engine.test(actor,definition({topP:0}),{text:'Must not dispatch'},'unsupported')).rejects.toThrow('Fixture runtime rejects top p.');
    await expect(engine.test(actor,definition({minP:0}),{text:'Must not dispatch'},'unknown')).rejects.toThrow('Fixture runtime did not describe min p.');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('renders saved zero and incompatible controls with individual reset choices before capability resolution',()=>{
    const node=definition({temperature:0,topP:0},'fixture/incompatible').nodes.find(candidate=>candidate.kind==='inference');
    if(!node||node.kind!=='inference')throw Error('Expected inference fixture.');
    const html=renderToStaticMarkup(React.createElement(InferenceEditor,{node,onChange:()=>{},loadCapabilities:async()=>{throw Error('SSR does not resolve capabilities.');}}));
    expect(html).toContain('value="0"');
    expect(html).toContain('Temperature <small>· advisory</small>');
    expect(html).toContain('Top p <small>· unsupported</small>');
    expect(html).toContain('Reset top p');
    expect(html).toContain('This saved override is incompatible with the current runtime. Reset it or select a supported runtime.');
    expect(html).toContain('value="fixture/incompatible"');
  });
});
