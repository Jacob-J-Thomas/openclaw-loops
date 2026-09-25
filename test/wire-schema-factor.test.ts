import {describe,expect,it} from 'vitest';
import {Type,type TSchema} from 'typebox';
import {Value} from 'typebox/value';
// @ts-expect-error OpenClaw exports this public runtime helper as JavaScript.
import {validateJsonSchemaValue} from 'openclaw/plugin-sdk/json-schema-runtime';
import {contract} from '../src/contract.js';
import {dataSchemaIssues,type DataSchema} from '../src/data-schema.js';
import {examples} from '../src/examples.js';
import {parseDefinition,parseDefinitionContent,parseDefinitionPatch,validateGraph,type Definition} from '../src/graph.js';
import {compactToolInput} from '../src/tool-schema.js';
import {factorStrictToolInput,UploadReferenceSchema,uploadFields,wireContract,withRecursiveDataSchemaWire} from '../src/wire-contract.js';

type Operation='create'|'edit'|'draft'|'save'|'validate'|'test';
const operations:Operation[]=['create','edit','draft','save','validate','test'];
const count=(value:unknown,depth=0,result={nodes:0,maxDepth:0})=>{
  result.nodes++;result.maxDepth=Math.max(result.maxDepth,depth);
  if(value&&typeof value==='object')for(const child of Object.values(value))count(child,depth+1,result);
  return result;
};
const references=(value:unknown,result=new Set<string>())=>{
  if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
    if(key==='$ref'&&typeof child==='string')result.add(child);
    else references(child,result);
  }
  return [...result].sort();
};
const unfactored=(operation:Operation):TSchema=>{
  const input=structuredClone(contract.operations[operation].input) as TSchema&{properties:Record<string,TSchema>};
  for(const field of uploadFields[operation]??[])input.properties[field]=Type.Union([input.properties[field]!,UploadReferenceSchema]);
  return compactToolInput(withRecursiveDataSchemaWire(input));
};
const baseline=Object.fromEntries(operations.map(operation=>[operation,unfactored(operation)])) as Record<Operation,TSchema>;
const projected=Object.fromEntries(operations.map(operation=>[operation,wireContract.operations[operation].input])) as Record<Operation,TSchema>;
const accepted=(schema:TSchema,operation:Operation,source:'old'|'new',value:unknown)=>{
  const typebox=Value.Check(schema,value);
  const publicSdk=validateJsonSchemaValue({schema,cacheKey:`issue296-${source}-${operation}`,value}).ok;
  expect(typebox,`${operation}/${source} validator disagreement`).toBe(publicSdk);
  return typebox;
};
const parity=(operation:Operation,value:unknown,expected:boolean)=>{
  expect(accepted(baseline[operation],operation,'old',value),`${operation} canonical wire`).toBe(expected);
  expect(accepted(projected[operation],operation,'new',value),`${operation} factored wire`).toBe(expected);
};
const definition=(version:1|2|3):Definition=>{
  const value=structuredClone(examples[0]);
  value.schemaVersion=version;value.id=`wire-${version}`;value.slug=`wire-${version}`;value.revision=0;
  if(version===1)value.limits.timeoutMs??=120000;
  return value;
};
const content=(version:2|3)=>{
  const {id:_id,revision:_revision,...value}=definition(version);
  return value;
};
const payload=(operation:Operation,value:unknown)=>operation==='create'?{definition:value}:operation==='edit'?{id:'candidate',expectedRevision:1,changes:value}:operation==='draft'||operation==='save'?{definition:value,expectedRevision:0}:operation==='test'?{definition:value,input:{}}:{definition:value};
const full=['draft','save','validate','test'] as const;
const dataVariants:DataSchema[]=[
  {type:'object',properties:{items:{type:'array',items:{type:'integer',minimum:0}}},required:['items'],additionalProperties:false},
  {type:'array',items:{type:'string',minLength:1},minItems:1},
  {type:'string',minLength:1,pattern:'^[a-z]+$'},
  {type:'number',minimum:0,maximum:10},
  {type:'integer',minimum:0,maximum:10},
  {type:'boolean'},
  {type:'null'},
  {type:'json'},
];

