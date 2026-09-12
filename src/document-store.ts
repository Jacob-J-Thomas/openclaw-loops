import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Actor} from './engine.js';
import {fitsFeatureJson, textPage} from './feature-json.js';
import type {DocumentReference, UploadReference} from './wire-contract.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const scope = (actor: Actor) => hash(JSON.stringify([actor.agentId, actor.sessionKey, actor.sessionId]));
type Document = {owner: string; sha256: string; text: string};
type Upload = {text: string; completed: boolean; reference?: UploadReference};

// Files are immutable response snapshots or explicit request staging, never an
// executable capability. Every read rechecks current host/session authority.
export class DocumentStore {
  constructor(private directory: string, private maxUploadBytes = 8 * 1024 * 1024) {
    mkdirSync(directory, {recursive: true, mode: 0o700});
  }
  private write(name: string, value: unknown) {
    const destination = join(this.directory, name), temporary = `${destination}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(value), {mode: 0o600, flush: true});
    renameSync(temporary, destination);
  }
  private document(actor: Actor, id: string): Document {
    actor.check();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid document ID.');
    let document: Document;
    try { document = JSON.parse(readFileSync(join(this.directory, `document-${id}.json`), 'utf8')); }
    catch { throw new Error('Document not found in this conversation.'); }
    if (document.owner !== scope(actor)) throw new Error('Document not found in this conversation.');
    if (hash(document.text) !== document.sha256 || hash(document.owner + document.sha256) !== id) throw new Error('Document integrity check failed.');
    return document;
  }
  snapshot(actor: Actor, value: unknown): DocumentReference {
    actor.check();
    const text = JSON.stringify(value), sha256 = hash(text), owner = scope(actor), documentId = hash(owner + sha256);
    if (!existsSync(join(this.directory, `document-${documentId}.json`))) this.write(`document-${documentId}.json`, {owner, sha256, text});
    return {kind: 'loops-document', documentId, sha256, bytes: Buffer.byteLength(text), read: 'loops_document', description: 'Complete immutable JSON result. Read all pages with loops_document; nothing was clipped.'};
  }
  wrap(actor: Actor, value: unknown) { return fitsFeatureJson(value) ? value : this.snapshot(actor, value); }
  read(actor: Actor, id: string, offset = 0, limit = 16000) {
    const document = this.document(actor, id);
    return {documentId: id, sha256: document.sha256, ...textPage(document.text, offset, limit)};
  }
  resolve(actor: Actor, reference: UploadReference): unknown { return JSON.parse(this.document(actor, reference.$loopsUpload).text); }
  upload(actor: Actor, input: {uploadId: string; offset: number; text: string; complete?: boolean; sha256?: string}) {
    actor.check();
    const name = `upload-${hash(scope(actor) + input.uploadId)}.json`;
    const upload: Upload = existsSync(join(this.directory, name)) ? JSON.parse(readFileSync(join(this.directory, name), 'utf8')) : {text: '', completed: false};
    const characters = Array.from(upload.text), chunk = Array.from(input.text);
    if (chunk.length > 16000) throw new Error('Upload chunks must contain at most 16,000 Unicode characters.');
    if (input.offset === characters.length && !upload.completed) upload.text += input.text;
    else if (characters.slice(input.offset, input.offset + chunk.length).join('') !== input.text || input.offset + chunk.length > characters.length) throw new Error('Upload offset conflict. Retry the identical chunk or use a new uploadId.');
    if (Buffer.byteLength(upload.text) > this.maxUploadBytes) throw new Error(`Upload exceeds the configured ${this.maxUploadBytes}-byte staging budget.`);
    if (input.complete) {
      if (!input.sha256 || hash(upload.text) !== input.sha256) throw new Error('The completed upload does not match its required sha256.');
      const value: unknown = JSON.parse(upload.text);
      const document = this.snapshot(actor, value);
      upload.reference = {$loopsUpload: document.documentId}; upload.completed = true;
    }
    this.write(name, upload);
    return {uploadId: input.uploadId, offset: Array.from(upload.text).length, completed: upload.completed, ...upload.reference ? {reference: upload.reference} : {}};
  }
}
