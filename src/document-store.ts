import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync, lstatSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {Value} from 'typebox/value';
import type {Actor} from './engine.js';
import {fitsFeatureJson, textPage} from './feature-json.js';
import type {DocumentReference, UploadReference} from './wire-contract.js';
import {LoopError, requestError, storageError} from './errors.js';
import {uploadChunkCharacters, uploadEncodedLength, type UploadChunkInput} from './upload-input.js';
import {documentLinks} from './document-links.js';
import type {Json} from './node-values.js';
import {DocumentLinksSchema, MaintenancePolicySchema, TransportReleaseSchema, emptyDocumentLinks, maintenancePreviewPlanId, mergeDocumentLinks, validLifetime, validUploadLifetime,
  type DocumentLifetime, type DocumentLinks, type UploadLifetime, type MaintenancePolicy, type MaintenanceResult, type MaintenanceFile, type ReferenceInventory, type TransportRelease} from './document-maintenance.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const scope = (actor: Actor) => hash(JSON.stringify([actor.agentId, actor.sessionKey, actor.sessionId]));
type Document = {owner: string; sha256: string; text: string; lifecycle?: unknown};
type Upload = {text: string; completed: boolean; reference?: UploadReference; lifecycle?: unknown};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const corrupt = (cause?: unknown) => new LoopError({code: 'LOOPS_DOCUMENT_CORRUPT', message: 'Stored document or upload integrity check failed.', phase: 'storage', retryable: false,
  recovery: 'Preserve the affected transport files for diagnosis. Restore verified document backups, or retry an upload with a fresh uploadId. Do not overwrite damaged evidence.'}, {cause});
const notFound = () => requestError('Document not found in this conversation.', 'LOOPS_DOCUMENT_NOT_FOUND', 'Use the originating conversation and a valid document reference. If its files were removed, restore the matching profile backup.');
const encodingError = () => requestError('Supply exactly one text or textBase64 fragment. Encoded fragments must be bounded canonical Base64 containing valid UTF-8.', 'LOOPS_UPLOAD_ENCODING', 'Encode the exact fragment as standard padded Base64 without whitespace, or send plaintext in text. Keep textBase64 within 65,536 characters; split larger fragments. Do not repair or normalize the content.');
function uploadText(input: UploadChunkInput): string {
  const plain = input.text !== undefined, encoded = input.textBase64 !== undefined;
  if (plain === encoded) throw encodingError();
  if (plain) {
    if (typeof input.text !== 'string') throw encodingError();
    return input.text;
  }
  const text = input.textBase64;
  if (typeof text !== 'string' || text.length > uploadEncodedLength || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw encodingError();
  const bytes = Buffer.from(text, 'base64');
  if (bytes.toString('base64') !== text) throw encodingError();
  // A fragment can start with a BOM inside the complete JSON string. Preserve
  // it, and reject malformed UTF-8 rather than silently replacing its bytes.
  try { return new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes); }
  catch { throw encodingError(); }
}

