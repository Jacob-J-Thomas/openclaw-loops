// Browser-safe evaluator configuration checks. Execution repeats these checks
// with the worker's exact limits before any worker is created.
function canonical(value:unknown,depth=0):string{
  if(depth>100)throw new Error('Evaluation configuration exceeds 100 nesting levels.');
  if(value===null)return 'null';
  if(typeof value==='boolean')return value?'true':'false';
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Evaluation configuration requires finite numbers.');return JSON.stringify(value);}
  if(typeof value==='string')return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(item=>canonical(item,depth+1)).join(',')}]`;
  if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)throw new Error('Evaluation configuration must contain JSON values.');
  const record=value as Record<string,unknown>,keys=Object.keys(record);
  if(keys.some(key=>['__proto__','prototype','constructor'].includes(key)))throw new Error('Evaluation configuration cannot use prototype-related keys.');
  return `{${keys.sort().map(key=>`${JSON.stringify(key)}:${canonical(record[key],depth+1)}`).join(',')}}`;
}

export function evaluatorConfigurationIssue(value:unknown,maxBytes=131072):string|undefined{
  try{
    if(!value||typeof value!=='object'||Array.isArray(value))return 'Evaluator configuration must be an object.';
    const evaluator=value as Record<string,unknown>;
    if(typeof evaluator.version!=='string'||!evaluator.version.trim())return 'Evaluator version is required.';
    if(evaluator.kind==='json-schema-2020'){if(!Object.hasOwn(evaluator,'schema'))return 'JSON Schema evaluator needs a schema.';}
    else if(evaluator.kind==='predicate'){
      if(!evaluator.predicate||typeof evaluator.predicate!=='object'||Array.isArray(evaluator.predicate))return 'Predicate evaluator needs a predicate.';
      const predicate=evaluator.predicate as Record<string,unknown>;
      if(!['equals','not-equals','contains','less-than','greater-than','truthy'].includes(String(predicate.op))||predicate.op!=='truthy'&&!Object.hasOwn(predicate,'expected'))return 'Predicate evaluator needs a supported operation and expected value.';
    }else return 'Evaluator kind must be json-schema-2020 or predicate.';
    if(new TextEncoder().encode(canonical(value)).byteLength>maxBytes)return `Evaluation configuration exceeds ${maxBytes} bytes.`;
  }catch(error){return error instanceof Error?error.message:'Invalid evaluator configuration.';}
  return undefined;
}
