import {createHash} from 'node:crypto';

// JSON object ordering must not depend on host locale or Unicode collation.
// Keep distinct key spellings intact, including canonically equivalent Unicode.
// Version 1 is only a compatibility comparison for existing admission hashes.
export function fingerprintJson(value:unknown,version:1|2=2):string{
  const serialized=JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?
    Object.fromEntries(Object.entries(item).sort(([a],[b])=>version===1?a.localeCompare(b):a<b?-1:a>b?1:0)):item);
  return createHash('sha256').update(serialized).digest('hex');
}
