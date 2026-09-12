import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Actor} from './engine.js';
import {fitsFeatureJson, textPage} from './feature-json.js';
import type {DocumentReference, UploadReference} from './wire-contract.js';
import {LoopError, requestError, storageError} from './errors.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const scope = (actor: Actor) => hash(JSON.stringify([actor.agentId, actor.sessionKey, actor.sessionId]));
type Document = {owner: string; sha256: string; text: string};
type Upload = {text: string; completed: boolean; reference?: UploadReference};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const corrupt = (cause?: unknown) => new LoopError({code: 'LOOPS_DOCUMENT_CORRUPT', message: 'Stored document or upload integrity check failed.', phase: 'storage', retryable: false,
  recovery: 'Preserve the affected transport files for diagnosis. Restore verified document backups, or retry an upload with a fresh uploadId. Do not overwrite damaged evidence.'}, {cause});
const notFound = () => requestError('Document not found in this conversation.', 'LOOPS_DOCUMENT_NOT_FOUND', 'Use the originating conversation and a valid document reference. If its files were removed, restore the matching profile backup.');

// Files are immutable response snapshots or explicit request staging, never an
// executable capability. Every read rechecks current host/session authority.
export class DocumentStore {
  constructor(private directory: string, private maxUploadBytes = 8 * 1024 * 1024) {
    try { mkdirSync(directory, {recursive: true, mode: 0o700}); }
    catch (error) { throw storageError(error); }
  }
  private write(name: string, value: unknown) {
    const destination = join(this.directory, name), temporary = `${destination}.${randomUUID()}.tmp`;
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
    return {owner: document.owner, sha256: document.sha256, text: document.text};
  }
  private document(actor: Actor, id: string): Document {
    actor.check();
    if (!digest(id)) throw requestError('Invalid document ID.');
    const document = this.storedDocument(actor, id);
    if (!document) throw notFound();
    return document;
  }
  snapshot(actor: Actor, value: unknown): DocumentReference {
    actor.check();
    const text = JSON.stringify(value), sha256 = hash(text), owner = scope(actor), documentId = hash(owner + sha256);
    if (!this.storedDocument(actor, documentId)) this.write(`document-${documentId}.json`, {owner, sha256, text});
    return {kind: 'loops-document', documentId, sha256, bytes: Buffer.byteLength(text), read: 'loops_document', description: 'Complete immutable JSON result. Read all pages with loops_document; nothing was clipped.'};
  }
  wrap(actor: Actor, value: unknown) { return fitsFeatureJson(value) ? value : this.snapshot(actor, value); }
  read(actor: Actor, id: string, offset = 0, limit = 16000) {
    const document = this.document(actor, id);
    return {documentId: id, sha256: document.sha256, ...textPage(document.text, offset, limit)};
  }
  resolve(actor: Actor, reference: UploadReference): unknown {
    const text = this.document(actor, reference.$loopsUpload).text;
    try { return JSON.parse(text); }
    catch (error) { throw corrupt(error); }
  }
  upload(actor: Actor, input: {uploadId: string; offset: number; text: string; complete?: boolean; sha256?: string}) {
    actor.check();
    const name = `upload-${hash(scope(actor) + input.uploadId)}.json`;
    const saved = this.readRecord(name);
    if (saved !== undefined && (!record(saved) || typeof saved.text !== 'string' || typeof saved.completed !== 'boolean' ||
      (saved.completed ? !record(saved.reference) || !digest(saved.reference.$loopsUpload) : saved.reference !== undefined))) throw corrupt();
    const upload: Upload = saved === undefined ? {text: '', completed: false} : saved as Upload;
    const characters = Array.from(upload.text), chunk = Array.from(input.text);
    if (chunk.length > 16000) throw requestError('Upload chunks must contain at most 16,000 Unicode characters.');
    if (input.offset === characters.length && !upload.completed) upload.text += input.text;
    else if (characters.slice(input.offset, input.offset + chunk.length).join('') !== input.text || input.offset + chunk.length > characters.length) throw requestError('Upload offset conflict. Retry the identical chunk or use a new uploadId.', 'LOOPS_UPLOAD_CONFLICT');
    if (Buffer.byteLength(upload.text) > this.maxUploadBytes) throw requestError(`Upload exceeds the configured ${this.maxUploadBytes}-byte staging budget.`, 'LOOPS_UPLOAD_TOO_LARGE', 'Reduce the upload or ask the operator to adjust the documented staging budget before explicitly retrying.');
    if (input.complete) {
      if (!input.sha256 || hash(upload.text) !== input.sha256) throw requestError('The completed upload does not match its required sha256.', 'LOOPS_UPLOAD_INTEGRITY', 'Verify the complete UTF-8 JSON digest and retry the identical chunk, or start a fresh uploadId.');
      let value: unknown;
      try { value = JSON.parse(upload.text); }
      catch { throw requestError('The completed upload must contain one valid JSON value.'); }
      const document = this.snapshot(actor, value);
      upload.reference = {$loopsUpload: document.documentId}; upload.completed = true;
    }
    this.write(name, upload);
    return {uploadId: input.uploadId, offset: Array.from(upload.text).length, completed: upload.completed, ...upload.reference ? {reference: upload.reference} : {}};
  }
}
