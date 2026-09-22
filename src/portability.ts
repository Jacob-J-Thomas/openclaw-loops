import {createHash} from 'node:crypto';
import {defaultBudgets,type Budgets} from './budgets.js';
import {requestError} from './errors.js';

export type PortableJson=null|boolean|number|string|PortableJson[]|{[key:string]:PortableJson};
export type BindingType='string'|'number'|'boolean'|'json';
export type PortableBindingLocation={templateId:string;pointer:string};
export type PortableBinding={name:string;type:BindingType;locations:PortableBindingLocation[]};
export type PortableDependency={templateId:string;digest:string};
export type PortableTemplate={templateId:string;content:PortableJson;contentDigest:string;dependencies:PortableDependency[]};
export type PortablePackage={kind:'loops-template-package';formatVersion:1;digest:string;templates:PortableTemplate[];bindings:PortableBinding[]};
export type PortablePackageDraft=Omit<PortablePackage,'digest'>;
export type PortableTemplateInput=Omit<PortableTemplate,'contentDigest'>;
export type PortablePackageInput={templates:PortableTemplateInput[];bindings:PortableBinding[]};
export type PortableBindingDeclaration={name:string;type:BindingType;pointer:string};
export type ResolvedPortableTemplate={templateId:string;contentDigest:string;definition:PortableJson;dependencies:PortableDependency[]};
export type PortablePreview={digest:string;templates:ResolvedPortableTemplate[];bindings:Array<{name:string;type:BindingType;locations:PortableBindingLocation[]}>};

const digestPattern=/^[a-f0-9]{64}$/;
const identifierPattern=/^[a-z][a-z0-9_-]{0,99}$/;
const pointerPattern=/^(?:\/(?:[A-Za-z0-9_-]|~[01])*)+$/;
const forbiddenDefinitionMetadata=new Set(['grants','runs','caller','callerid','actor','owner','sessionid','sessionkey','credentials','credential','authprofileid','runtimeconfig']);
const immutableBindingRoots=new Set(['id','slug','revision','schemaversion','capabilities','grants','runs','caller','callerid','actor','owner','sessionid','sessionkey','credentials','credential','authprofileid','runtimeconfig']);
const executionSettingKeys=new Set(['cwd','workspace','workspaceroot','rootdirectory','absolutepath']);
const maximumPackageDepth=128;

const fail=(message:string):never=>{throw requestError(message,'LOOPS_INVALID_REQUEST');};
const isObject=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const ownKeys=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const utf8Bytes=(value:string)=>new TextEncoder().encode(value).byteLength;

function checkJson(value:unknown,label:string,maxBytes:number):asserts value is PortableJson{
  let bytes=0;const seen=new WeakSet<object>(),pending:Array<{value:unknown;depth:number}>=[{value,depth:0}];
  const add=(count:number)=>{bytes+=count;if(bytes>maxBytes)fail(`${label} exceeds the configured ${maxBytes}-byte package transport budget.`);};
  while(pending.length){
    const current=pending.pop()!,item=current.value;
    if(current.depth>maximumPackageDepth)fail(`${label} exceeds the ${maximumPackageDepth}-level package nesting budget.`);
    if(item===null||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item)){add(utf8Bytes(JSON.stringify(item)));continue;}
    if(typeof item==='string'){add(utf8Bytes(JSON.stringify(item)));continue;}
    if(Array.isArray(item)){
      if(seen.has(item))fail(`${label} must not contain a JSON cycle.`);seen.add(item);add(2+Math.max(0,item.length-1));
      for(const child of item)pending.push({value:child,depth:current.depth+1});continue;
    }
    if(!isObject(item))fail(`${label} must be finite JSON.`);
    const object=item as Record<string,unknown>;
    if(seen.has(object))fail(`${label} must not contain a JSON cycle.`);seen.add(object);
    const entries=Object.entries(object);add(2+Math.max(0,entries.length-1));
    for(const [key,child] of entries){add(utf8Bytes(JSON.stringify(key))+1);pending.push({value:child,depth:current.depth+1});}
  }
}

const packageBytes=(budgets:Budgets)=>Math.max(budgets.definitionBytes,budgets.inputBytes)*2;

/** A deterministic JSON representation used for content pins and package identity. */
export function canonicalJson(value:PortableJson):string{
  if(value===null)return 'null';
  if(typeof value==='string')return JSON.stringify(value);
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='number')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key]!)}`).join(',')}}`;
}

export function canonicalDigest(value:PortableJson):string{return createHash('sha256').update(canonicalJson(value),'utf8').digest('hex');}