// Files are immutable response snapshots or explicit request staging, never an
// executable capability. Every read rechecks current host/session authority.
export class DocumentStore {
  constructor(private directory: string, private maxUploadBytes = 8 * 1024 * 1024) {
    try { mkdirSync(directory, {recursive: true, mode: 0o700}); }
    catch (error) { throw storageError(error); }
  }
  private write(name: string, value: unknown, owner?: string) {
    const destination = join(this.directory, name), temporary = owner ? join(this.directory, `temporary-${owner}-${randomUUID()}.tmp`) : `${destination}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(value), {mode: 0o600, flush: true});
      renameSync(temporary, destination);
    } catch (error) {
      const failure = storageError(error);
      // Remove only this attempt's temporary file. A separately committed
      // snapshot may already be referenced and must survive a staging failure.
      try { rmSync(temporary, {force: true}); }
      catch (cleanup) {
        if (failure instanceof LoopError) throw new LoopError({...failure.detail,
          recovery: failure.detail.recovery + ' Temporary-file cleanup also failed; ask the operator to inspect transport staging before retrying.'}, {cause: new AggregateError([error, cleanup])});
      }
      throw failure;
    }
  }
  private readRecord(name: string): unknown {
    let text: string;
    try { text = readFileSync(join(this.directory, name), 'utf8'); }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
      throw storageError(error);
    }
    try { return JSON.parse(text); }
    catch (error) { throw corrupt(error); }
  }
  private storedDocument(actor: Actor, id: string): Document | undefined {
    const document = this.readRecord(`document-${id}.json`);
    if (document === undefined) return undefined;
    if (!record(document) || typeof document.owner !== 'string') throw corrupt();
    if (document.owner !== scope(actor)) throw notFound();
    if (typeof document.text !== 'string' || !digest(document.sha256) || hash(document.text) !== document.sha256 || hash(document.owner + document.sha256) !== id) throw corrupt();
    return {owner: document.owner, sha256: document.sha256, text: document.text, ...document.lifecycle === undefined ? {} : {lifecycle: document.lifecycle}};
  }
  private document(actor: Actor, id: string): Document {
    actor.check();
    if (!digest(id)) throw requestError('Invalid document ID.');
    const document = this.storedDocument(actor, id);
    if (!document) throw notFound();
    return document;
  }
  snapshot(actor: Actor, value: unknown, links?: DocumentLinks, reserveReader = true): DocumentReference {
    actor.check();
    const text = JSON.stringify(value), sha256 = hash(text), owner = scope(actor), documentId = hash(owner + sha256), previewPlanId = maintenancePreviewPlanId(value);
    if (links && !Value.Check(DocumentLinksSchema, links)) throw requestError('Invalid document reference metadata.');
    const saved = this.storedDocument(actor, documentId);
    let readerId: string | undefined;
    if (!saved && !links && !previewPlanId) this.write(`document-${documentId}.json`, {owner, sha256, text});
    else if ((links || previewPlanId) && (!saved || saved.lifecycle !== undefined)) {
      if (saved && (!validLifetime(saved.lifecycle) || saved.lifecycle.owner !== owner)) throw corrupt();
      const at = new Date().toISOString();
      const lifecycle: DocumentLifetime = saved ? structuredClone(saved.lifecycle as DocumentLifetime) :
        {version: 1, owner, createdAt: at, updatedAt: at, links: emptyDocumentLinks(), readers: [], legacyReader: false};
      lifecycle.links = mergeDocumentLinks(lifecycle.links, links ?? emptyDocumentLinks());
      if (previewPlanId) lifecycle.maintenancePreviewPlanId = previewPlanId;
      lifecycle.updatedAt = at;
      if (reserveReader) { readerId = randomUUID(); lifecycle.readers.push({id: readerId, createdAt: at}); }
      this.write(`document-${documentId}.json`, {owner, sha256, text, lifecycle}, owner);
    }
    return {kind: 'loops-document', documentId, sha256, bytes: Buffer.byteLength(text), read: 'loops_document',
      description: 'Complete immutable JSON result. Read all pages with loops_document; nothing was clipped.', ...readerId ? {readerId} : {}};
  }
  wrap(actor: Actor, value: unknown, links?: DocumentLinks) { return fitsFeatureJson(value) ? value : this.snapshot(actor, value, links); }
  read(actor: Actor, id: string, offset = 0, limit = 16000, readerId?: string) {
    const document = this.document(actor, id);
    if (validLifetime(document.lifecycle) && document.lifecycle.owner !== scope(actor)) throw corrupt();
    if (readerId) {
      if (!validLifetime(document.lifecycle) || !document.lifecycle.readers.some(reader => reader.id === readerId))
        throw requestError('This document reader has been released or is unavailable.', 'LOOPS_DOCUMENT_READER_CLOSED', 'Acquire a new reader before continuing to read this document.');
    } else if (validLifetime(document.lifecycle) && !document.lifecycle.legacyReader) {
      // Old callers do not return a handle with subsequent pages. Their lifetime
      // cannot be inferred safely, so preserve the document conservatively.
      document.lifecycle.legacyReader = true; document.lifecycle.updatedAt = new Date().toISOString();
      this.write(`document-${id}.json`, document, scope(actor));
    }
    return {documentId: id, sha256: document.sha256, ...textPage(document.text, offset, limit)};
  }
  acquire(actor: Actor, id: string) {
    const document = this.document(actor, id);
    if (document.lifecycle === undefined) throw requestError('This legacy document is already protected from cleanup.', 'LOOPS_DOCUMENT_LEGACY', 'Read the existing document without a reader handle. Legacy records are preserved.');
    if (!validLifetime(document.lifecycle) || document.lifecycle.owner !== scope(actor)) throw corrupt();
    const readerId = randomUUID(), at = new Date().toISOString();
    document.lifecycle.readers.push({id: readerId, createdAt: at}); document.lifecycle.updatedAt = at;
    this.write(`document-${id}.json`, document, scope(actor));
    return {documentId: id, readerId};
  }
  use(actor: Actor, reference: UploadReference) {
    const document = this.document(actor, reference.$loopsUpload);
    let value: unknown; try { value = JSON.parse(document.text); } catch (error) { throw corrupt(error); }
    const reader = validLifetime(document.lifecycle) ? this.acquire(actor, reference.$loopsUpload) : undefined;
    return {value, documentId: reference.$loopsUpload, ...reader ? {readerId: reader.readerId} : {}};
  }
  finishUse(actor: Actor, id: string, readerId: string | undefined, links: DocumentLinks) {
    const document = this.document(actor, id);
    if (!Value.Check(DocumentLinksSchema, links)) throw requestError('Invalid document reference metadata.');
    if (document.lifecycle === undefined) return;
    if (!validLifetime(document.lifecycle) || document.lifecycle.owner !== scope(actor)) throw corrupt();
    document.lifecycle.links = mergeDocumentLinks(document.lifecycle.links, links);
    document.lifecycle.readers = document.lifecycle.readers.filter(reader => reader.id !== readerId);
    document.lifecycle.updatedAt = new Date().toISOString();
    this.write(`document-${id}.json`, document, scope(actor));
  }
  release(actor: Actor, input: TransportRelease) {
    actor.check();
    if (!Value.Check(TransportReleaseSchema, input)) throw requestError('Invalid transport release request.');
    if (input.kind === 'reader') {
      const document = this.document(actor, input.documentId);
      if (!validLifetime(document.lifecycle) || document.lifecycle.owner !== scope(actor)) throw corrupt();
      const before = document.lifecycle.readers.length;
      document.lifecycle.readers = document.lifecycle.readers.filter(reader => reader.id !== input.readerId);
      if (before === document.lifecycle.readers.length) return {released: false};
      document.lifecycle.updatedAt = new Date().toISOString();
      this.write(`document-${input.documentId}.json`, document, scope(actor));
      return {released: true};
    }
    const name = `upload-${hash(scope(actor) + input.uploadId)}.json`, upload = this.readRecord(name);
    if (!record(upload) || !validUploadLifetime(upload.lifecycle) || upload.lifecycle.owner !== scope(actor) || upload.lifecycle.uploadId !== input.uploadId)
      throw requestError('This upload has no verified lifecycle in this conversation.', 'LOOPS_UPLOAD_LIFETIME_UNKNOWN');
    if (typeof upload.text !== 'string' || hash(upload.text) !== input.sha256) throw requestError('The upload changed since inspection.', 'LOOPS_UPLOAD_CONFLICT');
    if (upload.lifecycle.abandoned) return {released: false};
    upload.lifecycle.abandoned = true; upload.lifecycle.updatedAt = new Date().toISOString();
    this.write(name, upload, scope(actor)); return {released: true};
  }
  resolve(actor: Actor, reference: UploadReference): unknown {
    const text = this.document(actor, reference.$loopsUpload).text;
    try { return JSON.parse(text); }
    catch (error) { throw corrupt(error); }
  }
  contextValue(actor: Actor, documentId: string): Json {
    const text=this.document(actor,documentId).text;
    try { return JSON.parse(text) as Json; }
    catch (error) { throw corrupt(error); }
  }
  upload(actor: Actor, input: UploadChunkInput) {
    actor.check();
    const text = uploadText(input), chunk = Array.from(text);
    if (chunk.length > uploadChunkCharacters) throw requestError('Upload chunks must contain at most 16,000 Unicode characters.');
    const name = `upload-${hash(scope(actor) + input.uploadId)}.json`;
    const saved = this.readRecord(name);
    if (saved !== undefined && (!record(saved) || typeof saved.text !== 'string' || typeof saved.completed !== 'boolean' ||
      (saved.completed ? !record(saved.reference) || !digest(saved.reference.$loopsUpload) : saved.reference !== undefined))) throw corrupt();
    const upload: Upload = saved === undefined ? {text: '', completed: false} : saved as Upload;
    if (upload.lifecycle !== undefined && (!validUploadLifetime(upload.lifecycle) || upload.lifecycle.owner !== scope(actor) || upload.lifecycle.uploadId !== input.uploadId)) throw corrupt();
    if (validUploadLifetime(upload.lifecycle) && upload.lifecycle.abandoned) throw requestError('This upload was explicitly abandoned.', 'LOOPS_UPLOAD_ABANDONED', 'Start a new uploadId for an intentional new upload.');
    const characters = Array.from(upload.text);
    if (input.offset === characters.length && !upload.completed) upload.text += text;
    else if (characters.slice(input.offset, input.offset + chunk.length).join('') !== text || input.offset + chunk.length > characters.length) throw requestError('Upload offset conflict. Retry the identical chunk or use a new uploadId.', 'LOOPS_UPLOAD_CONFLICT');
    if (Buffer.byteLength(upload.text) > this.maxUploadBytes) throw requestError(`Upload exceeds the configured ${this.maxUploadBytes}-byte staging budget.`, 'LOOPS_UPLOAD_TOO_LARGE', 'Reduce the upload or ask the operator to adjust the documented staging budget before explicitly retrying.');
    if (input.complete) {
      if (!input.sha256 || hash(upload.text) !== input.sha256) throw requestError('The completed upload does not match its required sha256.', 'LOOPS_UPLOAD_INTEGRITY', 'Verify the complete UTF-8 JSON digest and retry the identical chunk, or start a fresh uploadId.');
      let value: unknown;
      try { value = JSON.parse(upload.text); }
      catch { throw requestError('The completed upload must contain one valid JSON value.'); }
      const document = this.snapshot(actor, value, emptyDocumentLinks(), false);
      upload.reference = {$loopsUpload: document.documentId}; upload.completed = true;
    }
    const at = new Date().toISOString();
    if (saved === undefined) upload.lifecycle = {version: 1, owner: scope(actor), uploadId: input.uploadId, createdAt: at, updatedAt: at, abandoned: false} satisfies UploadLifetime;
    else if (validUploadLifetime(upload.lifecycle)) upload.lifecycle.updatedAt = at;
    this.write(name, upload, validUploadLifetime(upload.lifecycle) ? scope(actor) : undefined);
    return {uploadId: input.uploadId, offset: Array.from(upload.text).length, completed: upload.completed, ...upload.reference ? {reference: upload.reference} : {}};
  }
  maintenance(actor: Actor, policy: MaintenancePolicy, references: ReferenceInventory, applyPlanId?: string): MaintenanceResult {
    actor.check();
    if (!Value.Check(MaintenancePolicySchema, policy) || policy.olderThanDays === undefined && policy.keepLatest === undefined)
      throw requestError('Transport cleanup requires olderThanDays or keepLatest. No files have been deleted.');
    policy = {...policy.olderThanDays === undefined ? {} : {olderThanDays: policy.olderThanDays}, ...policy.keepLatest === undefined ? {} : {keepLatest: policy.keepLatest}};
    const owner = scope(actor), at = Date.now();
    type Entry = MaintenanceFile & {name: string; fingerprint: string; lifecycle?: DocumentLifetime; upload?: Upload; protection?: keyof MaintenanceResult['protected']};
    const entries: Entry[] = [], linked = new Set<string>();
    const readers: MaintenanceResult['readers'] = [], uploads: MaintenanceResult['uploads'] = [];
    try {
      for (const name of readdirSync(this.directory).sort()) {
        const path = join(this.directory, name), stat = lstatSync(path);
        if (!stat.isFile()) continue;
        const temporary = new RegExp(`^temporary-${owner}-[a-f0-9-]{36}\\.tmp$`).test(name);
        const match = /^(document|upload)-([a-f0-9]{64})\.json$/.exec(name);
        if (!temporary && !match) continue;
        const content = readFileSync(path), fingerprint = createHash('sha256').update(content).digest('hex');
        if (temporary) { entries.push({name, id: name, kind: 'temporary', bytes: stat.size, updatedAt: stat.mtime.toISOString(), fingerprint}); continue; }
        let saved: unknown; try { saved = JSON.parse(content.toString('utf8')); } catch { continue; }
        if (!record(saved)) continue;
        const kind = match![1] as 'document' | 'upload', id = match![2];
        const lifetime = saved.lifecycle;
        if ((kind === 'document' ? saved.owner : record(lifetime) ? lifetime.owner : undefined) !== owner) continue;
        const entry: Entry = {name, id, kind, bytes: stat.size, updatedAt: stat.mtime.toISOString(), fingerprint};
        if (kind === 'document') {
          let validJson = false;
          if (typeof saved.text === 'string') {
            try { for (const id of documentLinks('legacy', {}, JSON.parse(saved.text)).documents) linked.add(id); validJson = true; }
            catch { /* Preserve the owning document below when its stored payload cannot be classified. */ }
          }
          if (!validJson || typeof saved.text !== 'string' || !digest(saved.sha256) || hash(saved.text) !== saved.sha256 || hash(owner + saved.sha256) !== id) entry.protection = 'corrupt';
          else if (lifetime === undefined) entry.protection = 'legacy';
          else if (!validLifetime(lifetime) || lifetime.owner !== owner) entry.protection = 'corrupt';
          else {
            if (applyPlanId !== undefined && lifetime.maintenancePreviewPlanId === applyPlanId) continue;
            entry.lifecycle = lifetime; entry.updatedAt = lifetime.updatedAt;
            for (const document of lifetime.links.documents) linked.add(document);
            for (const reader of lifetime.readers) readers.push({documentId: id, readerId: reader.id, createdAt: reader.createdAt});
          }
        } else if (!validUploadLifetime(lifetime) || hash(owner + lifetime.uploadId) !== id || typeof saved.text !== 'string' || typeof saved.completed !== 'boolean' ||
          saved.completed && (!record(saved.reference) || !digest(saved.reference.$loopsUpload))) entry.protection = 'corrupt';
        else {
          entry.upload = saved as Upload; entry.updatedAt = lifetime.updatedAt;
          if (saved.completed && record(saved.reference)) linked.add(saved.reference.$loopsUpload as string);
          if (!saved.completed && !lifetime.abandoned) { entry.protection = 'uploads'; uploads.push({uploadId: lifetime.uploadId, sha256: hash(saved.text as string), updatedAt: lifetime.updatedAt}); }
        }
        entries.push(entry);
      }
    } catch (error) { throw error instanceof LoopError ? error : storageError(error); }
    entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name));
    const protectedCounts: MaintenanceResult['protected'] = {legacy: 0, corrupt: 0, readers: 0, uploads: 0, referenced: 0, recent: 0};
    const eligible = entries.filter((entry, index) => {
      let protection = entry.protection;
      const lifetime = entry.lifecycle;
      if (!protection && lifetime) {
        if (lifetime.legacyReader || lifetime.links.unknown) protection = 'legacy';
        else if (lifetime.readers.length) protection = 'readers';
        else if (lifetime.links.runs.some(id => references.runs.has(id)) || lifetime.links.loops.some(id => references.loops.has(id))) protection = 'referenced';
      }
      if (!protection && entry.kind === 'document' && (linked.has(entry.id) || references.documents.has(entry.id))) protection = 'referenced';
      if (!protection && (index < (policy.keepLatest ?? 0) || policy.olderThanDays !== undefined && Date.parse(entry.updatedAt) >= at - policy.olderThanDays * 86400000)) protection = 'recent';
      if (protection) { protectedCounts[protection]++; return false; } return true;
    });
    const planId = hash(JSON.stringify([owner, policy, eligible.map(entry => [entry.name, entry.fingerprint])])), candidates = eligible.map(({id, kind, bytes, updatedAt}) => ({id, kind, bytes, updatedAt}));
    const result: MaintenanceResult = {planId, policy, applied: false, candidates, bytes: candidates.reduce((sum, file) => sum + file.bytes, 0), protected: protectedCounts, readers, uploads, total: entries.length};
    if (applyPlanId !== undefined) {
      if (applyPlanId !== planId) throw requestError('Transport cleanup changed since preview. No files have been deleted.', 'LOOPS_MAINTENANCE_CONFLICT', 'Preview the current candidate set before applying cleanup.');
      let removed = 0;
      try {
        for (const entry of eligible) {
          actor.check(); const path = join(this.directory, entry.name);
          if (!lstatSync(path).isFile() || createHash('sha256').update(readFileSync(path)).digest('hex') !== entry.fingerprint) throw requestError('A transport file changed during cleanup.', 'LOOPS_MAINTENANCE_CONFLICT');
          unlinkSync(path); removed++;
        }
      } catch (error) {
        if (!removed) throw error instanceof LoopError ? error : storageError(error);
        throw new LoopError({code: 'LOOPS_MAINTENANCE_PARTIAL', message: `Transport cleanup stopped after removing ${removed} of ${eligible.length} eligible files.`, phase: 'storage', retryable: false,
          recovery: 'Preserve the remaining files and inspect storage and permissions. Preview again to reclaim the remaining candidates. Earlier deletions are not rolled back.'}, {cause: error});
      }
      result.applied = true;
    }
    return result;
  }
}
