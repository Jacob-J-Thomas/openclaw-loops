import {jsonResult} from 'openclaw/plugin-sdk/tool-results';
import {fitTextPage,type textPage} from './feature-json.js';

// The pinned host displays direct tool text within 8K UTF-16 units and deferred
// tool_call reports within 16K. Use its public result formatter; include the
// observed discovery wrapper and duplicated structured details in the budget.
export function fitsToolReply(value:unknown,name:string):boolean{
  const result=jsonResult(value),text=result.content[0];
  if(text.type!=='text'||text.text.length>8000)return false;
  return JSON.stringify({tool:{id:`openclaw:loops-poc:${name}`,name,source:'openclaw'},result},null,2).length<=16000;
}
export function toolPage<T extends ReturnType<typeof textPage>>(page:T,name:string):T{
  return fitTextPage(page,value=>fitsToolReply(value,name));
}
