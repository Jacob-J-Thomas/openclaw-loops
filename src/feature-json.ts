// Compatibility envelope verified against OpenClaw 2026.9.3's feature SDK.
// These are transport limits, not limits on a saved graph or its output.
export const featureJsonLimits = {
  depth: 32, nodes: 4096, keys: 512, stringLength: 65536, bytes: 262144,
} as const;

export function fitsFeatureJson(value: unknown): boolean {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    if (++nodes > featureJsonLimits.nodes || depth > featureJsonLimits.depth) return false;
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item === 'number') return Number.isFinite(item);
    if (typeof item === 'string') return item.length <= featureJsonLimits.stringLength;
    if (Array.isArray(item)) return item.every(child => visit(child, depth + 1));
    if (!item || typeof item !== 'object') return false;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) return false;
    const entries = Object.entries(item);
    return entries.length <= featureJsonLimits.keys && entries.every(([key, child]) => key.length <= featureJsonLimits.stringLength && visit(child, depth + 1));
  };
  return visit(value, 0) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= featureJsonLimits.bytes;
}

// 16K code points also fit the host envelope when every character needs JSON
// escaping or occupies a surrogate pair. Offsets always count code points.
export function textPage(text: string, offset = 0, limit = 16000, maximum = 16000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new Error('Page offset and limit must be nonnegative/positive safe integers.');
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 60000) throw new Error('Page maximum must be a positive bounded safe integer.');
  const count = Math.min(limit, maximum);
  // Most large transport snapshots are ASCII JSON/Base64. V8 searches that
  // path without materializing an array of every character on every page.
  if (text.search(/[^\p{ASCII}]/u) === -1) {
    const end = Math.min(text.length, offset + count);
    return {text: text.slice(offset, end), offset, nextOffset: end < text.length ? end : null, totalCharacters: text.length};
  }
  let total = 0, startUnit = text.length, endUnit = text.length;
  for (let unit = 0; unit < text.length;) {
    if (total === offset) startUnit = unit;
    if (total === offset + count) endUnit = unit;
    const first = text.charCodeAt(unit), second = text.charCodeAt(unit + 1);
    unit += first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff ? 2 : 1;
    total++;
  }
  const end = Math.min(total, offset + count);
  return {text: text.slice(startUnit, endUnit), offset, nextOffset: end < total ? end : null, totalCharacters: total};
}

// Fit the complete transport envelope while retaining the original document's
// continuation. The predicate measures formatting, escaping and metadata.
export function fitTextPage<T extends ReturnType<typeof textPage>>(page:T,fits:(page:T)=>boolean):T{
  if(fits(page))return page;
  const characters=Array.from(page.text);
  const take=(count:number):T=>({...page,text:characters.slice(0,count).join(''),nextOffset:count<characters.length?page.offset+count:page.nextOffset});
  let low=0,high=characters.length;
  while(low<high){const middle=Math.ceil((low+high)/2);if(fits(take(middle)))low=middle;else high=middle-1;}
  if(low===0)throw new Error('Page metadata cannot fit the reply envelope.');
  return take(low);
}
