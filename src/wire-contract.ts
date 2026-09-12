import {Type, type Static, type TSchema} from 'typebox';
import {defineFeatureContract} from 'openclaw/plugin-sdk/feature-contract';
import {contract} from './contract.js';

const strict = {additionalProperties: false} as const;
const digest = Type.String({pattern: '^[a-f0-9]{64}$'});
const offset = Type.Integer({minimum: 0});
export const UploadReferenceSchema = Type.Object({$loopsUpload: digest}, strict);
export type UploadReference = Static<typeof UploadReferenceSchema>;
export const DocumentReferenceSchema = Type.Object({
  kind: Type.Literal('loops-document'), documentId: digest, sha256: digest,
  bytes: offset, read: Type.Literal('loops_document'), description: Type.String(),
}, strict);
export type DocumentReference = Static<typeof DocumentReferenceSchema>;

export const uploadFields: Partial<Record<keyof typeof contract.operations, readonly string[]>> = {
  create: ['definition'], edit: ['changes'], save: ['definition'], draft: ['definition'],
  validate: ['definition'], test: ['definition', 'input'], run: ['input', 'text'],
};
type WireOperations = {[K in keyof typeof contract.operations]: Omit<typeof contract.operations[K], 'input' | 'output'> & {input: TSchema; output: TSchema}};
const operations = Object.fromEntries(Object.entries(contract.operations).map(([name, operation]) => {
  const input = structuredClone(operation.input) as TSchema & {properties: Record<string, TSchema>};
  for (const field of uploadFields[name as keyof typeof uploadFields] ?? []) input.properties[field] = Type.Union([input.properties[field], UploadReferenceSchema]);
  return [name, {...operation, input, output: Type.Union([operation.output, DocumentReferenceSchema]),
    description: operation.description + ' Large results return an immutable document reference; use loops_document to read it. ' +
      ((uploadFields[name as keyof typeof uploadFields]?.length ?? 0) ? 'Large input fields accept {$loopsUpload: reference} from loops_upload; the original operation validates and authorizes the uploaded value.' : '')}];
})) as unknown as WireOperations;

export const wireContract = defineFeatureContract({pluginId: contract.pluginId, events: contract.events, operations: {
  ...operations,
  document: {kind: 'query', description: 'Read an immutable large operation result in Unicode character pages. Concatenate text in order, verify sha256 over UTF-8, then parse the complete JSON. Follow nextOffset until null. Only the originating conversation may read it.',
    input: Type.Object({documentId: digest, offset: Type.Optional(offset), limit: Type.Optional(Type.Integer({minimum: 1}))}, strict),
    output: Type.Object({documentId: digest, sha256: digest, text: Type.String(), offset, nextOffset: Type.Union([offset, Type.Null()]), totalCharacters: offset}, strict), tool: {name: 'loops_document'}},
  upload: {kind: 'action', description: 'Stage a large JSON value without executing it. Use one fresh uploadId and append text chunks of at most 16,000 Unicode characters at the returned offset. Retry an identical chunk at its original offset safely. Set complete:true on the last chunk and supply sha256 of the full UTF-8 JSON. Pass the returned reference only in an upload-capable field of the intended loops tool; its original permissions and validation still apply.',
    input: Type.Object({uploadId: Type.String({minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$'}), offset, text: Type.String({maxLength: 32000}), complete: Type.Optional(Type.Boolean()), sha256: Type.Optional(digest)}, strict),
    output: Type.Object({uploadId: Type.String(), offset, completed: Type.Boolean(), reference: Type.Optional(UploadReferenceSchema)}, strict), tool: {name: 'loops_upload'}},
}});
