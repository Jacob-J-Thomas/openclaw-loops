import {describe,it,expect,vi} from 'vitest';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {DefinitionSchema,parseDefinition,type Definition} from '../src/graph.js';
import {duplicateNode} from '../src/editor-operations.js';
import {Value} from 'typebox/value';

class MemoryStorage implements Storage{
  state:ReturnType<Storage['read']>;
  read(){return structuredClone(this.state);}
  write(state:Parameters<Storage['write']>[0]){this.state=structuredClone(state);}
}

const actor:Actor={agentId:'qa',sessionKey:'agent:qa:duplicate',sessionId:'duplicate',source:'tool',human:false,check:()=>{}};
const host=():HostCapabilities=>({check:()=>{},modelInfo:vi.fn(async()=>({provider:'fixture',model:'fixture'})),complete:vi.fn(async()=>({text:'nodes.body-infer.text'}))});

function definition(repeatId='repeat'):Definition{
  return {schemaVersion:2,id:'duplicate-repeat',slug:'duplicate-repeat',name:'Duplicate Repeat',description:'QA duplicate execution',revision:0,inputSchema:[],capabilities:['llm'],limits:{maxExecutions:10,maxOutputBytes:4096},
    nodes:[{id:'input',kind:'input',label:'Input'},{id:repeatId,kind:'repeat',label:'Repeat',maxIterations:2,body:[
      {id:'body-infer',kind:'inference',label:'Body inference',prompt:'Return the QA literal',output:'text'},
      {id:'body-condition',kind:'condition',label:'Body condition',predicate:{left:'{{nodes.body-infer.text}}',op:'equals',right:'nodes.body-infer.text'}},
    ]},{id:'result',kind:'return',label:'Result',value:`{{nodes.${repeatId}.text}}`}],
    edges:[{id:'input-repeat',source:'input',target:repeatId,port:'next'},{id:'repeat-result',source:repeatId,target:'result',port:'next'}],layout:{input:{x:0,y:0},[repeatId]:{x:1,y:1},result:{x:2,y:2}}};
}

function executableCopy(source:Definition):Definition{
  let sequence=0;const duplicated=duplicateNode(source,'repeat',prefix=>`${prefix}-${++sequence}`);
  const repeat=duplicated.nodes.at(-1);if(!repeat||repeat.kind!=='repeat')throw new Error('Repeat was not duplicated.');
  const copy=definition(repeat.id);copy.nodes[1]=repeat;copy.layout={[repeat.id]:{x:1,y:1},input:{x:0,y:0},result:{x:2,y:2}};
  return copy;
}

// This is the pre-repair operation, kept as a test-local baseline so the
// regression proves the weaker final-result assertion would miss the defect.
function legacyExecutableCopy(source:Definition):Definition{
  const original=source.nodes.find(node=>node.id==='repeat');if(!original||original.kind!=='repeat')throw new Error('Fixture must contain Repeat.');
  const repeat=structuredClone(original);repeat.id='repeat-1';const previous=repeat.body[0].id;repeat.body[0].id='inference-2';repeat.body[1].id='condition-3';
  for(const operand of ['left','right'] as const){const value=repeat.body[1].predicate[operand];if(typeof value==='string')repeat.body[1].predicate[operand]=value.replaceAll(`nodes.${previous}.`,`nodes.${repeat.body[0].id}.`);}
  const copy=definition(repeat.id);copy.nodes[1]=repeat;copy.layout={[repeat.id]:{x:1,y:1},input:{x:0,y:0},result:{x:2,y:2}};
  return copy;
}

async function execute(definition:Definition,requestId:string){
  const adapter=host(),engine=new Engine(new MemoryStorage(),adapter);
  try{return {run:await engine.test(actor,definition,{},requestId),adapter};}
  finally{await engine.close();}
}

