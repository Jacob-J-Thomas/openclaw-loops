import {describe,expect,it,vi} from 'vitest';
import {Value} from 'typebox/value';
import {dataSchemaIssues,validateDataValue,type DataSchema} from '../src/data-schema.js';
import {validateGraph,validateInput,type Definition} from '../src/graph.js';
import {Engine,type Actor,type HostCapabilities,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';
import {wireContract} from '../src/wire-contract.js';
import {inspectionOutput} from '../src/run-inspection.js';

class Memory implements Storage{state:ReturnType<Storage['read']>;read(){return structuredClone(this.state);}write(state:Parameters<Storage['write']>[0]){this.state=structuredClone(state);}}
const actor=():Actor=>({agentId:'schema',sessionKey:'agent:schema:test',sessionId:'schema-session',source:'tool',human:false,check:()=>{}});
const recursive:DataSchema={type:'object',properties:{profile:{type:'object',properties:{name:{type:'string',minLength:1},scores:{type:'array',items:{type:'integer',minimum:0},minItems:1}},required:['name','scores'],additionalProperties:false},note:{type:'json'}},required:['profile'],additionalProperties:false};
function definition():Definition{
  const value=structuredClone(examples[0]);value.schemaVersion=3;value.inputSchema=[{name:'data',label:'Data',type:'json',required:true,schema:recursive}];
  const inference=value.nodes.find(node=>node.kind==='inference');if(!inference||inference.kind!=='inference')throw Error('missing inference');inference.prompt='Summarize {{input.data.profile.name}}';
  return value;
}
describe('bounded recursive data schemas',()=>{
  it('validates nested object and array values with escaped JSON Pointer diagnostics',()=>{
    expect(dataSchemaIssues(recursive)).toEqual([]);
    expect(validateDataValue(recursive,{profile:{name:'Zoë🙂',scores:[0,2],extra:true}})).toContainEqual(expect.objectContaining({instancePath:'/profile',keyword:'additionalProperties'}));
    expect(validateDataValue({type:'object',properties:{'a/b':{type:'string'}},required:['a/b'],additionalProperties:false},{'a/b':0})).toContainEqual(expect.objectContaining({instancePath:'/a~1b',keyword:'type'}));
    expect(validateDataValue(recursive,{profile:{name:'Zoë🙂',scores:[0],},note:null})).toEqual([]);
  });
  it('rejects unsafe, overdeep, oversized and unsafe-pattern authored schemas before compilation',()=>{
    const deep:{type:string;properties:Record<string,unknown>}={type:'object',properties:{}};let current=deep;for(let i=0;i<34;i++){const next:{type:string;properties:Record<string,unknown>}={type:'object',properties:{next:{type:'json'}}};current.properties.next=next;current=next;}
    expect(dataSchemaIssues({type:'object',properties:{constructor:{type:'string'}}}).map(issue=>issue.keyword)).toContain('propertyName');
    expect(dataSchemaIssues(deep).map(issue=>issue.keyword)).toContain('maxDepth');
    expect(dataSchemaIssues({type:'string',pattern:'(a+)+'}).map(issue=>issue.keyword)).toContain('pattern');
    expect(dataSchemaIssues({type:'string',pattern:'^a*a*a*$'}).map(issue=>issue.keyword)).toContain('pattern');
    expect(dataSchemaIssues({type:'string',pattern:'^[a-z]+$'})).toEqual([]);
    expect(dataSchemaIssues({type:'string',enum:[]}).map(issue=>issue.keyword)).toContain('enum');
    expect(dataSchemaIssues({type:'object',properties:{a:{type:'string'}},required:['a','a']}).map(issue=>issue.keyword)).toContain('required');
    expect(dataSchemaIssues(new Date()).map(issue=>issue.keyword)).toContain('type');
    expect(dataSchemaIssues({type:'string',title:'x'.repeat(140000)}).map(issue=>issue.keyword)).toContain('maxBytes');
  });
  it('rejects inapplicable structural keywords and structurally duplicate enum values before runtime compilation',()=>{
    const invalid=[
      {type:'object',items:{type:'string'}},
      {type:'object',minItems:1},
      {type:'array',items:{type:'json'},properties:{ignored:{type:'integer'}}},
      {type:'array',items:{type:'json'},required:['ignored']},
      {type:'array',items:{type:'json'},additionalProperties:false},
    ];
    for(const schema of invalid){
      expect(dataSchemaIssues(schema).some(issue=>issue.keyword==='inapplicable'),JSON.stringify(schema)).toBe(true);
      expect(Value.Check(wireContract.operations.validate.input,{definition:{...definition(),inputSchema:[{name:'data',label:'Data',type:'json',required:true,schema}]}}),JSON.stringify(schema)).toBe(false);
    }
    for(const schema of [{type:'integer',enum:[0,0]},{type:'object',enum:[{a:1,b:2},{b:2,a:1}]}]){
      expect(dataSchemaIssues(schema).some(issue=>issue.keyword==='uniqueItems'),JSON.stringify(schema)).toBe(true);
      expect(()=>validateDataValue(schema,0),JSON.stringify(schema)).not.toThrow();
      expect(Value.Check(wireContract.operations.validate.input,{definition:{...definition(),inputSchema:[{name:'data',label:'Data',type:'json',required:true,schema}]}}),JSON.stringify(schema)).toBe(false);
    }
  });
  it('exposes bounded recursive schemas on the actual public definition wire',()=>{
    const input=wireContract.operations.validate.input,valid={definition:definition()};
    expect(Value.Check(input,valid)).toBe(true);
    for(const version of [1,2] as const){
      const legacy=structuredClone(examples[0]);legacy.schemaVersion=version;
      if(version===1)legacy.limits.timeoutMs??=120000;
      const recursiveInput={definition:legacy};recursiveInput.definition.inputSchema[0]!.schema={type:'json'};
      expect(Value.Check(input,recursiveInput),`v${version} input schema`).toBe(false);
      const recursiveOutput={definition:structuredClone(legacy)};const oldNode=recursiveOutput.definition.nodes.find(node=>node.kind==='inference');if(!oldNode||oldNode.kind!=='inference')throw Error('missing inference');oldNode.outputSchema={type:'json'};
      expect(Value.Check(input,recursiveOutput),`v${version} output schema`).toBe(false);
    }

    const unknown=structuredClone(valid);(unknown.definition.inputSchema[0].schema as Record<string,unknown>).unknown=true;
    expect(Value.Check(input,unknown)).toBe(false);

    const missingItems=structuredClone(valid);(missingItems.definition.inputSchema[0].schema as {properties:{profile:{properties:{scores:Record<string,unknown>}}}}).properties.profile.properties.scores={type:'array'};
    expect(Value.Check(input,missingItems)).toBe(false);

    const malformedEnum=structuredClone(valid);(malformedEnum.definition.inputSchema[0].schema as {properties:{profile:{properties:{name:Record<string,unknown>}}}}).properties.profile.properties.name.enum='accepted';
    expect(Value.Check(input,malformedEnum)).toBe(false);
    const emptyEnum=structuredClone(valid);(emptyEnum.definition.inputSchema[0].schema as {properties:{profile:{properties:{name:Record<string,unknown>}}}}).properties.profile.properties.name.enum=[];
    expect(Value.Check(input,emptyEnum)).toBe(false);

    const output=structuredClone(valid);const inference=output.definition.nodes.find(node=>node.kind==='inference');if(!inference||inference.kind!=='inference')throw Error('missing inference');inference.outputSchema={type:'array',items:{type:'object',properties:{label:{type:'string',pattern:'^[a-z]+$'}},required:['label'],additionalProperties:false},minItems:1};
    expect(Value.Check(input,output)).toBe(true);
    const repeated=structuredClone(examples[1]);repeated.schemaVersion=3;const repeat=repeated.nodes.find(node=>node.kind==='repeat');if(!repeat||repeat.kind!=='repeat')throw Error('missing Repeat');
    const bodyInference=repeat.body[0] as typeof repeat.body[0]&{outputSchema?:DataSchema};bodyInference.outputSchema={type:'object',properties:{name:{type:'string'}},required:['name']};bodyInference.output='json';
    expect(Value.Check(input,{definition:repeated})).toBe(true);
    (bodyInference.outputSchema as Record<string,unknown>).unknown=true;
    expect(Value.Check(input,{definition:repeated}), 'nested Repeat body output schema').toBe(false);
  });
  it('keeps legacy flat fields intact and rejects invalid recursive input at admission',()=>{
    expect(validateInput(examples[0],{text:'legacy'})).toEqual({text:'legacy'});
    const d=definition();expect(validateGraph(d)).toEqual([]);
    const legacy=structuredClone(examples[0]);const legacyInference=legacy.nodes.find(node=>node.kind==='inference');if(!legacyInference||legacyInference.kind!=='inference')throw Error('missing inference');legacyInference.outputSchema={type:'string'};expect(validateGraph(legacy).map(issue=>issue.message)).toContain('Recursive output schemas require schemaVersion 3.');
    expect(()=>validateInput(d,{data:{profile:{name:'',scores:[-1]}}})).toThrow(/Input data\/profile\/name/);
    expect(validateInput(d,{data:{profile:{name:'Núll🙂',scores:[0]},},})).toEqual({data:{profile:{name:'Núll🙂',scores:[0]}}});
  });
  it('fails an invalid node output before it can checkpoint or commit context',async()=>{
    const d=definition();const inference=d.nodes.find(node=>node.kind==='inference');if(!inference||inference.kind!=='inference')throw Error('missing inference');inference.output='json';inference.outputSchema={type:'object',properties:{name:{type:'string',enum:['accepted']}},required:['name'],additionalProperties:false};
    const storage=new Memory(),host:HostCapabilities={check:vi.fn(),complete:vi.fn(async()=>({text:'{"name":"rejected"}',provider:'test',model:'test',agentId:'schema'})),modelInfo:vi.fn(async()=>({}))};
    const engine=new Engine(storage,host);const run=await engine.test(actor(),d,{data:{profile:{name:'Núll',scores:[0]},note:null}},'output-schema');
    expect(run).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_OUTPUT_SCHEMA_INVALID'},outputs:{input:{fields:['data']}}});
    expect(run.outputs).not.toHaveProperty('summary');expect(run.context?.journal).toHaveLength(0);
    expect(run.trace.find(step=>step.nodeId==='summary')).toMatchObject({rejectedResponse:{preview:'{"name":"rejected"}',truncated:false,bytes:19}});
    expect(run.errorDetail?.message).toMatch(/Output summary\/name:.*enum; actual string/);
    expect(inspectionOutput(run,'summary')).toMatchObject({label:'Rejected model response · never checkpointed',value:expect.stringContaining('SHA-256')});
    const persisted=new Engine(storage,host).status(actor(),run.id);expect(persisted.outputs).not.toHaveProperty('summary');
  });
  it('keeps rejected Unicode previews within the byte bound without replacement characters',async()=>{
    const d=definition(),node=d.nodes.find(item=>item.kind==='inference');if(!node||node.kind!=='inference')throw Error();node.output='json';
    const response='a'.repeat(1022)+'🙂'+'tail';
    const host:HostCapabilities={check:vi.fn(),complete:vi.fn(async()=>({text:response})),modelInfo:vi.fn(async()=>({}))};
    const run=await new Engine(new Memory(),host).test(actor(),d,{data:{profile:{name:'Núll',scores:[0]}}},'unicode-rejection');
    const rejected=run.trace.find(step=>step.nodeId===node.id)?.rejectedResponse;
    expect(rejected).toMatchObject({preview:'a'.repeat(1022),truncated:true,bytes:1030});
    expect(rejected?.preview).not.toContain('�');expect(run.outputs).not.toHaveProperty(node.id);
  });
  it('requires an explicit v3 JSON schema for native structured generation and passes it to the host',async()=>{
    const d=definition(),node=d.nodes.find(item=>item.kind==='inference');if(!node||node.kind!=='inference')throw Error();
    node.structuredGeneration='native';
    expect(validateGraph(d).map(issue=>issue.message)).toContain('Native structured generation requires JSON output and a valid output schema.');
    node.output='json';node.outputSchema={type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false};
    expect(validateGraph(d)).toEqual([]);
    const host:HostCapabilities={check:vi.fn(),complete:vi.fn(async()=>({text:'{"name":"Núll"}'})),modelInfo:vi.fn(async()=>({}))};
    const engine=new Engine(new Memory(),host);await engine.test(actor(),d,{data:{profile:{name:'Núll',scores:[0]}}},'native-schema');
    expect(vi.mocked(host.complete).mock.calls[0]?.[5]).toEqual({nodeId:node.id,schema:node.outputSchema});
    const old=structuredClone(d);old.schemaVersion=2;expect(validateGraph(old).map(issue=>issue.message)).toContain('Recursive output schemas require schemaVersion 3.');
  });
  it('records invalid parked output as a failed run when Wait is released',async()=>{
    const d=definition();d.inputSchema=[];d.capabilities=[];d.nodes=[{id:'input',kind:'input',label:'Input'},{id:'wait',kind:'wait',label:'Wait',message:'Continue',outputSchema:{type:'string'}},{id:'return',kind:'return',label:'Return',value:'accepted'}];d.edges=[{id:'a',source:'input',target:'wait',port:'next'},{id:'b',source:'wait',target:'return',port:'next'}];
    const storage=new Memory(),host:HostCapabilities={check:vi.fn(),complete:vi.fn(async()=>({text:'unused'})),modelInfo:vi.fn(async()=>({}))};
    const engine=new Engine(storage,host),parked=await engine.test(actor(),d,{},'parked-output');expect(parked.state).toBe('waiting');
    const failed=await engine.resume(actor(),parked.id);expect(failed).toMatchObject({state:'failed',errorDetail:{code:'LOOPS_OUTPUT_SCHEMA_INVALID',nodeId:'wait'}});
    expect(failed.outputs).not.toHaveProperty('wait');expect(failed.outputs).not.toHaveProperty('return');
    expect(new Engine(storage,host).status(actor(),parked.id).errorDetail).toEqual(failed.errorDetail);
  });
  it('requires JSON mode and validates the parsed generated value, including zero, null and Unicode',async()=>{
    const d=definition(),inference=d.nodes.find(node=>node.kind==='inference');if(!inference||inference.kind!=='inference')throw Error('missing inference');
    inference.outputSchema={type:'object',properties:{score:{type:'integer',minimum:0},note:{type:'null'},name:{type:'string',minLength:1}},required:['score','note','name'],additionalProperties:false};
    expect(validateGraph(d).map(issue=>issue.message)).toContain('Inference output schemas require JSON output mode.');
    inference.output='json';expect(validateGraph(d)).toEqual([]);
    const terminal=d.nodes.find(node=>node.kind==='return');if(!terminal||terminal.kind!=='return')throw Error('missing Return');terminal.value='{{nodes.summary.value.score}}';
    const outputs=['{"score":0,"note":null,"name":"Zoë🙂"}','{"score":-1,"note":null,"name":"Zoë🙂"}','plain prose','{"score":0,"note":null}'];
    const host:HostCapabilities={check:vi.fn(),complete:vi.fn(async()=>({text:outputs.shift()??'',provider:'test',model:'test',agentId:'schema'})),modelInfo:vi.fn(async()=>({}))};
    const storage=new Memory(),engine=new Engine(storage,host),input={data:{profile:{name:'Núll',scores:[0]},note:null}};
    const valid=await engine.test(actor(),d,input,'schema-valid');expect(valid.state).toBe('completed');expect(valid.result).toBe(0);expect(valid.outputs.summary).toMatchObject({value:{score:0,note:null,name:'Zoë🙂'}});
    expect(vi.mocked(host.complete).mock.calls[0]?.[1]).toMatch(/Return only one JSON value matching this required data schema/);
    expect(new Engine(storage,host).status(actor(),valid.id).result).toBe(0);
    for(const id of ['schema-wrong-shape','schema-prose','schema-missing']){const run=await engine.test(actor(),d,input,id);expect(run.state).toBe('failed');expect(run.outputs).not.toHaveProperty('summary');}
  });
});
