import {Type} from 'typebox';
import {requestError} from './errors.js';
import {NodeValueSchema,type NodeValue,type Json} from './node-values.js';

const strict={additionalProperties:false} as const;
const days=Type.Integer({minimum:0,maximum:365000});
export const ArtifactNodeConfigSchema=Type.Union([
  Type.Object({operation:Type.Literal('capture'),value:NodeValueSchema,retentionDays:days},strict),
  Type.Object({operation:Type.Literal('import'),bundle:NodeValueSchema,external:Type.Optional(NodeValueSchema),retentionDays:days},strict),
]);
export type ArtifactNodeConfig={operation:'capture';value:NodeValue;retentionDays:number}|{operation:'import';bundle:NodeValue;external?:NodeValue;retentionDays:number};
export type FileInput={dataBase64:string;mediaType:string;name?:string};
const mime=/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const base64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const plain=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
export function decodeFileInput(value:unknown,maxBytes:number):{bytes:Uint8Array;mediaType:string}{
  if(!plain(value)||Object.keys(value).some(key=>!['dataBase64','mediaType','name'].includes(key))||typeof value.dataBase64!=='string'||!base64.test(value.dataBase64)||value.dataBase64.length>Math.ceil(maxBytes/3)*4+4||typeof value.mediaType!=='string'||!mime.test(value.mediaType)||value.name!==undefined&&(typeof value.name!=='string'||value.name.length>255))throw requestError('File input requires canonical Base64 bytes and a valid media type.','LOOPS_ARTIFACT_INPUT');
  const bytes=Buffer.from(value.dataBase64,'base64');
  if(bytes.length>maxBytes||bytes.toString('base64')!==value.dataBase64)throw requestError('File bytes exceed the configured limit or are not canonical Base64.','LOOPS_ARTIFACT_SIZE');
  return {bytes,mediaType:value.mediaType};
}
export function decodeExternalFiles(value:Json|undefined,maxBytes:number):Record<string,Uint8Array>{
  if(value===undefined)return {};
  if(!plain(value)||Object.keys(value).length>256)throw requestError('External dependencies must map source IDs to canonical Base64 bytes.','LOOPS_ARTIFACT_IMPORT');
  const result:Record<string,Uint8Array>={};
  for(const [id,dataBase64] of Object.entries(value)){
    if(!/^[a-f0-9-]{36}$/.test(id)||typeof dataBase64!=='string')throw requestError('External artifact dependency is invalid.','LOOPS_ARTIFACT_IMPORT');
    result[id]=decodeFileInput({dataBase64,mediaType:'application/octet-stream'},maxBytes).bytes;
  }
  return result;
}
