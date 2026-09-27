import {describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {canonicalDigest,createPortablePackage,exportPortableTemplate,parsePortablePackage,previewPortableImport,type PortableJson} from '../src/portability.js';
import {PortablePackageControls} from '../src/portability-ui.js';
import {defaultBudgets} from '../src/budgets.js';
import {Engine,type Actor,type Storage} from '../src/engine.js';
import {validateState,SqliteStorage} from '../src/storage.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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
    const imported=engine.packageImport(actor,exported,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
    expect(imported.imported).toEqual([{id:`import-${exported.digest.slice(0,12)}-1`,slug:'portable-engine-imported',revision:1,enabled:false}]);
    expect(engine.load(actor,'portable-engine').definition).toMatchObject({slug:'portable-engine',revision:1});
    expect(engine.load(actor,imported.imported[0]!.id)).toMatchObject({enabledRevision:null,definition:{slug:'portable-engine-imported',revision:1}});
    expect(new Engine(storage,host).load(actor,imported.imported[0]!.id)).toMatchObject({enabledRevision:null,definition:{slug:'portable-engine-imported',revision:1}});
    expect(()=>engine.packageImport(actor,exported,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false)).toThrow(/changed since preview/);
  });

  it('requires a fresh inspected confirmation when typed environment values change',()=>{
    let state:ReturnType<Storage['read']>;
    const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const host={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn(async()=>({provider:'test',model:'test'}))};
    const engine=new Engine(storage,host),actor:Actor={agentId:'main',sessionKey:'agent:main:portable-environment',sessionId:'portable-environment',source:'tool',human:false,canManage:true,check:()=>{}};
    const sourceDefinition={...structuredClone(examples[0]),id:'portable-environment-source',slug:'portable-environment-source',revision:0};
    engine.save(actor,sourceDefinition,0,false);
    const source=engine.packageExport(actor,'portable-environment-source',[{name:'loop_name',type:'string',pointer:'/name'}]),preview=engine.packagePreview(actor,source,{loop_name:'Inspected value'}),before=engine.library(actor),prospectiveId=`import-${source.digest.slice(0,12)}-1`;
    expect(()=>engine.packageImport(actor,source,{loop_name:'Tampered value'},preview.digest,preview.libraryDigest,preview.resolvedDigest,false)).toThrow(/resolved environment.*changed since preview/i);
    expect(engine.library(actor)).toEqual(before);
    expect(()=>engine.load(actor,prospectiveId)).toThrow(/Loop not found/);
    const confirmed=engine.packagePreview(actor,source,{loop_name:'Tampered value'}),imported=engine.packageImport(actor,source,{loop_name:'Tampered value'},confirmed.digest,confirmed.libraryDigest,confirmed.resolvedDigest,false);
    expect(engine.load(actor,imported.imported[0]!.id).definition.name).toBe('Tampered value');
  });

  it('invalidates a preview when an older published slug stops reserving its import target',()=>{
    let state:ReturnType<Storage['read']>;
    const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const host={check:vi.fn(),complete:vi.fn(),modelInfo:vi.fn(async()=>({provider:'test',model:'test'}))};
    const engine=new Engine(storage,host),actor:Actor={agentId:'main',sessionKey:'agent:main:portable-publication',sessionId:'portable-publication',source:'tool',human:false,canManage:true,check:()=>{}};
    const initial={...structuredClone(examples[0]),id:'portable-published-collision',slug:'portable-source-imported',revision:0};
    const saved=engine.save(actor,initial,0,true);
    engine.draft(actor,{...saved.record.definition,slug:'portable-published-draft'},1);
    const sourceDefinition={...structuredClone(examples[0]),id:'portable-template-source',slug:'portable-source',revision:0};
    engine.save(actor,sourceDefinition,0,false);
    const source=engine.packageExport(actor,'portable-template-source',[{name:'loop_name',type:'string',pointer:'/name'}]),preview=engine.packagePreview(actor,source,{loop_name:'Published collision'}),prospectiveId=`import-${source.digest.slice(0,12)}-1`;
    expect(preview.templates[0]!.definition).toMatchObject({slug:'portable-source-imported-2'});
    engine.publish(actor,'portable-published-collision',2,2);
    const afterPublish=engine.packagePreview(actor,source,{loop_name:'Published collision'});
    expect(afterPublish.libraryDigest).not.toBe(preview.libraryDigest);
    expect(afterPublish.templates[0]!.definition).toMatchObject({slug:'portable-source-imported'});
    const libraryAfterPublish=engine.library(actor);
    expect(()=>engine.packageImport(actor,source,{loop_name:'Published collision'},preview.digest,preview.libraryDigest,preview.resolvedDigest,false)).toThrow(/target library changed since preview/i);
    expect(engine.library(actor)).toEqual(libraryAfterPublish);
    expect(()=>engine.load(actor,prospectiveId)).toThrow(/Loop not found/);
    const imported=engine.packageImport(actor,source,{loop_name:'Published collision'},afterPublish.digest,afterPublish.libraryDigest,afterPublish.resolvedDigest,false);
    expect(engine.load(actor,imported.imported[0]!.id).definition.slug).toBe('portable-source-imported');
  });

  it('does not leave a partial multi-template import when its one state transaction fails',()=>{
    let state:ReturnType<Storage['read']>,fail=false;
    const storage:Storage={read:()=>structuredClone(state),write:value=>{if(fail)throw Error('injected storage failure');state=structuredClone(value);}};
    const engine=new Engine(storage,{check:()=>{},complete:vi.fn(),modelInfo:vi.fn(async()=>({provider:'test',model:'test'}))}),actor:Actor={agentId:'main',sessionKey:'agent:main:atomic',sessionId:'atomic',source:'tool',human:false,canManage:true,check:()=>{}};
    const first={...structuredClone(examples[0]),id:'atomic-first',slug:'atomic-first',revision:1} as unknown as PortableJson,second={...structuredClone(examples[0]),id:'atomic-second',slug:'atomic-second',revision:1,name:'Second'} as unknown as PortableJson;
    const source=createPortablePackage({templates:[{templateId:'first',content:first,dependencies:[]},{templateId:'second',content:second,dependencies:[]}],bindings:[]}),preview=engine.packagePreview(actor,source,{});fail=true;
    expect(()=>engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false)).toThrow();
    expect(engine.library(actor).some(loop=>loop.slug.includes('imported'))).toBe(false);
  });

  it('previews valid bounded target slugs even with many collisions',()=>{
    let state:ReturnType<Storage['read']>;const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const engine=new Engine(storage,{check:()=>{},complete:vi.fn(),modelInfo:vi.fn()}),actor:Actor={agentId:'main',sessionKey:'agent:main:long-slug',sessionId:'long-slug',source:'tool',human:false,canManage:true,check:()=>{}};
    const longSlug=`a${'b'.repeat(47)}`,sourceDefinition={...structuredClone(examples[0]),id:'portable-long-source',slug:longSlug,revision:0};
    engine.save(actor,sourceDefinition,0,false);const source=engine.packageExport(actor,sourceDefinition.id);
    for(let index=1;index<=10;index++){
      const preview=engine.packagePreview(actor,source,{}),slug=preview.templates[0]!.definition as {slug:string};
      expect(slug.slug.length).toBeLessThanOrEqual(48);
      engine.save(actor,{...structuredClone(examples[0]),id:`portable-collision-${index}`,slug:slug.slug,revision:0},0,false);
    }
    const preview=engine.packagePreview(actor,source,{}),slug=(preview.templates[0]!.definition as {slug:string}).slug;
    expect(slug).toMatch(/-imported-11$/);expect(slug.length).toBeLessThanOrEqual(48);
    expect(preview.templates[0]!.validation).toMatchObject({valid:true,issues:[]});
    const imported=engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
    expect(imported.imported[0]!.slug).toBe(slug);
  });

  it('reports graph diagnostics for resolved drafts while still permitting draft import',()=>{
    let state:ReturnType<Storage['read']>;const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const engine=new Engine(storage,{check:()=>{},complete:vi.fn(),modelInfo:vi.fn()}),actor:Actor={agentId:'main',sessionKey:'agent:main:invalid-draft',sessionId:'invalid-draft',source:'tool',human:false,canManage:true,check:()=>{}};
    const invalid={...structuredClone(examples[0]),id:'portable-invalid',slug:'portable-invalid',revision:0,edges:[]};
    engine.save(actor,invalid,0,false);const source=engine.packageExport(actor,invalid.id),preview=engine.packagePreview(actor,source,{});
    expect(preview.templates[0]!.validation?.valid).toBe(false);
    expect(preview.templates[0]!.validation?.issues.length).toBeGreaterThan(0);
    const imported=engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
    expect(engine.load(actor,imported.imported[0]!.id).enabledRevision).toBeNull();
  });

  it('retains one bounded source bundle and per-template provenance after source deletion and restart',()=>{
    let state:ReturnType<Storage['read']>;const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const host={check:()=>{},complete:vi.fn(),modelInfo:vi.fn()},actor:Actor={agentId:'main',sessionKey:'agent:main:provenance',sessionId:'provenance',source:'tool',human:false,canManage:true,check:()=>{}};
    const engine=new Engine(storage,host),first={...structuredClone(examples[0]),id:'portable-dependency',slug:'portable-dependency',revision:1},second={...structuredClone(examples[0]),id:'portable-target',slug:'portable-target',revision:1,name:{$loopsBinding:'target_name'}};
    const source=createPortablePackage({templates:[{templateId:'dependency',content:first as unknown as PortableJson,dependencies:[]},{templateId:'target',content:second as unknown as PortableJson,dependencies:[{templateId:'dependency',digest:canonicalDigest(first as unknown as PortableJson)}]}],bindings:[{name:'target_name',type:'string',locations:[{templateId:'target',pointer:'/name'}]}]});
    const preview=engine.packagePreview(actor,source,{target_name:'Bound target'}),imported=engine.packageImport(actor,source,{target_name:'Bound target'},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
    const [sourceId,siblingId]=imported.imported.map(item=>item.id);const sourceRecord=engine.load(actor,sourceId!),sibling=engine.load(actor,siblingId!);
    expect(sourceRecord.portableProvenance?.sourcePackage).toEqual(source);expect(sibling.portableProvenance?.sourcePackage).toBeUndefined();
    expect(sibling.portableProvenance).toMatchObject({revision:1,templateId:'target',sourceRecordId:sourceId,packageDigest:source.digest,bindings:source.bindings});
    engine.delete(actor,sourceId!,1);validateState(storage.read());
    const damaged=structuredClone(storage.read())!;damaged.loops[siblingId!]!.portableProvenance!.sourceRecordId='missing-source';
    expect(()=>validateState(damaged)).toThrow(/portable provenance/);
    const reopened=new Engine(storage,host);expect(reopened.packageExport(actor,siblingId!)).toEqual(source);
    reopened.archive(actor,siblingId!,1,true);expect(reopened.packageExport(actor,siblingId!)).toEqual(source);
    const changed={...reopened.load(actor,siblingId!).definition,name:'Edited local revision'};reopened.save(actor,changed,1,false);
    expect(reopened.packageExport(actor,siblingId!).bindings).toEqual([{name:'target_name',type:'string',locations:[{templateId:'loop',pointer:'/name'}]}]);
  });

  it('keeps an active non-indexed completion attached to durable state during import',async()=>{
    let state:ReturnType<Storage['read']>;const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    let settle:(value:{text:string})=>void=()=>{};
    const host={check:()=>{},complete:vi.fn(()=>new Promise<{text:string}>(resolve=>{settle=resolve;})),modelInfo:vi.fn(async()=>({provider:'fake',model:'fake'}))};
    const actor:Actor={agentId:'main',sessionKey:'agent:main:active-import',sessionId:'active-import',source:'tool',human:false,canManage:true,check:()=>{}};
    const engine=new Engine(storage,host,{replyTimeoutMs:1}),sourceDefinition={...structuredClone(examples[0]),id:'portable-active',slug:'portable-active',revision:0};
    engine.save(actor,sourceDefinition,0,true);const source=engine.packageExport(actor,sourceDefinition.id),running=await engine.run(actor,sourceDefinition.slug,{text:'Input'},'portable-running');
    expect(running.state).toBe('running');const preview=engine.packagePreview(actor,source,{});engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
    settle({text:'Completed after import'});await vi.waitFor(()=>expect(engine.status(actor,running.id).state).toBe('completed'));
    expect(new Engine(storage,host).status(actor,running.id)).toMatchObject({state:'completed',result:'Completed after import'});
    await engine.close();
  });

  it('keeps indexed cancellation authoritative when an import lands during a host call',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-portable-cancel-')),file=join(directory,'loops.sqlite');let storage:SqliteStorage|undefined;
    try{
      storage=new SqliteStorage(file);let settle:(value:{text:string})=>void=()=>{};
      const host={check:()=>{},complete:vi.fn(()=>new Promise<{text:string}>(resolve=>{settle=resolve;})),modelInfo:vi.fn(async()=>({provider:'fake',model:'fake'}))};
      const actor:Actor={agentId:'main',sessionKey:'agent:main:sqlite-import',sessionId:'sqlite-import',source:'tool',human:false,canManage:true,check:()=>{}};
      const engine=new Engine(storage,host,{replyTimeoutMs:1}),sourceDefinition={...structuredClone(examples[0]),id:'portable-sqlite',slug:'portable-sqlite',revision:0};
      engine.save(actor,sourceDefinition,0,true);const source=engine.packageExport(actor,sourceDefinition.id),running=await engine.run(actor,sourceDefinition.slug,{text:'Input'},'portable-sqlite-running');
      expect(running.state).toBe('running');const preview=engine.packagePreview(actor,source,{});engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
      expect(engine.cancel(actor,running.id).state).toBe('cancelled');settle({text:'Late host completion'});
      await vi.waitFor(()=>{const finished=engine.status(actor,running.id);expect(finished.state).toBe('cancelled');expect(finished.cleanupPending).not.toBe(true);});
      await engine.close();await storage.close();
      storage=new SqliteStorage(file);expect(new Engine(storage,host).status(actor,running.id).state).toBe('cancelled');
    }finally{await storage?.close();rmSync(directory,{recursive:true,force:true});}
  });
  it('preserves active and queued run ownership through import and later completion',async()=>{
    let state:ReturnType<Storage['read']>;const storage:Storage={read:()=>structuredClone(state),write:value=>{state=structuredClone(value);}};
    const releases:Array<(value:{text:string})=>void>=[];
    const host={check:()=>{},complete:vi.fn(()=>new Promise<{text:string}>(resolve=>{releases.push(resolve);})),modelInfo:vi.fn(async()=>({provider:'fake',model:'fake'}))};
    const actor:Actor={agentId:'main',sessionKey:'agent:main:queued-import',sessionId:'queued-import',source:'tool',human:false,canManage:true,check:()=>{}};
    const engine=new Engine(storage,host,{replyTimeoutMs:1,concurrency:1}),sourceDefinition={...structuredClone(examples[0]),id:'portable-queued',slug:'portable-queued',revision:0};
    engine.save(actor,sourceDefinition,0,true);const first=await engine.run(actor,sourceDefinition.slug,{text:'First'},'queued-first');
    const second=await engine.run(actor,sourceDefinition.slug,{text:'Second'},'queued-second');expect(first.state).toBe('running');expect(second.state).toBe('queued');
    const source=engine.packageExport(actor,sourceDefinition.id),preview=engine.packagePreview(actor,source,{});engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
    releases[0]!({text:'First complete'});await vi.waitFor(()=>expect(releases).toHaveLength(2));
    releases[1]!({text:'Second complete'});await vi.waitFor(()=>expect(engine.status(actor,second.id).state).toBe('completed'));
    expect(new Engine(storage,host).status(actor,first.id).state).toBe('completed');expect(new Engine(storage,host).status(actor,second.id).state).toBe('completed');await engine.close();
  });

  it('rolls back a failed import while a host call is active without orphaning its run',async()=>{
    let state:ReturnType<Storage['read']>,failOnce=false;const storage:Storage={read:()=>structuredClone(state),write:value=>{if(failOnce){failOnce=false;throw Error('injected import commit failure');}state=structuredClone(value);}};
    let settle:(value:{text:string})=>void=()=>{};
    const host={check:()=>{},complete:vi.fn(()=>new Promise<{text:string}>(resolve=>{settle=resolve;})),modelInfo:vi.fn(async()=>({provider:'fake',model:'fake'}))};
    const actor:Actor={agentId:'main',sessionKey:'agent:main:failed-import',sessionId:'failed-import',source:'tool',human:false,canManage:true,check:()=>{}};
    const engine=new Engine(storage,host,{replyTimeoutMs:1}),sourceDefinition={...structuredClone(examples[0]),id:'portable-fault',slug:'portable-fault',revision:0};
    engine.save(actor,sourceDefinition,0,true);const source=engine.packageExport(actor,sourceDefinition.id),running=await engine.run(actor,sourceDefinition.slug,{text:'Input'},'failed-import-run');
    expect(running.state).toBe('running');const preview=engine.packagePreview(actor,source,{});failOnce=true;
    expect(()=>engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false)).toThrow(/injected import commit failure/);
    expect(engine.library(actor).some(item=>item.slug.endsWith('-imported'))).toBe(false);
    settle({text:'Late completion'});await vi.waitFor(()=>expect(engine.status(actor,running.id).state).not.toBe('running'));
    const live=engine.status(actor,running.id),reopened=new Engine(storage,host).status(actor,running.id);
    expect(reopened.state).toBe(live.state);expect(reopened.trace).toEqual(live.trace);await engine.close();
  });

  it('keeps indexed shutdown interruption attached to a settling imported run',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'loops-portable-shutdown-')),file=join(directory,'loops.sqlite');let storage:SqliteStorage|undefined;
    try{
      storage=new SqliteStorage(file);let settle:(value:{text:string})=>void=()=>{};
      const host={check:()=>{},complete:vi.fn(()=>new Promise<{text:string}>(resolve=>{settle=resolve;})),modelInfo:vi.fn(async()=>({provider:'fake',model:'fake'}))};
      const actor:Actor={agentId:'main',sessionKey:'agent:main:sqlite-shutdown',sessionId:'sqlite-shutdown',source:'tool',human:false,canManage:true,check:()=>{}};
      const engine=new Engine(storage,host,{replyTimeoutMs:1}),sourceDefinition={...structuredClone(examples[0]),id:'portable-shutdown',slug:'portable-shutdown',revision:0};
      engine.save(actor,sourceDefinition,0,true);const source=engine.packageExport(actor,sourceDefinition.id),running=await engine.run(actor,sourceDefinition.slug,{text:'Input'},'portable-shutdown-running');
      expect(running.state).toBe('running');const preview=engine.packagePreview(actor,source,{});engine.packageImport(actor,source,{},preview.digest,preview.libraryDigest,preview.resolvedDigest,false);
      const closing=engine.close();settle({text:'Late host completion'});await closing;await storage.close();
      storage=new SqliteStorage(file);expect(new Engine(storage,host).status(actor,running.id).state).toBe('interrupted');
    }finally{await storage?.close();rmSync(directory,{recursive:true,force:true});}
  });

});
