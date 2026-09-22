import {describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {canonicalDigest,createPortablePackage,exportPortableTemplate,parsePortablePackage,previewPortableImport,type PortableJson} from '../src/portability.js';
import {PortablePackageControls} from '../src/portability-ui.js';
import {defaultBudgets} from '../src/budgets.js';
import {Engine,type Actor,type Storage} from '../src/engine.js';
import {examples} from '../src/examples.js';

const description='A template that can mention credentials or /loops in ordinary text.';
const definition={schemaVersion:2,id:'portable-source',slug:'portable-source',name:{$loopsBinding:'loop_name'},description,inputSchema:[],nodes:[{id:'input',kind:'input',label:'Input'},{id:'return',kind:'return',label:'Return',value:'Done'}],edges:[{id:'edge',source:'input',target:'return',port:'next'}],layout:{input:{x:0,y:0},return:{x:100,y:0}},capabilities:[],limits:{maxExecutions:2,maxOutputBytes:128}} as unknown as PortableJson;
const packageValue=()=>createPortablePackage({templates:[{templateId:'starter',content:definition,dependencies:[]}],bindings:[{name:'loop_name',type:'string',locations:[{templateId:'starter',pointer:'/name'}]}]});

describe('portable template packages',()=>{
  it('uses canonical pins independent of object key order and round trips an explicit binding',()=>{
    expect(canonicalDigest({b:1,a:[true,null]})).toBe(canonicalDigest({a:[true,null],b:1}));
    const source=packageValue(),parsed=parsePortablePackage(JSON.parse(JSON.stringify(source)));
    expect(parsed.digest).toBe(source.digest);
    const preview=previewPortableImport(source,{loop_name:'Imported draft'});
    expect(preview).toMatchObject({digest:source.digest,templates:[{templateId:'starter',definition:{name:'Imported draft',description}}]});
    expect(preview.templates[0]!.definition).not.toBe(definition);
  });

  it('pins included dependencies and rejects a stale pin or cyclic graph',()=>{
    const dependency={...(structuredClone(definition) as Record<string,PortableJson>),id:'portable-dependency',slug:'portable-dependency',name:'Dependency'} as PortableJson;
    const dependencyDigest=canonicalDigest(dependency);
    const source=createPortablePackage({templates:[{templateId:'dependency',content:dependency,dependencies:[]},{templateId:'starter',content:definition,dependencies:[{templateId:'dependency',digest:dependencyDigest}]}],bindings:[{name:'loop_name',type:'string',locations:[{templateId:'starter',pointer:'/name'}]}]});
    expect(parsePortablePackage(source).templates).toHaveLength(2);
    const stale=structuredClone(source);stale.templates[1]!.dependencies[0]!.digest='0'.repeat(64);stale.digest=canonicalDigest({kind:stale.kind,formatVersion:stale.formatVersion,templates:stale.templates,bindings:stale.bindings});
    expect(()=>parsePortablePackage(stale)).toThrow(/stale pin/);
    const cyclic=structuredClone(source);cyclic.templates[0]!.dependencies=[{templateId:'starter',digest:cyclic.templates[1]!.contentDigest}];cyclic.digest=canonicalDigest({kind:cyclic.kind,formatVersion:cyclic.formatVersion,templates:cyclic.templates,bindings:cyclic.bindings});
    expect(()=>parsePortablePackage(cyclic)).toThrow(/cycle/);
  });

  it('rejects modified content, injected runtime authority and unresolved environment values',()=>{
    const source=packageValue();
    const changed=structuredClone(source);(changed.templates[0]!.content as Record<string,PortableJson>).description='changed';
    expect(()=>parsePortablePackage(changed)).toThrow(/contentDigest/);
    const injected=structuredClone(source);(injected.templates[0]!.content as Record<string,PortableJson>).grants=[];injected.templates[0]!.contentDigest=canonicalDigest(injected.templates[0]!.content);injected.digest=canonicalDigest({kind:injected.kind,formatVersion:injected.formatVersion,templates:injected.templates,bindings:injected.bindings});
    expect(()=>parsePortablePackage(injected)).toThrow(/runtime metadata/);
    expect(()=>previewPortableImport(source,{})).toThrow(/Missing environment binding/);
    expect(()=>previewPortableImport(source,{loop_name:42})).toThrow(/must be a string/);
    expect(()=>previewPortableImport(source,{loop_name:'ok',unknown:true})).toThrow(/Unknown environment binding/);
  });

  it('rejects digest changes, conflicts and undeclared marker locations before any import can apply',()=>{
    const source=packageValue();const changed=structuredClone(source);changed.digest='f'.repeat(64);
    expect(()=>parsePortablePackage(changed)).toThrow(/Package digest/);
    const conflict=structuredClone(source);conflict.bindings.push({name:'another',type:'string',locations:[{templateId:'starter',pointer:'/name'}]});conflict.digest=canonicalDigest({kind:conflict.kind,formatVersion:conflict.formatVersion,templates:conflict.templates,bindings:conflict.bindings});
    expect(()=>parsePortablePackage(conflict)).toThrow(/conflict/);
    const unknown=structuredClone(source);(unknown.templates[0]!.content as Record<string,PortableJson>).description={$loopsBinding:'missing'};unknown.templates[0]!.contentDigest=canonicalDigest(unknown.templates[0]!.content);unknown.digest=canonicalDigest({kind:unknown.kind,formatVersion:unknown.formatVersion,templates:unknown.templates,bindings:unknown.bindings});
    expect(()=>parsePortablePackage(unknown)).toThrow(/undeclared binding/);
  });

  it('does not allow a declared environment value to replace an identity or authority field',()=>{
    const source=packageValue();const attempted=structuredClone(source);
    (attempted.templates[0]!.content as Record<string,PortableJson>).id={$loopsBinding:'loop_name'};
    attempted.bindings[0]!.locations=[{templateId:'starter',pointer:'/id'}];attempted.templates[0]!.contentDigest=canonicalDigest(attempted.templates[0]!.content);attempted.digest=canonicalDigest({kind:attempted.kind,formatVersion:attempted.formatVersion,templates:attempted.templates,bindings:attempted.bindings});
    expect(()=>parsePortablePackage(attempted)).toThrow(/identity or runtime authority/);
  });

  it('preserves a future schema verbatim while resolving named values with their declared JSON types',()=>{
    const future={schemaVersion:3,id:'portable-v3',slug:'portable-v3',name:{$loopsBinding:'name'},environment:{limit:{$loopsBinding:'limit'},enabled:{$loopsBinding:'enabled'},labels:{$loopsBinding:'labels'},'path/name~key':{$loopsBinding:'workspace'}},nodes:[{workspace:{$loopsBinding:'workspace'}}],unknownFutureField:{keep:'all bytes',workspace:'/ordinary-user-data'}} as unknown as PortableJson;
    const source=createPortablePackage({templates:[{templateId:'future',content:future,dependencies:[]}],bindings:[
      {name:'name',type:'string',locations:[{templateId:'future',pointer:'/name'}]},
      {name:'limit',type:'number',locations:[{templateId:'future',pointer:'/environment/limit'}]},
      {name:'enabled',type:'boolean',locations:[{templateId:'future',pointer:'/environment/enabled'}]},
      {name:'labels',type:'json',locations:[{templateId:'future',pointer:'/environment/labels'}]},
      {name:'workspace',type:'string',locations:[{templateId:'future',pointer:'/environment/path~1name~0key'},{templateId:'future',pointer:'/nodes/0/workspace'}]},
    ]});
    const preview=previewPortableImport(source,{name:'Future loop',limit:3,enabled:true,labels:['qa',{region:'local'}],workspace:'configured-workspace'});
    expect(preview.templates[0]!.definition).toEqual({schemaVersion:3,id:'portable-v3',slug:'portable-v3',name:'Future loop',environment:{limit:3,enabled:true,labels:['qa',{region:'local'}],'path/name~key':'configured-workspace'},nodes:[{workspace:'configured-workspace'}],unknownFutureField:{keep:'all bytes',workspace:'/ordinary-user-data'}});
  });

  it('rejects unsafe pointers and packages beyond the existing transport or nesting budgets',()=>{
    const source=packageValue(),unsafe=structuredClone(source);unsafe.bindings[0]!.locations[0]!.pointer='/__proto__';unsafe.digest=canonicalDigest({kind:unsafe.kind,formatVersion:unsafe.formatVersion,templates:unsafe.templates,bindings:unsafe.bindings});
    expect(()=>parsePortablePackage(unsafe)).toThrow(/safe JSON pointer/);
    let deep:PortableJson='leaf';for(let index=0;index<129;index++)deep=[deep];
    expect(()=>createPortablePackage({templates:[{templateId:'deep',content:deep,dependencies:[]}],bindings:[]},{...defaultBudgets,definitionBytes:4096})).toThrow(/nesting budget/);
    expect(()=>createPortablePackage({templates:[{templateId:'large',content:'x'.repeat(129),dependencies:[]}],bindings:[]},{...defaultBudgets,definitionBytes:64,inputBytes:32})).toThrow(/transport budget/);
  });

  it('renders graphical export, preview, and inspected-import controls without a hidden authority path',()=>{
    const source=packageValue();
    const html=renderToStaticMarkup(createElement(PortablePackageControls,{controls:{exportPackage:async()=>source,previewImport:async()=>({...previewPortableImport(source,{loop_name:'Preview'}),libraryDigest:'0'.repeat(64)}),importPackage:async()=>({imported:[]})}}));
    expect(html).toContain('Export package');expect(html).toContain('Export bindings');expect(html).toContain('Binding JSON Pointer');expect(html).toContain('Preview import');expect(html).toContain('Import inspected package');expect(html).toContain('Portable environment bindings JSON');
  });

  it('authors an exact export binding before its typed environment value is previewed',()=>{
    const source=exportPortableTemplate(definition,[{name:'loop_name',type:'string',pointer:'/name'}]);
    expect(source.bindings).toEqual([{name:'loop_name',type:'string',locations:[{templateId:'loop',pointer:'/name'}]}]);
    expect(previewPortableImport(source,{loop_name:'Bound import'}).templates[0]!.definition).toMatchObject({name:'Bound import'});
    expect(()=>exportPortableTemplate(definition,[{name:'bad',type:'string',pointer:'/__proto__'}])).toThrow(/safe JSON pointer/);
  });

  it('exports, previews and atomically imports a distinct local draft through current author authority',()=>{
    let state:ReturnType<Storage['read']>;
    const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const host={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn(async()=>({provider:'test',model:'test'}))};
    const engine=new Engine(storage,host),actor:Actor={agentId:'main',sessionKey:'agent:main:portable',sessionId:'portable',source:'tool',human:false,canManage:true,check:()=>{}};
    const original={...structuredClone(examples[0]),id:'portable-engine',slug:'portable-engine',revision:0};engine.save(actor,original,0,true);
    const exported=engine.packageExport(actor,'portable-engine');expect(JSON.stringify(exported)).not.toMatch(/grants|sessionId|caller/i);
    const preview=engine.packagePreview(actor,exported,{});expect(preview.templates[0]!.definition).toMatchObject({id:`import-${exported.digest.slice(0,12)}-1`,slug:'portable-engine-imported',revision:0});
    const imported=engine.packageImport(actor,exported,{},preview.digest,preview.libraryDigest,false);
    expect(imported.imported).toEqual([{id:`import-${exported.digest.slice(0,12)}-1`,slug:'portable-engine-imported',revision:1,enabled:false}]);
    expect(engine.load(actor,'portable-engine').definition).toMatchObject({slug:'portable-engine',revision:1});
    expect(engine.load(actor,imported.imported[0]!.id)).toMatchObject({enabledRevision:null,definition:{slug:'portable-engine-imported',revision:1}});
    expect(new Engine(storage,host).load(actor,imported.imported[0]!.id)).toMatchObject({enabledRevision:null,definition:{slug:'portable-engine-imported',revision:1}});
    expect(()=>engine.packageImport(actor,exported,{},preview.digest,preview.libraryDigest,false)).toThrow(/changed since preview/);
  });

  it('does not leave a partial multi-template import when its one state transaction fails',()=>{
    let state:ReturnType<Storage['read']>,fail=false;
    const storage:Storage={read:()=>structuredClone(state),write:value=>{if(fail)throw Error('injected storage failure');state=structuredClone(value);}};
    const engine=new Engine(storage,{check:()=>{},complete:vi.fn(),modelInfo:vi.fn(async()=>({provider:'test',model:'test'}))}),actor:Actor={agentId:'main',sessionKey:'agent:main:atomic',sessionId:'atomic',source:'tool',human:false,canManage:true,check:()=>{}};
    const first={...structuredClone(examples[0]),id:'atomic-first',slug:'atomic-first',revision:1} as unknown as PortableJson,second={...structuredClone(examples[0]),id:'atomic-second',slug:'atomic-second',revision:1,name:'Second'} as unknown as PortableJson;
    const source=createPortablePackage({templates:[{templateId:'first',content:first,dependencies:[]},{templateId:'second',content:second,dependencies:[]}],bindings:[]}),preview=engine.packagePreview(actor,source,{});fail=true;
    expect(()=>engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,false)).toThrow();
    expect(engine.library(actor).some(loop=>loop.slug.includes('imported'))).toBe(false);
  });
});