function clone<T extends PortableJson>(value:T):T{return structuredClone(value);}
function asObject(value:unknown,label:string):Record<string,unknown>{if(!isObject(value))fail(`${label} must be an object.`);return value as Record<string,unknown>;}
function string(value:unknown,label:string):string{if(typeof value!=='string')fail(`${label} must be a string.`);return value as string;}
function digest(value:unknown,label:string):string{const result=string(value,label);if(!digestPattern.test(result))fail(`${label} must be a lowercase SHA-256 digest.`);return result;}
function identifier(value:unknown,label:string):string{const result=string(value,label);if(!identifierPattern.test(result))fail(`${label} must be a lowercase identifier.`);return result;}
function exactObject(value:unknown,label:string,keys:readonly string[]){const result=asObject(value,label);if(!ownKeys(result,keys))fail(`${label} has unsupported or missing fields.`);return result;}

function absolutePath(value:string){return value.startsWith('/')||value.startsWith('~')||/^[A-Za-z]:[\\/]/.test(value);}
function checkPortableDefinition(value:PortableJson){
  if(!isObject(value))return;
  for(const key of Object.keys(value))if(forbiddenDefinitionMetadata.has(key.toLowerCase()))fail(`Portable definition must not contain runtime metadata: ${key}.`);
  // Runtime workspace settings only occur on executable nodes. Ignore arbitrary
  // user JSON elsewhere; a marker explicitly identifies a portable target.
  if(!Array.isArray(value.nodes))return;
  for(const node of value.nodes)if(isObject(node))for(const [key,setting] of Object.entries(node)){
    if(executionSettingKeys.has(key.toLowerCase())&&typeof setting==='string'&&absolutePath(setting))fail(`Portable definition must declare ${key} as an environment binding instead of embedding an absolute path.`);
  }
}

function parseDependency(value:unknown,label:string):PortableDependency{
  const source=exactObject(value,label,['templateId','digest']);
  return {templateId:identifier(source.templateId,`${label}.templateId`),digest:digest(source.digest,`${label}.digest`)};
}

function parseTemplate(value:unknown,index:number,maxBytes:number):PortableTemplate{
  const label=`templates[${index}]`,source=exactObject(value,label,['templateId','content','contentDigest','dependencies']);
  const content=source.content,dependencies=source.dependencies;
  checkJson(content,`${label}.content`,maxBytes);
  if(!Array.isArray(dependencies))fail(`${label}.dependencies must be an array.`);
  const result:PortableTemplate={templateId:identifier(source.templateId,`${label}.templateId`),content:clone(content as PortableJson),contentDigest:digest(source.contentDigest,`${label}.contentDigest`),dependencies:(dependencies as unknown[]).map((item,dependencyIndex)=>parseDependency(item,`${label}.dependencies[${dependencyIndex}]`))};
  checkPortableDefinition(result.content);
  if(canonicalDigest(result.content)!==result.contentDigest)fail(`${label}.contentDigest does not pin its exact content.`);
  if(new Set(result.dependencies.map(item=>item.templateId)).size!==result.dependencies.length)fail(`${label}.dependencies contains duplicate pins.`);
  return result;
}

function parseLocation(value:unknown,label:string):PortableBindingLocation{
  const source=exactObject(value,label,['templateId','pointer']);
  const templateId=identifier(source.templateId,`${label}.templateId`),pointer=string(source.pointer,`${label}.pointer`);
  if(!pointerPattern.test(pointer))fail(`${label}.pointer is not a safe JSON pointer.`);
  const parts=decodePointer(pointer);
  if(parts.some(part=>['__proto__','constructor','prototype'].includes(part)))fail(`${label}.pointer is not a safe JSON pointer.`);
  if(immutableBindingRoots.has(parts[0]!.toLowerCase()))fail(`${label}.pointer cannot bind package identity or runtime authority.`);
  return {templateId,pointer};
}

function parseBinding(value:unknown,index:number):PortableBinding{
  const label=`bindings[${index}]`,source=exactObject(value,label,['name','type','locations']);
  const type=string(source.type,`${label}.type`),locations=source.locations;
  if(type!=='string'&&type!=='number'&&type!=='boolean'&&type!=='json')fail(`${label}.type is unsupported.`);
  if(!Array.isArray(locations)||locations.length===0)fail(`${label}.locations must name at least one explicit target.`);
  return {name:identifier(source.name,`${label}.name`),type:type as BindingType,locations:(locations as unknown[]).map((item,locationIndex)=>parseLocation(item,`${label}.locations[${locationIndex}]`))};
}

function packageContent(value:PortablePackageDraft):PortableJson{return {kind:value.kind,formatVersion:value.formatVersion,templates:value.templates,bindings:value.bindings};}

function markerName(value:unknown):string|undefined{
  if(!isObject(value)||!ownKeys(value,['$loopsBinding'])||typeof value.$loopsBinding!=='string')return undefined;
  return value.$loopsBinding;
}

