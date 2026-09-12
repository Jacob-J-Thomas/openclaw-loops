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