describe('QA duplicate-node regressions',()=>{
  it('QA-04 remaps only parsed Repeat binding tokens and preserves literal predicate data',async()=>{
    const source=definition();const repeat=source.nodes[1];if(repeat.kind!=='repeat')throw new Error('Fixture must contain Repeat.');
    repeat.body[1].predicate.left='prefix {{  nodes.body-infer.text  }}; literal nodes.body-infer.text; other {{ nodes.other.text }}';
    repeat.body[1].predicate.right='{{nodes.body-infer.text}} + nodes.body-infer.text';
    const duplicated=executableCopy(source);const copyRepeat=duplicated.nodes[1];if(copyRepeat.kind!=='repeat')throw new Error('Copy must contain Repeat.');
    const copiedId=copyRepeat.body[0].id;
    expect(copyRepeat.body[1].predicate.left).toBe(`prefix {{  nodes.${copiedId}.text  }}; literal nodes.body-infer.text; other {{ nodes.other.text }}`);
    expect(copyRepeat.body[1].predicate.right).toBe(`{{nodes.${copiedId}.text}} + nodes.body-infer.text`);
    const jsonSource=definition(),jsonRepeat=jsonSource.nodes[1];if(jsonRepeat.kind!=='repeat')throw new Error('Fixture must contain Repeat.');
    const literal={literalJson:'{"node":"nodes.body-infer.text","template":"{{nodes.body-infer.text}}"}'};
    // Explicit JSON predicate values are data, never templates.
    jsonRepeat.body[1].predicate.right=literal;
    const jsonCopy=executableCopy(jsonSource).nodes[1];if(jsonCopy.kind!=='repeat')throw new Error('Copy must contain Repeat.');
    expect(jsonCopy.body[1].predicate.right).toEqual(literal);

    const original=definition(),copy=executableCopy(original);
    for(const [name,value] of [['original',original],['copy',copy]] as const){
      const {run,adapter}=await execute(value,name),repeatOutput=run.outputs[value.nodes[1].id];
      expect(run.result).toBe('nodes.body-infer.text');
      expect(repeatOutput).toMatchObject({text:'nodes.body-infer.text',succeeded:true,iterations:1,exhausted:false});
      expect(adapter.complete).toHaveBeenCalledTimes(1);
    }
    const baseline=await execute(legacyExecutableCopy(definition()),'legacy-copy');
    // The old global replacement has the same final text, but exhausts Repeat.
    expect(baseline.run.result).toBe('nodes.body-infer.text');
    expect(baseline.run.outputs['repeat-1']).toMatchObject({succeeded:false,iterations:2,exhausted:true});
    expect(baseline.adapter.complete).toHaveBeenCalledTimes(2);
  });

  it('QA-05 preserves a code-point bounded Unicode copy label through schema and JSON round trips',()=>{
    const source=definition();const repeat=source.nodes[1];if(repeat.kind!=='repeat')throw new Error('Fixture must contain Repeat.');
    repeat.label=`${'a'.repeat(99)}🙂`;const originalLabel=repeat.label;
    const duplicated=duplicateNode(source,'repeat',prefix=>`${prefix}-copy`),copy=duplicated.nodes.at(-1);if(!copy)throw new Error('Repeat was not duplicated.');
    expect(source.nodes[1].label).toBe(originalLabel);
    expect([...copy.label]).toHaveLength(100);expect(copy.label.endsWith('🙂')).toBe(true);expect(copy.label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(Value.Check(DefinitionSchema,duplicated)).toBe(true);
    expect(parseDefinition(JSON.parse(JSON.stringify(duplicated)))).toEqual(duplicated);
    const ascii=definition(),asciiRepeat=ascii.nodes[1];if(asciiRepeat.kind!=='repeat')throw new Error('Fixture must contain Repeat.');
    asciiRepeat.label='a'.repeat(100);const asciiCopy=duplicateNode(ascii,'repeat',prefix=>`${prefix}-copy`).nodes.at(-1);if(!asciiCopy)throw new Error('Repeat was not duplicated.');
    expect(asciiCopy.label).toBe('a'.repeat(100));expect(Value.Check(DefinitionSchema,{...ascii,nodes:[...ascii.nodes,asciiCopy]})).toBe(true);
  });
});
