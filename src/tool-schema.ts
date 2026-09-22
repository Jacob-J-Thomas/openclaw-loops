// Codex 0.153.4 rejects JSON Schema tuple items during thread/start. Project
// tuples as bounded arrays of their item union for the tool transport only.
// Engine parsing still enforces the original ordered tuple and full schema.
export function toolSchema<T>(schema:T):T{
  const result=structuredClone(schema);
  const visit=(value:unknown):void=>{
    if(!value||typeof value!=='object')return;
    const node=value as Record<string,unknown>;
    if(node.type==='array'&&Array.isArray(node.items)){
      node.items={anyOf:node.items};delete node.additionalItems;
    }
    for(const item of Object.values(node))visit(item);
  };
  visit(result);return result;
}

type JsonObject=Record<string,unknown>;

const object=(value:unknown):value is JsonObject=>!!value&&typeof value==='object'&&!Array.isArray(value);
const schemaNode=(value:unknown):value is JsonObject=>object(value)&&(typeof value.type==='string'||typeof value.$ref==='string'||Array.isArray(value.anyOf)||Array.isArray(value.oneOf)||Array.isArray(value.allOf)||object(value.not)||object(value.if));

function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(object(value))return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function size(value:unknown):number{
  if(Array.isArray(value))return 1+value.reduce<number>((total,item)=>total+size(item),0);
  if(object(value))return 1+Object.values(value).reduce<number>((total,item)=>total+size(item),0);
  return 1;
}

/**
 * The Gateway limits the complete JSON value used while registering each tool.
 * Definition schemas repeat large, exact TypeBox branches for version and node
 * variants. Factor only those repeated schema branches after the full wire
 * input (including upload alternatives) is assembled, so every reference is
 * rooted at the operation input that owns its $defs.
 */
export function compactToolInput<T>(schema:T):T{
  const result=toolSchema(schema);
  const candidates=new Map<string,{value:JsonObject;count:number;size:number}>();
  const collect=(value:unknown)=>{
    if(Array.isArray(value)){for(const item of value)collect(item);return;}
    if(!object(value))return;
    if(schemaNode(value)){
      const key=canonical(value),existing=candidates.get(key);
      if(existing)existing.count++;
      else candidates.set(key,{value,count:1,size:size(value)});
    }
    for(const child of Object.values(value))collect(child);
  };
  collect(result);
  // A ref costs an object and a string. Keep only repetitions that save a
  // meaningful amount even after adding their definition and local refs.
  const selected=[...candidates.entries()]
    .filter(([,entry])=>entry.count>1&&entry.size>=12)
    .sort(([,left],[,right])=>right.size-left.size);
  if(selected.length===0)return result;
  const names=new Map(selected.map(([key],index)=>[key,`loops_schema_${index + 1}`]));
  const rewrite=(value:unknown,skip?:string):unknown=>{
    if(schemaNode(value)){
      const key=canonical(value),name=names.get(key);
      if(name&&key!==skip)return {$ref:`#/$defs/${name}`};
    }
    if(Array.isArray(value))return value.map(item=>rewrite(item,skip));
    if(object(value))return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,rewrite(child,skip)]));
    return value;
  };
  const definitions=Object.fromEntries(selected.map(([key,entry])=>[names.get(key)!,rewrite(entry.value,key)]));
  const compacted=rewrite(result) as JsonObject;
  compacted.$defs=definitions;
  return compacted as T;
}
