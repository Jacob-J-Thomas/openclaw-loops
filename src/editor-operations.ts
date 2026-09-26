import {outputFields,type Definition,type GraphNode} from './graph.js';
import {requestError} from './errors.js';
import {truncateCodePoints} from './unicode.js';
import {bindingTokens} from './context.js';

// Keep duplication aligned with bind(): only its {{...}} token form has
// binding semantics. Text outside a token, including a string that resembles
// a node path, remains authored literal data.
function remapBindingTokens(value:string,previous:string,next:string):string{
  const prefix=`nodes.${previous}.`;
  const bindings=bindingTokens(value);let result='',cursor=0;
  for(const binding of bindings.tokens){
    result+=value.slice(cursor,binding.start);const path=binding.raw.trim();
    if(!path.startsWith(prefix)){result+=value.slice(binding.start,binding.end);cursor=binding.end;continue;}
    const offset=binding.raw.indexOf(path);
    result+=`{{${binding.raw.slice(0,offset)}nodes.${next}.${path.slice(prefix.length)}${binding.raw.slice(offset+path.length)}}}`;cursor=binding.end;
  }
  return result+value.slice(cursor);
}
function remapContextLiteral(node:GraphNode,previous:string,next:string){
  const source=node.context?.patch;
  if(source&&source.mode!=='omit'&&source.source.kind==='literal'&&typeof source.source.value==='string')source.source.value=remapBindingTokens(source.source.value,previous,next);
}

// Invalid imported Memory policies remain editable drafts. Inspect the outer
// collection shape before graph edits; do not repair or discard its raw value.
const memoryNodeRecord=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function copyDefinition(definition:Definition,id:string,templateDefaults?:Pick<Definition['limits'],'maxExecutions'|'maxOutputBytes'>):Definition{
  const copy={...structuredClone(definition),id,slug:id,revision:0};
  return templateDefaults?{...copy,schemaVersion:definition.schemaVersion===3?3:2,limits:{...copy.limits,...templateDefaults}}:copy;
}

// Timeout authoring requires at least v2. Keep v3's authored schemas,
// branching, and context rather than downgrading an otherwise valid graph.
export function withActiveTimeout(definition:Definition,timeoutMs:number|undefined):Definition{
  const limits={...definition.limits};
  if(timeoutMs===undefined)delete limits.timeoutMs;
  else limits.timeoutMs=timeoutMs;
  return {...definition,schemaVersion:definition.schemaVersion===1?2:definition.schemaVersion,limits};
}

// These nodes carry v3-only contracts. Palette additions must upgrade the
// editable draft before it can be saved or published.
export function schemaVersionForAddedNode(version:Definition['schemaVersion'],kind:GraphNode['kind']):Definition['schemaVersion']{
  return kind==='evaluate'||kind==='gate'||kind==='switch'||kind==='context-lifecycle'||kind==='memory'?3:version;
}

