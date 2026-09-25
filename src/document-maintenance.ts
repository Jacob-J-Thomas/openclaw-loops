import {Type, type Static} from 'typebox';
import {Value} from 'typebox/value';
import {RetentionPolicySchema} from './retention.js';

const strict = {additionalProperties: false} as const;
const digest = Type.String({pattern: '^[a-f0-9]{64}$'});
const timestamp = Type.String({minLength: 1});
const readerId = Type.String({pattern: '^[a-f0-9-]{36}$'});
export const DocumentLinksSchema = Type.Object({
  runs: Type.Array(Type.String({minLength: 1})),
  loops: Type.Array(Type.String({minLength: 1})),
  documents: Type.Array(digest),
  unknown: Type.Boolean(),
}, strict);
export type DocumentLinks = Static<typeof DocumentLinksSchema>;
export const emptyDocumentLinks = (): DocumentLinks => ({runs: [], loops: [], documents: [], unknown: false});
export const DocumentLifetimeSchema = Type.Object({
  version: Type.Literal(1), owner: digest, createdAt: timestamp, updatedAt: timestamp,
  links: DocumentLinksSchema,
  readers: Type.Array(Type.Object({id: readerId, createdAt: timestamp}, strict)),
  legacyReader: Type.Boolean(),
  maintenancePreviewPlanId: Type.Optional(digest),
}, strict);
export type DocumentLifetime = Static<typeof DocumentLifetimeSchema>;
export const UploadLifetimeSchema = Type.Object({
  version: Type.Literal(1), owner: digest, createdAt: timestamp, updatedAt: timestamp,
  uploadId: Type.String({minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$'}),
  abandoned: Type.Boolean(),
}, strict);
export type UploadLifetime = Static<typeof UploadLifetimeSchema>;
export const MaintenancePolicySchema = RetentionPolicySchema;
export type MaintenancePolicy = Static<typeof MaintenancePolicySchema>;
export const TransportReleaseSchema = Type.Union([
  Type.Object({kind: Type.Literal('reader'), documentId: digest, readerId}, strict),
  Type.Object({kind: Type.Literal('upload'), uploadId: Type.String({minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$'}), sha256: digest}, strict),
]);
export type TransportRelease = Static<typeof TransportReleaseSchema>;
const file = Type.Object({
  id: Type.String(), kind: Type.Union([Type.Literal('document'), Type.Literal('upload'), Type.Literal('temporary')]),
  bytes: Type.Integer({minimum: 0}), updatedAt: timestamp,
}, strict);
export type MaintenanceFile = Static<typeof file>;
export const MaintenanceResultSchema = Type.Object({
  planId: digest, policy: MaintenancePolicySchema, applied: Type.Boolean(),
  candidates: Type.Array(file), bytes: Type.Integer({minimum: 0}),
  protected: Type.Object({legacy: Type.Integer({minimum: 0}), corrupt: Type.Integer({minimum: 0}), readers: Type.Integer({minimum: 0}), uploads: Type.Integer({minimum: 0}), referenced: Type.Integer({minimum: 0}), recent: Type.Integer({minimum: 0})}, strict),
  readers: Type.Array(Type.Object({documentId: digest, readerId, createdAt: timestamp}, strict)),
  uploads: Type.Array(Type.Object({uploadId: Type.String(), sha256: digest, updatedAt: timestamp}, strict)),
  total: Type.Integer({minimum: 0}),
}, strict);
export type MaintenanceResult = Static<typeof MaintenanceResultSchema>;
export type ReferenceInventory = {runs: ReadonlySet<string>; loops: ReadonlySet<string>; documents: ReadonlySet<string>};

// A large preview may need a managed response document. It is created only
// after this plan ID is calculated, so applying that exact preview ignores the
// response document itself. A later preview includes it for normal cleanup.
export function maintenancePreviewPlanId(value: unknown): string | undefined {
  return Value.Check(MaintenanceResultSchema, value) && !value.applied ? value.planId : undefined;
}

export function validLifetime(value: unknown): value is DocumentLifetime {
  return Value.Check(DocumentLifetimeSchema, value) && Number.isFinite(Date.parse(value.createdAt)) &&
    Number.isFinite(Date.parse(value.updatedAt)) && value.readers.every(reader => Number.isFinite(Date.parse(reader.createdAt))) &&
    new Set(value.readers.map(reader => reader.id)).size === value.readers.length;
}
export function validUploadLifetime(value: unknown): value is UploadLifetime {
  return Value.Check(UploadLifetimeSchema, value) && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt));
}
export function mergeDocumentLinks(left: DocumentLinks, right: DocumentLinks): DocumentLinks {
  return {runs: [...new Set([...left.runs, ...right.runs])].sort(), loops: [...new Set([...left.loops, ...right.loops])].sort(),
    documents: [...new Set([...left.documents, ...right.documents])].sort(), unknown: left.unknown || right.unknown};
}