describe('strict public tool wire factoring',()=>{
  it('projects only the generated operation inputs and stays below the released host registration limit',()=>{
    for(const operation of operations){
      const original=baseline[operation],snapshot=structuredClone(original);
      expect(factorStrictToolInput(original),operation).toEqual(projected[operation]);
      expect(original,`${operation} canonical input mutation`).toEqual(snapshot);
      const budget=count(projected[operation]);
      expect(budget.nodes,`${operation} nodes`).toBeLessThanOrEqual(2048);
      expect(budget.maxDepth,`${operation} depth`).toBeLessThanOrEqual(24);
      expect((projected[operation] as TSchema&{$defs?:unknown}).$defs).toBeDefined();
      const refs=references(projected[operation]);
      expect(refs).toEqual(references(original));
      const defs=(projected[operation] as TSchema&{$defs:Record<string,unknown>}).$defs;
      for(const ref of refs){
        expect(ref).toMatch(/^#\/\$defs\//);
        expect(Object.hasOwn(defs,ref.slice('#/$defs/'.length)),`${operation} unresolved ${ref}`).toBe(true);
      }
    }
    expect(count(projected.test).nodes).toBe(1703);
    expect(count(baseline.test).nodes).toBe(1857);
  });

  it('preserves all required full-definition fields, version discrimination, and unknown-field rejection',()=>{
    for(const version of [1,2,3] as const){
      const valid=definition(version);expect(parseDefinition(valid)).toEqual(valid);
      for(const operation of full){
        parity(operation,payload(operation,valid),true);
        const union=(baseline[operation] as TSchema&{properties:{definition:{anyOf:[{anyOf:Array<{properties:Record<string,unknown>;required:string[]}>}]}}}).properties.definition.anyOf[0];
        const variant=union.anyOf[version-1]!;
        for(const field of variant.required){
          const missing=structuredClone(valid) as unknown as Record<string,unknown>;delete missing[field];
          parity(operation,payload(operation,missing),false);
          expect(()=>parseDefinition(missing),`${operation}/v${version}/missing ${field}`).toThrow();
          const wrong=structuredClone(valid) as unknown as Record<string,unknown>;wrong[field]=null;
          parity(operation,payload(operation,wrong),false);
          expect(()=>parseDefinition(wrong),`${operation}/v${version}/null ${field}`).toThrow();
        }
        parity(operation,payload(operation,{...valid,alien:true}),false);
        parity(operation,payload(operation,{...valid,schemaVersion:4}),false);
        expect(()=>parseDefinition({...valid,alien:true})).toThrow();
        expect(()=>parseDefinition({...valid,schemaVersion:4})).toThrow();
      }
    }
  });

  it('keeps creation content and editable patch closed without granting server identity fields',()=>{
    for(const version of [2,3] as const){
      const valid=content(version);expect(parseDefinitionContent(valid)).toEqual(valid);
      parity('create',payload('create',valid),true);
      for(const field of Object.keys(valid)){
        if(field==='schemaVersion')continue; // optional default, not a required field
        const missing=structuredClone(valid) as Record<string,unknown>;delete missing[field];
        parity('create',payload('create',missing),false);
        expect(()=>parseDefinitionContent(missing),`missing ${field}`).toThrow();
        const wrong={...valid,[field]:null};parity('create',payload('create',wrong),false);
        expect(()=>parseDefinitionContent(wrong)).toThrow();
      }
      for(const field of Object.keys(valid)){
        const patch={[field]:(valid as Record<string,unknown>)[field]};
        parity('edit',payload('edit',patch),true);
        expect(parseDefinitionPatch(patch)).toEqual(patch);
        parity('edit',payload('edit',{[field]:null}),false);
        expect(()=>parseDefinitionPatch({[field]:null})).toThrow();
      }
      parity('create',payload('create',{...valid,alien:true}),false);
      parity('create',payload('create',{...valid,id:'forged'}),false);
      parity('create',payload('create',{...valid,revision:99}),false);
      expect(()=>parseDefinitionContent({...valid,alien:true})).toThrow();
      expect(()=>parseDefinitionContent({...valid,id:'forged'})).toThrow();
      expect(()=>parseDefinitionContent({...valid,revision:99})).toThrow();
    }
    for(const changes of [{},{alien:true},{id:'forged'},{revision:99},{name:null}]){
      parity('edit',payload('edit',changes),false);
      expect(()=>parseDefinitionPatch(changes)).toThrow();
    }
    parity('create',payload('create',{...content(3),schemaVersion:1}),false);
    parity('create',payload('create',{...content(3),schemaVersion:4}),false);
  });

  it('retains recursive data type discrimination, nested refs, and cross-kind rejection',()=>{
    for(const schema of dataVariants){
      expect(dataSchemaIssues(schema)).toEqual([]);
      const valid=definition(3);valid.inputSchema=[{name:'data',label:'Data',type:'json',required:true,schema}];
      const output=valid.nodes.find(node=>node.kind==='inference');if(!output||output.kind!=='inference')throw Error('missing inference');
      output.output='json';output.outputSchema=schema;
      for(const operation of full)parity(operation,payload(operation,valid),true);
      const created=content(3);created.inputSchema=valid.inputSchema;created.nodes=valid.nodes;
      parity('create',payload('create',created),true);
      parity('edit',payload('edit',{inputSchema:valid.inputSchema}),true);
    }
    const base=definition(3);base.inputSchema=[{name:'data',label:'Data',type:'json',required:true,schema:dataVariants[0]}];
    for(const badSchema of [
      {...dataVariants[0],alien:true},
      {...dataVariants[0],items:{type:'string'}},
      {type:'array',items:{type:'string'},properties:{bad:{type:'string'}}},
      {type:'string',properties:{bad:{type:'string'}}},
      {type:'number',minLength:2},
      {type:'json',minimum:0},
      {type:'unsupported'},
    ]){
      expect(dataSchemaIssues(badSchema).length).toBeGreaterThan(0);
      const invalid=structuredClone(base);invalid.inputSchema[0]!.schema=badSchema as DataSchema;
      expect(validateGraph(invalid).some(issue=>/schema/i.test(issue.message))).toBe(true);
      for(const operation of full)parity(operation,payload(operation,invalid),false);
      const created=content(3);created.inputSchema=invalid.inputSchema;
      parity('create',payload('create',created),false);
      parity('edit',payload('edit',{inputSchema:invalid.inputSchema}),false);
    }
  });

  it('preserves current v3 native node variants, nested Repeat, and exact context fields',()=>{
    const extraNodes=[
      ...structuredClone(examples[1].nodes).filter(node=>node.kind==='repeat'||node.kind==='review'||node.kind==='fail'||node.kind==='condition'),
      ...structuredClone(examples[2].nodes).filter(node=>node.kind==='action'||node.kind==='wait'),
      {id:'typed-condition',kind:'condition',label:'Typed condition',predicate:{left:'{{input.text}}',op:'truthy',right:'{{input.text}}'},condition:{value:'{{input.text}}',operator:'type-is',jsonType:'string'}},
      {id:'switch',kind:'switch',label:'Switch',value:'{{input.text}}',strategy:'unique',cases:[{id:'zero',label:'Zero',value:0},{id:'nil',label:'Null',value:null},{id:'false',label:'False',value:false},{id:'emoji',label:'Emoji',value:'🙂'}],default:true},
      {id:'evaluate',kind:'evaluate',label:'Evaluate',value:'{{input.text}}',evaluator:{kind:'json-schema-2020',version:'2020-12',schema:{type:'string'}}},
      {id:'gate',kind:'gate',label:'Gate',evaluationId:'evaluate'},
      {id:'context-return',kind:'return',label:'Return',value:'{{context.answer}}',context:{version:1,projection:{mode:'consume',paths:['/answer']},patch:{mode:'omit'}}},
    ];
    for(const node of extraNodes){
      const valid=definition(3);valid.nodes=[valid.nodes[0]!,node as Definition['nodes'][number],valid.nodes.at(-1)!];
      expect(Value.Check(baseline.test,payload('test',valid)),`native ${node.kind}/${node.id}`).toBe(true);
      parity('test',payload('test',valid),true);
      expect(parseDefinition(valid)).toEqual(valid);
      const unknown=structuredClone(valid);(unknown.nodes[1] as unknown as Record<string,unknown>).alien=true;
      parity('test',payload('test',unknown),false);
      expect(()=>parseDefinition(unknown)).toThrow();
      const cross=structuredClone(valid);(cross.nodes[1] as unknown as Record<string,unknown>).maxIterations=3;
      if(node.kind!=='repeat')parity('test',payload('test',cross),false);
    }
    const nested=definition(3);nested.nodes[0]!.context={version:1,projection:{mode:'omit'},patch:{mode:'replace',target:'/answer',source:{kind:'literal',value:{literalJson:'0'}}}};
    parity('test',payload('test',nested),true);
    const wrong=structuredClone(nested);(wrong.nodes[0]!.context!.patch as unknown as Record<string,unknown>).alien=true;
    parity('test',payload('test',wrong),false);
  });

  it('preserves upload references and declines to factor unrecognized generated shapes',()=>{
    const upload={$loopsUpload:'a'.repeat(64)};
    for(const operation of operations)parity(operation,operation==='edit'?{id:'candidate',expectedRevision:1,changes:upload}:operation==='draft'||operation==='save'?{definition:upload,expectedRevision:0}:operation==='test'?{definition:upload,input:{}}:{definition:upload},true);
    const modified=structuredClone(baseline.test) as TSchema&{properties:{definition:{anyOf:Array<{anyOf:Array<Record<string,unknown>>}>}};$defs:Record<string,Record<string,unknown>>};
    modified.properties.definition.anyOf[0]!.anyOf[0]!.allOf=[];
    modified.$defs.loops_data_schema.description='unexpected outer keyword';
    const projectedUnknown=factorStrictToolInput(modified);
    expect(projectedUnknown.properties.definition.anyOf[0]).toEqual(modified.properties.definition.anyOf[0]);
    expect(projectedUnknown.$defs.loops_data_schema).toEqual(modified.$defs.loops_data_schema);
    expect(modified.properties.definition.anyOf[0]!.anyOf[0]!.allOf).toEqual([]);
  });

  it('flattens only the already closed context-node wrapper when future vocabularies supply it',()=>{
    const old=Type.Object({node:Type.Ref('#/$defs/loops_context_node')}) as unknown as TSchema&{$defs:Record<string,unknown>};
    old.$defs={loops_context_node:{type:'object',properties:{id:{type:'string'}},required:['id'],allOf:[{anyOf:[
      {type:'object',properties:{kind:{const:'input'}},required:['kind']},
      {type:'object',properties:{kind:{const:'return'},value:{type:'string'}},required:['kind','value']},
    ]}],unevaluatedProperties:false}};
    const next=factorStrictToolInput(old);
    expect(next.$defs.loops_context_node).not.toEqual(old.$defs.loops_context_node);
    for(const [value,expected] of [
      [{node:{id:'one',kind:'input'}},true],
      [{node:{id:'two',kind:'return',value:'done'}},true],
      [{node:{id:'three',kind:'return'}},false],
      [{node:{id:'four',kind:'input',value:'cross-kind'}},false],
      [{node:{id:'five',kind:'return',value:'done',alien:true}},false],
    ] as const){
      expect(Value.Check(old,value)).toBe(expected);
      expect(Value.Check(next,value)).toBe(expected);
      expect(validateJsonSchemaValue({schema:old,cacheKey:'issue296-context-old',value}).ok).toBe(expected);
      expect(validateJsonSchemaValue({schema:next,cacheKey:'issue296-context-new',value}).ok).toBe(expected);
    }
    const unexpected=structuredClone(old) as TSchema&{$defs:{loops_context_node:{allOf:Array<Record<string,unknown>>}}};
    unexpected.$defs.loops_context_node.allOf[0]!.description='unrecognized';
    expect(factorStrictToolInput(unexpected).$defs.loops_context_node).toEqual(unexpected.$defs.loops_context_node);
  });

  it('leaves same-schema fields in their variants when requiredness differs',()=>{
    const variant=(version:number,required:string[],extra:string)=>({type:'object',properties:{schemaVersion:{const:version},name:{type:'string'},shared:{type:'integer'},[extra]:{type:'boolean'}},required,additionalProperties:false});
    const old={type:'object',properties:{definition:{anyOf:[{anyOf:[
      variant(1,['schemaVersion','name','shared'],'v1Only'),
      variant(2,['schemaVersion','name'],'v2Only'),
      variant(3,['schemaVersion','name','shared'],'v3Only'),
    ]},{type:'object',properties:{$loopsUpload:{type:'string'}},required:['$loopsUpload'],additionalProperties:false}]}},required:['definition'],additionalProperties:false} as TSchema;
    const next=factorStrictToolInput(old);
    const factored=(next as TSchema&{properties:{definition:{anyOf:[{properties:Record<string,unknown>;anyOf:Array<{properties:Record<string,unknown>}>}]}}}).properties.definition.anyOf[0];
    expect(factored.properties).not.toHaveProperty('shared');
    expect(factored.anyOf.every(variant=>Object.hasOwn(variant.properties,'shared'))).toBe(true);
    for(const [value,expected] of [
      [{definition:{schemaVersion:1,name:'one',shared:0}},true],
      [{definition:{schemaVersion:2,name:'two'}},true],
      [{definition:{schemaVersion:3,name:'three',shared:0}},true],
      [{definition:{schemaVersion:1,name:'one'}},false],
      [{definition:{schemaVersion:2,name:'two',v1Only:true}},false],
      [{definition:{schemaVersion:3,name:'three',shared:0,v2Only:true}},false],
      [{definition:{schemaVersion:3,name:'three',shared:0,alien:true}},false],
    ] as const){
      expect(Value.Check(old,value)).toBe(expected);
      expect(Value.Check(next,value)).toBe(expected);
      expect(validateJsonSchemaValue({schema:old,cacheKey:'issue296-requiredness-old',value}).ok).toBe(expected);
      expect(validateJsonSchemaValue({schema:next,cacheKey:'issue296-requiredness-new',value}).ok).toBe(expected);
    }
  });
});
