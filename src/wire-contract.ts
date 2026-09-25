import {Type, type Static, type TSchema} from 'typebox';
import {defineFeatureContract} from 'openclaw/plugin-sdk/feature-contract';
import {contract} from './contract.js';
import {LoopErrorSchema} from './errors.js';
import {UploadChunkSchema} from './upload-input.js';
import {compactToolInput} from './tool-schema.js';
import {DataSchemaWireDefinitions,DataSchemaWireRef} from './data-schema.js';

const strict = {additionalProperties: false} as const;
const digest = Type.String({pattern: '^[a-f0-9]{64}$'});
const offset = Type.Integer({minimum: 0});
type JsonSchema=TSchema&{type?:string;required?:string[];additionalProperties?:boolean;unevaluatedProperties?:boolean;const?:string|number;properties?:Record<string,JsonSchema>;items?:JsonSchema|JsonSchema[];anyOf?:JsonSchema[];oneOf?:JsonSchema[];allOf?:JsonSchema[];$defs?:Record<string,JsonSchema>};
const schemaObject=(value:unknown):value is JsonSchema=>!!value&&typeof value==='object'&&!Array.isArray(value);
const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:schemaObject(value)?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`:JSON.stringify(value);
const exactKeys=(value:JsonSchema,keys:readonly string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

// Re-express a closed, discriminated union without changing its allowed values.
// An unexpected generated shape keeps the canonical input intact; the explicit
// registration-budget test then fails if that input is too large for the host.
function factorClosedUnion(union:JsonSchema,discriminator:string,expected:readonly (string|number)[]):JsonSchema{
  if(!exactKeys(union,['anyOf'])||union.anyOf?.length!==expected.length)return union;
  const variants=union.anyOf;
  if(!variants.every(variant=>schemaObject(variant)&&exactKeys(variant,['type','required','properties','additionalProperties'])&&variant.type==='object'&&schemaObject(variant.properties)&&Array.isArray(variant.required)&&variant.additionalProperties===false&&new Set(variant.required).size===variant.required.length&&variant.required.every((key:unknown)=>typeof key==='string'&&Object.hasOwn(variant.properties!,key))&&variant.required.includes(discriminator)))return union;
  if(!variants.every((variant,index)=>variant.properties![discriminator]?.const===expected[index]))return union;
  const first=variants[0]!,common=Object.keys(first.properties!).filter(key=>variants.every(variant=>Object.hasOwn(variant.properties!,key)&&canonical(variant.properties![key])===canonical(first.properties![key])&&variant.required!.includes(key)===first.required!.includes(key)));
  if(common.length===0)return union;
  const properties=Object.fromEntries(common.map(key=>[key,structuredClone(first.properties![key])]));
  const required=common.filter(key=>first.required!.includes(key));
  const residual=variants.map(variant=>{
    const properties={...variant.properties};for(const key of common)delete properties[key];
    const required=variant.required!.filter(key=>!common.includes(key));
    return {properties,...required.length?{required}:{}};
  });
  return {type:'object',properties,...required.length?{required}:{},anyOf:residual,unevaluatedProperties:false} as JsonSchema;
}

/** Project only known closed wire unions after root-local refs and compaction. */
export function factorStrictToolInput<T extends TSchema>(input:T):T{
  const result=structuredClone(input) as JsonSchema;
  const definition=result.properties?.definition?.anyOf?.[0];
  if(definition)result.properties!.definition!.anyOf![0]=factorClosedUnion(definition,'schemaVersion',[1,2,3]);
  const data=result.$defs?.loops_data_schema;
  if(data)result.$defs!.loops_data_schema=factorClosedUnion(data,'type',['object','array','string','number','integer','boolean','null','json']);
  const context=result.$defs?.loops_context_node;
  if(context?.type==='object'&&context.unevaluatedProperties===false&&context.allOf?.length===1&&schemaObject(context.allOf[0])&&exactKeys(context.allOf[0],['anyOf'])&&Array.isArray(context.allOf[0].anyOf)&&context.allOf[0].anyOf!.every(variant=>schemaObject(variant)&&variant.type==='object')){
    context.anyOf=context.allOf[0]!.anyOf!.map(variant=>{const copy=structuredClone(variant);delete copy.type;return copy;});
    delete context.allOf;
  }
  return result as T;
}
export function withRecursiveDataSchemaWire(input:TSchema):TSchema{
  const result=structuredClone(input) as JsonSchema;
  const visit=(schema:JsonSchema)=>{
    const properties=schema.properties;
    const inputItems=properties?.inputSchema?.items;
    if(schemaObject(inputItems)&&inputItems.properties?.schema!==undefined)inputItems.properties.schema=structuredClone(DataSchemaWireRef) as JsonSchema;
    if(properties?.outputSchema!==undefined)properties.outputSchema=structuredClone(DataSchemaWireRef) as JsonSchema;
    for(const child of Object.values(properties??{}))if(schemaObject(child))visit(child);
    if(Array.isArray(schema.items)){for(const child of schema.items)if(schemaObject(child))visit(child);}
    else if(schemaObject(schema.items))visit(schema.items);
    for(const child of [...schema.anyOf??[],...schema.oneOf??[],...schema.allOf??[]])if(schemaObject(child))visit(child);
  };
  visit(result);
  result.$defs={...result.$defs,...structuredClone(DataSchemaWireDefinitions)};
  return result;
}
export const UploadReferenceSchema = Type.Object({$loopsUpload: digest}, strict);
export type UploadReference = Static<typeof UploadReferenceSchema>;
export const DocumentReferenceSchema = Type.Object({
  kind: Type.Literal('loops-document'), documentId: digest, sha256: digest,
  bytes: offset, read: Type.Literal('loops_document'), description: Type.String(),
  readerId: Type.Optional(Type.String({pattern: '^[a-f0-9-]{36}$'})),
}, strict);
export type DocumentReference = Static<typeof DocumentReferenceSchema>;
export const OperationFailureSchema=Type.Object({kind:Type.Literal('loops-error'),operation:Type.String(),error:LoopErrorSchema},strict);
export const DocumentPageSchema=Type.Object({documentId:digest,sha256:digest,text:Type.String(),offset,nextOffset:Type.Union([offset,Type.Null()]),totalCharacters:offset},strict);

export const uploadFields: Partial<Record<keyof typeof contract.operations, readonly string[]>> = {
  create: ['definition'], edit: ['changes'], save: ['definition'], draft: ['definition'],
  validate: ['definition'], test: ['definition', 'input'], run: ['input', 'text'],
};
type WireOperations = {[K in keyof typeof contract.operations]: Omit<typeof contract.operations[K], 'input' | 'output'> & {input: TSchema; output: TSchema}};
const operations = Object.fromEntries(Object.entries(contract.operations).map(([name, operation]) => {
  const input = structuredClone(operation.input) as TSchema & {properties: Record<string, TSchema>};
  for (const field of uploadFields[name as keyof typeof uploadFields] ?? []) input.properties[field] = Type.Union([input.properties[field], UploadReferenceSchema]);
  return [name, {...operation, input:factorStrictToolInput(compactToolInput(withRecursiveDataSchemaWire(input))), output: Type.Union([operation.output, DocumentReferenceSchema,OperationFailureSchema]),
    description: operation.description + ' A loops-error result means the operation failed; report its error and recovery, never claim success. Large results return an immutable document reference; use loops_document to read it. ' +
      'When a document reference includes readerId, supply it on each page and release only that reader with loops_document_release after verifying all pages. ' +
      ((uploadFields[name as keyof typeof uploadFields]?.length ?? 0) ? 'Large input fields accept {$loopsUpload: reference} from loops_upload; the original operation validates and authorizes the uploaded value.' : '')}];
})) as unknown as WireOperations;

export const wireContract = defineFeatureContract({pluginId: contract.pluginId, events: contract.events, operations: {
  ...operations,
  document: {kind: 'query', description: 'Read an immutable large operation result in Unicode character pages. Concatenate text in order, verify sha256 over UTF-8, then parse the complete JSON. Follow nextOffset until null. Only the originating conversation may read it. A loops-error result means retrieval failed; report its error and recovery and never present partial pages as the complete result.',
    input: Type.Object({documentId: digest, offset: Type.Optional(offset), limit: Type.Optional(Type.Integer({minimum: 1})), readerId: Type.Optional(Type.String({pattern: '^[a-f0-9-]{36}$'}))}, strict),
    output: Type.Union([DocumentPageSchema, OperationFailureSchema]), tool: {name: 'loops_document'}},
  document_acquire: {kind: 'query', description: 'Acquire an independent durable reader for a previously saved document. Supply its readerId on every loops_document page, then release it with loops_document_release after verifying the complete result. A document reference already containing readerId has an initial reader. Existing legacy documents remain protected without a handle. Reader acquisition uses the same authorized conversation read access; it grants no additional authority.',
    input: Type.Object({documentId: digest}, strict), output: Type.Union([Type.Object({documentId: digest, readerId: Type.String({pattern: '^[a-f0-9-]{36}$'})}, strict), OperationFailureSchema]), tool: {name: 'loops_document_acquire'}},
  document_release: {kind: 'query', description: 'Release only the specific document reader after all pages have been consumed and verified, or explicitly abandon that reader. Other readers and durable evidence references stay protected. This does not delete the document. A failed release leaves its reservation protected for inspection and later explicit release.',
    input: Type.Object({documentId: digest, readerId: Type.String({pattern: '^[a-f0-9-]{36}$'})}, strict), output: Type.Union([Type.Object({released: Type.Boolean()}, strict), OperationFailureSchema]), tool: {name: 'loops_document_release'}},
  upload: {kind: 'action', description: 'Stage a large JSON value without executing it. Use one fresh uploadId and append chunks of at most 16,000 decoded Unicode characters at the returned offset. Supply exactly one of text or textBase64, including for empty fragments. Prefer textBase64 for incomplete JSON fragments in agent calls: encode their exact UTF-8 bytes as standard padded Base64 without whitespace, up to 65,536 encoded characters. Retry an identical decoded chunk at its original offset safely. Set complete:true on the last chunk and supply sha256 of the full decoded UTF-8 JSON, not the Base64. Pass the returned reference only in an upload-capable field of the intended loops tool; its original permissions and validation still apply. A loops-error result means staging failed; report its error and recovery and do not submit the intended operation until the upload completes.',
    input: UploadChunkSchema,
    output: Type.Union([Type.Object({uploadId: Type.String(), offset, completed: Type.Boolean(), reference: Type.Optional(UploadReferenceSchema)}, strict), OperationFailureSchema]), tool: {name: 'loops_upload'}},
}});