function decodePointer(pointer:string){return pointer.slice(1).split('/').map(part=>part.replaceAll('~1','/').replaceAll('~0','~'));}
function pointerValue(content:PortableJson,pointer:string):PortableJson{
  let current:PortableJson=content;
  for(const part of decodePointer(pointer)){
    if(Array.isArray(current)){
      if(!/^(0|[1-9]\d*)$/.test(part)||Number(part)>=current.length)fail(`Binding target ${pointer} does not exist.`);
      current=current[Number(part)]!;
    }else if(isObject(current)){
      if(!Object.hasOwn(current,part))fail(`Binding target ${pointer} does not exist.`);
      current=current[part]!;
    }else fail(`Binding target ${pointer} does not exist.`);
  }
  return current;
}

function replacePointer(content:PortableJson,pointer:string,value:PortableJson){
  const parts=decodePointer(pointer);
  const key=parts.pop()!;let parent:PortableJson=content;
  for(const part of parts){
    if(Array.isArray(parent))parent=parent[Number(part)]!;
    else parent=(parent as Record<string,PortableJson>)[part]!;
  }
  if(Array.isArray(parent))parent[Number(key)]=value;
  else (parent as Record<string,PortableJson>)[key]=value;
}

function markerLocations(value:PortableJson,path='',out=new Map<string,string[]>()){
  const name=markerName(value);if(name!==undefined)out.set(name,[...(out.get(name)??[]),path]);
  if(Array.isArray(value))value.forEach((child,index)=>markerLocations(child,`${path}/${index}`,out));
  else if(isObject(value))for(const [key,child] of Object.entries(value))markerLocations(child,`${path}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,out);
  return out;
}

function checkDependencies(templates:PortableTemplate[]){
  const byId=new Map(templates.map(template=>[template.templateId,template]));
  for(const template of templates)for(const dependency of template.dependencies){
    const target=byId.get(dependency.templateId);
    if(!target)fail(`Template ${template.templateId} pins unknown dependency ${dependency.templateId}.`);
    if(target!.contentDigest!==dependency.digest)fail(`Template ${template.templateId} has a stale pin for ${dependency.templateId}.`);
  }
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(templateId:string)=>{if(visiting.has(templateId))fail(`Portable template dependencies contain a cycle at ${templateId}.`);if(visited.has(templateId))return;visiting.add(templateId);for(const dependency of byId.get(templateId)!.dependencies)visit(dependency.templateId);visiting.delete(templateId);visited.add(templateId);};
  templates.forEach(template=>visit(template.templateId));
}

/** Parse an untrusted package without executing it or granting any capability. */
export function parsePortablePackage(value:unknown,budgets:Budgets=defaultBudgets):PortablePackage{
  checkJson(value,'package',packageBytes(budgets));
  const source=exactObject(value,'package',['kind','formatVersion','digest','templates','bindings']);
  if(source.kind!=='loops-template-package'||source.formatVersion!==1)fail('Unsupported portable package format.');
  const rawTemplates=source.templates,rawBindings=source.bindings;
  if(!Array.isArray(rawTemplates)||rawTemplates.length===0)fail('Package must include at least one template.');
  if(!Array.isArray(rawBindings))fail('Package bindings must be an array.');
  const templates=(rawTemplates as unknown[]).map((template,index)=>parseTemplate(template,index,packageBytes(budgets))),bindings=(rawBindings as unknown[]).map(parseBinding);
  if(new Set(templates.map(template=>template.templateId)).size!==templates.length)fail('Package contains duplicate template IDs.');
  if(new Set(templates.map(template=>template.contentDigest)).size!==templates.length)fail('Package contains duplicate template content.');
  const definitionIds=templates.map(template=>isObject(template.content)&&typeof template.content.id==='string'?template.content.id:undefined).filter((id):id is string=>id!==undefined);
  if(new Set(definitionIds).size!==definitionIds.length)fail('Package contains conflicting definition IDs.');
  if(new Set(bindings.map(binding=>binding.name)).size!==bindings.length)fail('Package contains duplicate binding names.');
  const locations=new Set<string>();
  for(const binding of bindings)for(const location of binding.locations){
    const target=templates.find(template=>template.templateId===location.templateId);
    if(!target)fail(`Binding ${binding.name} targets unknown template ${location.templateId}.`);
    const key=`${location.templateId}:${location.pointer}`;
    if(locations.has(key))fail(`Binding locations conflict at ${location.pointer}.`);locations.add(key);
    if(markerName(pointerValue(target!.content,location.pointer))!==binding.name)fail(`Binding ${binding.name} must target its exact declared marker.`);
  }
  for(const template of templates)for(const [name,pointers] of markerLocations(template.content)){
    const binding=bindings.find(item=>item.name===name);
    if(!binding)fail(`Template ${template.templateId} contains undeclared binding ${name}.`);
    for(const pointer of pointers)if(!locations.has(`${template.templateId}:${pointer}`))fail(`Binding ${name} has an undeclared target at ${pointer}.`);
  }
  checkDependencies(templates);
  const draft:PortablePackageDraft={kind:'loops-template-package',formatVersion:1,templates,bindings};
  const result:{kind:'loops-template-package';formatVersion:1;digest:string;templates:PortableTemplate[];bindings:PortableBinding[]}={...draft,digest:digest(source.digest,'package.digest')};
  if(canonicalDigest(packageContent(draft))!==result.digest)fail('Package digest does not match its canonical content.');
  return clone(result);
}

/** Build a fully pinned package from JSON content controlled by the current exporter. */
export function createPortablePackage(value:PortablePackageInput,budgets:Budgets=defaultBudgets):PortablePackage{
  const templates=value.templates.map(template=>{checkJson(template.content,`template ${template.templateId} content`,packageBytes(budgets));return {...template,contentDigest:canonicalDigest(template.content)};});
  const draft:PortablePackageDraft={kind:'loops-template-package',formatVersion:1,templates,bindings:value.bindings};
  return parsePortablePackage({...draft,digest:canonicalDigest(packageContent(draft))},budgets);
}

/** Create a single-template package while replacing only explicitly selected fields with typed environment markers. */
export function exportPortableTemplate(content:PortableJson,declarations:unknown,budgets:Budgets=defaultBudgets):PortablePackage{
  if(!Array.isArray(declarations))fail('Portable binding declarations must be an array.');
  const definition=clone(content),bindings=(declarations as unknown[]).map((value,index)=>{
    const source=exactObject(value,`bindings[${index}]`,['name','type','pointer']);
    const location=parseLocation({templateId:'loop',pointer:source.pointer},`bindings[${index}].location`);
    const type=string(source.type,`bindings[${index}].type`);if(type!=='string'&&type!=='number'&&type!=='boolean'&&type!=='json')fail(`bindings[${index}].type is unsupported.`);
    const name=identifier(source.name,`bindings[${index}].name`);pointerValue(definition,location.pointer);
    return {name,type:type as BindingType,locations:[location]};
  });
  if(new Set(bindings.map(binding=>binding.name)).size!==bindings.length)fail('Portable binding declarations contain duplicate names.');
  if(new Set(bindings.map(binding=>binding.locations[0]!.pointer)).size!==bindings.length)fail('Portable binding declarations target the same field more than once.');
  for(const binding of bindings)replacePointer(definition,binding.locations[0]!.pointer,{$loopsBinding:binding.name});
  return createPortablePackage({templates:[{templateId:'loop',content:definition,dependencies:[]}],bindings},budgets);
}

function typedValue(value:unknown,type:BindingType,name:string):PortableJson{
  if(type==='string'){if(typeof value!=='string')fail(`Binding ${name} must be a string.`);return value as string;}
  if(type==='number'){if(typeof value!=='number'||!Number.isFinite(value))fail(`Binding ${name} must be a finite number.`);return value as number;}
  if(type==='boolean'){if(typeof value!=='boolean')fail(`Binding ${name} must be a boolean.`);return value as boolean;}
  return clone(value as PortableJson);
}

/** Resolve explicit environment values for a preview. This function has no storage or execution side effects. */
export function previewPortableImport(value:unknown,environment:unknown,budgets:Budgets=defaultBudgets):PortablePreview{
  const packageValue=parsePortablePackage(value,budgets),provided=asObject(environment,'environment');
  checkJson(provided,'environment',packageBytes(budgets));
  const expected=new Set(packageValue.bindings.map(binding=>binding.name));
  for(const name of Object.keys(provided))if(!expected.has(name))fail(`Unknown environment binding ${name}.`);
  for(const binding of packageValue.bindings)if(!Object.hasOwn(provided,binding.name))fail(`Missing environment binding ${binding.name}.`);
  const templates=packageValue.templates.map(template=>({templateId:template.templateId,contentDigest:template.contentDigest,definition:clone(template.content),dependencies:clone(template.dependencies)}));
  for(const binding of packageValue.bindings){
    const replacement=typedValue(provided[binding.name],binding.type,binding.name);
    for(const location of binding.locations){
      const template=templates.find(item=>item.templateId===location.templateId)!;
      if(markerName(pointerValue(template.definition,location.pointer))!==binding.name)fail(`Binding target changed before preview: ${binding.name}.`);
      replacePointer(template.definition,location.pointer,clone(replacement));
    }
  }
  return {digest:packageValue.digest,templates,bindings:clone(packageValue.bindings)};
}