export function autoLayout(definition:Definition):Definition{
  const depth=new Map<string,number>();
  for(const node of definition.nodes)depth.set(node.id,0);
  // Bound the relaxation so invalid cyclic drafts remain editable.
  for(let pass=0;pass<definition.nodes.length;pass++)for(const edge of definition.edges){
    const candidate=Math.min(definition.nodes.length,(depth.get(edge.source)??0)+1);
    if(candidate>(depth.get(edge.target)??0))depth.set(edge.target,candidate);
  }
  const rows=new Map<number,number>();const layout:Definition['layout']={};
  for(const node of definition.nodes){const column=depth.get(node.id)??0,row=rows.get(column)??0;rows.set(column,row+1);layout[node.id]={x:40+column*265,y:60+row*180};}
  if(definition.schemaVersion!==1)return {...definition,layout};
  const legacyLayout=Object.fromEntries((['x','y'] as const).map(axis=>{
    const values=Object.values(layout).map(position=>position[axis]);const minimum=Math.min(...values),maximum=Math.max(...values);
    if(maximum-minimum>20000)throw requestError('This version 1 draft cannot fit its layout within the legacy coordinate range. Use version 2 in this draft, then Arrange again.');
    return [axis,minimum<-10000?-10000-minimum:maximum>10000?10000-maximum:0];
  })) as Record<'x'|'y',number>;
  for(const position of Object.values(layout)){position.x+=legacyLayout.x;position.y+=legacyLayout.y;}
  return {...definition,layout};
}
export function duplicateNode(definition:Definition,nodeId:string,fresh:(prefix:string)=>string):Definition{
  const original=definition.nodes.find(n=>n.id===nodeId);if(!original)return definition;
  const duplicate=structuredClone(original);duplicate.id=fresh(original.kind);duplicate.label=truncateCodePoints(`${duplicate.label} copy`,100);
  if(duplicate.kind==='repeat'){
    const previous=duplicate.body[0].id;duplicate.body[0].id=fresh('inference');duplicate.body[1].id=fresh('condition');
    for(const operand of ['left','right'] as const){const value=duplicate.body[1].predicate[operand];if(typeof value==='string')duplicate.body[1].predicate[operand]=remapBindingTokens(value,previous,duplicate.body[0].id);}
    for(const child of duplicate.body)remapContextLiteral(child,previous,duplicate.body[0].id);
  }
  const position=definition.layout[nodeId]??{x:0,y:0};
  const policy=definition.memoryPolicy,policyNodes=policy?.enabled?policy.nodes:undefined;
  const memoryPolicy=policy?.enabled&&original.kind==='memory'&&memoryNodeRecord(policyNodes)&&Object.hasOwn(policyNodes,original.id)
    ?{...policy,nodes:{...policyNodes,[duplicate.id]:structuredClone(policyNodes[original.id])}} as Definition['memoryPolicy']:policy;
  return {...definition,nodes:[...definition.nodes,duplicate],layout:{...definition.layout,[duplicate.id]:{x:position.x+40,y:position.y+180}},...memoryPolicy?{memoryPolicy}:{}};
}
export function deleteGraphNode(definition:Definition,id:string):Definition{
  const layout={...definition.layout};delete layout[id];
  const policy=definition.memoryPolicy,policyNodes=policy?.enabled?policy.nodes:undefined;
  let memoryPolicy=policy;
  if(policy?.enabled&&memoryNodeRecord(policyNodes)&&Object.hasOwn(policyNodes,id)){
    const remaining={...policyNodes};delete remaining[id];
    memoryPolicy={...policy,nodes:remaining} as Definition['memoryPolicy'];
  }
  return {...definition,nodes:definition.nodes.filter(node=>node.id!==id),edges:definition.edges.filter(edge=>edge.source!==id&&edge.target!==id),layout,...memoryPolicy?{memoryPolicy}:{}};
}
export function bindingChoices(definition:Definition,consumer:GraphNode):string[]{
  const reachableWithout=(blocked:string)=>{
    const seen=new Set<string>(),pending=definition.nodes.filter(n=>n.kind==='input').map(n=>n.id);
    while(pending.length){const id=pending.pop()!;if(id===blocked||seen.has(id))continue;seen.add(id);for(const edge of definition.edges.filter(e=>e.source===id))pending.push(edge.target);}
    return seen;
  };
  const prior=definition.nodes.filter(node=>node.id!==consumer.id&&!reachableWithout(node.id).has(consumer.id));
  return [...definition.inputSchema.map(field=>`{{input.${field.name}}}`),...prior.flatMap(node=>outputFields(node).map(field=>`{{nodes.${node.id}.${field}}}`)),...consumer.kind==='repeat'?['{{repeat.index}}']:[]];
}
export function insertBinding(node:GraphNode,binding:string):GraphNode{
  const replaceOrAppend=(value:unknown)=>typeof value==='string'?value+binding:binding;
  if(node.kind==='inference')return {...node,prompt:replaceOrAppend(node.prompt)};
  if(node.kind==='evaluate')return {...node,value:replaceOrAppend(node.value)};
  if(node.kind==='context-lifecycle'){
    if(node.lifecycle.operation==='summarize'||node.lifecycle.operation==='compact')return {...node,lifecycle:{...node.lifecycle,instructions:replaceOrAppend(node.lifecycle.instructions)}};
    if(node.lifecycle.operation==='inject'&&!node.lifecycle.source)return {...node,lifecycle:{...node.lifecycle,value:replaceOrAppend(node.lifecycle.value)}};
    return node;
  }
  if(node.kind==='memory'){
    if(node.memory.operation==='write'||node.memory.operation==='update')return {...node,memory:{...node.memory,value:replaceOrAppend(node.memory.value)}};
    return {...node,memory:{...node.memory,key:replaceOrAppend(node.memory.key)}};
  }
  if(node.kind==='repeat')return {...node,body:[{...node.body[0],prompt:typeof node.body[0].prompt==='string'?node.body[0].prompt+binding:binding},node.body[1]]};
  if(node.kind==='return')return {...node,value:binding};
  if(node.kind==='condition')return 'condition'in node?{...node,condition:{...node.condition,value:binding}}:{...node,predicate:{...node.predicate,left:binding}};
  if(node.kind==='switch')return {...node,value:binding};
  if(node.kind==='wait')return {...node,message:binding};
  if(node.kind==='review')return {...node,proposal:binding};
  if(node.kind==='fail')return {...node,reason:binding};
  return node;
}
export function revisionChanges(before:Definition,after:Definition):string[]{
  const changes:string[]=[];
  for(const key of ['schemaVersion','name','slug','description','inputSchema','capabilities','limits','edges','layout','memoryPolicy','memorySchemas'] as const)if(JSON.stringify(before[key])!==JSON.stringify(after[key]))changes.push(`${key} changed`);
  for(const node of after.nodes){const old=before.nodes.find(n=>n.id===node.id);if(!old)changes.push(`Added ${node.label}`);else if(JSON.stringify(old)!==JSON.stringify(node))changes.push(`Changed ${node.label}`);}
  for(const node of before.nodes)if(!after.nodes.some(n=>n.id===node.id))changes.push(`Removed ${node.label}`);
  return changes;
}

export type MergeConflict={path:string;local:unknown;remote:unknown};
export function mergeDefinitions(base:Definition|null,local:Definition,remote:Definition,choices:Record<string,'local'|'remote'>={}):{definition:Definition;conflicts:MergeConflict[]}{
  if(local.id!==remote.id||base&&base.id!==local.id)throw new Error('Only revisions of the same loop can be merged.');
  const conflicts:MergeConflict[]=[];
  const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
  const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const merge=(before:unknown,ours:unknown,theirs:unknown,path:string):unknown=>{
    if(equal(ours,theirs))return ours;
    if(equal(before,ours))return theirs;
    if(equal(before,theirs))return ours;
    if(plain(before)&&plain(ours)&&plain(theirs))return Object.fromEntries([...new Set([...Object.keys(before),...Object.keys(ours),...Object.keys(theirs)])].flatMap(key=>{const value=merge(before[key],ours[key],theirs[key],path?`${path}.${key}`:key);return value===undefined?[]:[[key,value]];}));
    if(Array.isArray(before)&&Array.isArray(ours)&&Array.isArray(theirs)&&['nodes','edges','inputSchema'].includes(path)){
      const key=path==='inputSchema'?'name':'id';
      const map=(values:unknown[])=>new Map(values.filter(plain).map(value=>[String(value[key]),value]));
      const b=map(before),l=map(ours),r=map(theirs);
      // Preserve changed local ordering when the remote ordering is unchanged;
      // otherwise prefer remote order and append independent local additions.
      const order=equal([...b.keys()],[...r.keys()])?[...l.keys(),...r.keys()]:[...r.keys(),...l.keys()];
      return [...new Set(order)].flatMap(id=>{const value=merge(b.get(id),l.get(id),r.get(id),`${path}.${id}`);return value===undefined?[]:[value];});
    }
    if(!choices[path])conflicts.push({path,local:ours,remote:theirs});
    return choices[path]==='remote'?theirs:ours;
  };
  const definition=merge(base??{},{...local,revision:remote.revision},remote,'') as Definition;
  // A merge is an unsaved edit based on the current remote revision. It does
  // not publish, replace a running revision or resolve an optimistic write.
  return {definition:{...structuredClone(definition),id:remote.id,revision:remote.revision},conflicts};
}
