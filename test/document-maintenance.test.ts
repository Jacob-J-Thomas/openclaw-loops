import {afterEach, describe, expect, it, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync, utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DocumentStore} from '../src/document-store.js';
import {emptyDocumentLinks} from '../src/document-maintenance.js';
import type {Actor} from '../src/engine.js';

vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return {...fs, unlinkSync: vi.fn(fs.unlinkSync), writeFileSync: vi.fn(fs.writeFileSync)};
});
const roots: string[] = [];
const actor: Actor = {agentId: 'main', sessionKey: 'agent:main:maintenance', sessionId: 'one', source: 'tool', human: false, check: () => {}};
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const references = () => ({runs: new Set<string>(), loops: new Set<string>()});
const all = {keepLatest: 0};
function setup() { const root = mkdtempSync(join(tmpdir(), 'loops-maintenance-')); roots.push(root); return {root, store: new DocumentStore(root)}; }
afterEach(() => { vi.resetAllMocks(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });

describe('explicit transport maintenance', () => {
  it('preserves malformed JSON even when its transport digest and lifecycle are valid', () => {
    const {root, store} = setup(), reference = store.snapshot(actor, {original: true}, emptyDocumentLinks(), false);
    const document = JSON.parse(readFileSync(join(root, `document-${reference.documentId}.json`), 'utf8'));
    document.text = '{incomplete JSON'; document.sha256 = hash(document.text);
    const damagedId = hash(document.owner + document.sha256);
    writeFileSync(join(root, `document-${damagedId}.json`), JSON.stringify(document));
    const preview = store.maintenance(actor, all, references());
    expect(preview.protected.corrupt).toBe(1); expect(preview.candidates.map(file => file.id)).toEqual([reference.documentId]);
    store.maintenance(actor, all, references(), preview.planId);
    expect(readdirSync(root)).toEqual([`document-${damagedId}.json`]);
  });
  it('applies explicit age and count conditions together and reclaims only owner-attributed old temporary writes', () => {
    const {root, store} = setup(), at = Date.parse('2026-09-13T12:00:00Z'); vi.spyOn(Date, 'now').mockReturnValue(at);
    const owner = hash(JSON.stringify([actor.agentId, actor.sessionKey, actor.sessionId]));
    const names = [0, 1, 5].map((days, i) => {
      const name = `temporary-${owner}-11111111-1111-4111-8111-11111111111${i}.tmp`, path = join(root, name);
      writeFileSync(path, `Abandoned temporary ${days}`); utimesSync(path, new Date(at - days * 86400000), new Date(at - days * 86400000)); return name;
    });
    writeFileSync(join(root, 'document-legacy.11111111-1111-4111-8111-111111111111.tmp'), 'Unattributed temporary');
    expect(() => store.maintenance(actor, {}, references())).toThrow('requires olderThanDays or keepLatest');
    const policy = {olderThanDays: 2, keepLatest: 1}, preview = store.maintenance(actor, policy, references());
    expect(preview.candidates.map(file => file.id)).toEqual([names[2]]); expect(preview.protected.recent).toBe(2);
    expect(store.maintenance(actor, {keepLatest: 1, olderThanDays: 2}, references(), preview.planId).applied).toBe(true);
    const zero = store.maintenance(actor, {olderThanDays: 0, keepLatest: 0}, references());
    expect(zero.candidates.map(file => file.id)).toEqual([names[1]]); expect(zero.protected.recent).toBe(1);
    expect(readdirSync(root)).toHaveLength(3); vi.restoreAllMocks();
  });
  it('preserves legacy records and reclaims only explicitly released managed snapshots', () => {
    const {root, store} = setup(), legacy = store.snapshot(actor, {legacy: true}), managed = store.snapshot(actor, {new: true}, emptyDocumentLinks());
    expect(managed.readerId).toBeTruthy();
    const held = store.maintenance(actor, all, references());
    expect(held.candidates).toEqual([]); expect(held.protected).toMatchObject({legacy: 1, readers: 1});
    expect(store.release(actor, {kind: 'reader', documentId: managed.documentId, readerId: managed.readerId!})).toEqual({released: true});
    expect(store.release(actor, {kind: 'reader', documentId: managed.documentId, readerId: managed.readerId!})).toEqual({released: false});
    const preview = store.maintenance(actor, all, references()), bytesBefore = readdirSync(root).reduce((n, file) => n + readFileSync(join(root, file)).length, 0);
    expect(preview.candidates.map(file => file.id)).toEqual([managed.documentId]); expect(preview.bytes).toBeGreaterThan(0);
    expect(store.maintenance(actor, all, references(), preview.planId).applied).toBe(true);
    expect(bytesBefore - readdirSync(root).reduce((n, file) => n + readFileSync(join(root, file)).length, 0)).toBe(preview.bytes);
    expect(new DocumentStore(root).read(actor, legacy.documentId).text).toBe('{"legacy":true}');
    expect(() => store.read(actor, managed.documentId)).toThrow('not found');
  });
  it('persists independent readers through reopen and refuses a stale cleanup preview after acquisition', () => {
    const {root, store} = setup(), text = '🙂"\\'.repeat(20000), reference = store.snapshot(actor, {text}, emptyDocumentLinks(), false);
    const preview = store.maintenance(actor, all, references()), first = store.acquire(actor, reference.documentId), second = store.acquire(actor, reference.documentId);
    expect(first.readerId).not.toBe(second.readerId);
    expect(() => store.maintenance(actor, all, references(), preview.planId)).toThrow('changed since preview');
    const reopened = new DocumentStore(root); reopened.release(actor, {kind: 'reader', ...first});
    expect(reopened.maintenance(actor, all, references()).readers.map(reader => reader.readerId)).toEqual([second.readerId]);
    expect(() => reopened.read(actor, reference.documentId, 0, 16000, first.readerId)).toThrow('released');
    let value = '', offset = 0;
    for (;;) { const page = reopened.read(actor, reference.documentId, offset, 1000, second.readerId); value += page.text; if (page.nextOffset === null) break; offset = page.nextOffset; }
    expect(JSON.parse(value)).toEqual({text}); expect(hash(value)).toBe(reference.sha256);
    reopened.release(actor, {kind: 'reader', ...second});
    expect(reopened.maintenance(actor, all, references()).candidates).toHaveLength(1);
  });
  it('applies a preview after its released managed response is created, then reclaims that response on the next preview', () => {
    const {store} = setup(), original = store.snapshot(actor, {eligible: true}, emptyDocumentLinks(), false);
    const preview = store.maintenance(actor, all, references()), response = store.snapshot(actor, preview, emptyDocumentLinks());
    expect(response.readerId).toBeTruthy();
    expect(store.release(actor, {kind: 'reader', documentId: response.documentId, readerId: response.readerId!})).toEqual({released: true});
    expect(store.maintenance(actor, all, references(), preview.planId)).toMatchObject({applied: true, candidates: [{id: original.documentId}]});
    expect(store.maintenance(actor, all, references()).candidates.map(file => file.id)).toEqual([response.documentId]);
  });
  it('does not let a released preview response displace a retained count group while applying', () => {
    const {store} = setup();
    store.snapshot(actor, {eligible: 'first'}, emptyDocumentLinks(), false);
    store.snapshot(actor, {eligible: 'second'}, emptyDocumentLinks(), false);
    const policy = {keepLatest: 1}, preview = store.maintenance(actor, policy, references()), response = store.snapshot(actor, preview, emptyDocumentLinks());
    store.release(actor, {kind: 'reader', documentId: response.documentId, readerId: response.readerId!});
    expect(store.maintenance(actor, policy, references(), preview.planId)).toMatchObject({applied: true, candidates: preview.candidates});
  });
  it('keeps untracked compatibility readers protected after a tracked reader is released', () => {
    const {root, store} = setup(), reference = store.snapshot(actor, {large: 'x'.repeat(100000)}, emptyDocumentLinks());
    expect(store.read(actor, reference.documentId, 0, 100).nextOffset).not.toBeNull();
    store.release(actor, {kind: 'reader', documentId: reference.documentId, readerId: reference.readerId!});
    const reopened = new DocumentStore(root), preview = reopened.maintenance(actor, all, references());
    expect(preview.candidates).toEqual([]); expect(preview.protected.legacy).toBe(1);
    expect(reopened.read(actor, reference.documentId, 100, 100).offset).toBe(100);
  });
  it('protects retained run and revision references, nested document dependencies and unknown provenance', () => {
    const {store} = setup();
    const run = store.snapshot(actor, {run: 'evidence'}, {...emptyDocumentLinks(), runs: ['parked-run', 'settling-run']}, false);
    const loop = store.snapshot(actor, {revision: 4}, {...emptyDocumentLinks(), loops: ['saved-loop']}, false);
    const unknown = store.snapshot(actor, {unknown: true}, {...emptyDocumentLinks(), unknown: true}, false);
    const child = store.snapshot(actor, {reference: run.documentId}, {...emptyDocumentLinks(), documents: [run.documentId]}, false);
    const inventory = {runs: new Set(['parked-run', 'settling-run']), loops: new Set(['saved-loop'])};
    const preview = store.maintenance(actor, all, inventory);
    expect(preview.candidates.map(file => file.id)).toEqual([child.documentId]); expect(preview.protected.referenced).toBe(2); expect(preview.protected.legacy).toBe(1);
    store.maintenance(actor, all, inventory, preview.planId);
    expect(store.maintenance(actor, all, inventory).candidates).toEqual([]);
    const released = store.maintenance(actor, all, references());
    expect(new Set(released.candidates.map(file => file.id))).toEqual(new Set([run.documentId, loop.documentId]));
    expect(released.candidates.some(file => file.id === unknown.documentId)).toBe(false);
  });
  it('protects open staging until an explicit unchanged-content abandonment and preserves completion references', () => {
    const {root, store} = setup(), prefix = '{"text":"', suffix = 'saved"}', full = prefix + suffix;
    store.upload(actor, {uploadId: 'open', offset: 0, text: prefix});
    const active = store.maintenance(actor, all, references()); expect(active.protected.uploads).toBe(1); expect(active.uploads[0].sha256).toBe(hash(prefix));
    store.upload(actor, {uploadId: 'open', offset: prefix.length, text: suffix});
    expect(() => store.release(actor, {kind: 'upload', uploadId: 'open', sha256: active.uploads[0].sha256})).toThrow('changed since inspection');
    store.release(actor, {kind: 'upload', uploadId: 'open', sha256: hash(full)});
    expect(() => store.upload(actor, {uploadId: 'open', offset: 0, text: prefix})).toThrow('abandoned');
    const completed = store.upload(actor, {uploadId: 'completed', offset: 0, text: full, complete: true, sha256: hash(full)});
    const preview = store.maintenance(actor, all, references()); expect(preview.candidates.every(file => file.kind === 'upload')).toBe(true); expect(preview.candidates).toHaveLength(2); expect(preview.protected.referenced).toBe(1);
    store.maintenance(actor, all, references(), preview.planId);
    const reopened = new DocumentStore(root), next = reopened.maintenance(actor, all, references()); expect(next.candidates.map(file => file.id)).toEqual([completed.reference!.$loopsUpload]);
    reopened.maintenance(actor, all, references(), next.planId); expect(readdirSync(root)).toEqual([]);
  });
  it('holds resolved input through dispatch, then pins its resulting evidence before releasing that use', () => {
    const {root, store} = setup(), text = '{"input":"retained"}', uploaded = store.upload(actor, {uploadId: 'request', offset: 0, text, complete: true, sha256: hash(text)});
    const use = store.use(actor, uploaded.reference!); expect(use.value).toEqual({input: 'retained'});
    const preview = store.maintenance(actor, all, references()); expect(preview.protected.readers).toBe(1);
    store.finishUse(actor, use.documentId, use.readerId, {...emptyDocumentLinks(), runs: ['accepted-run']});
    const reopened = new DocumentStore(root), inventory = {runs: new Set(['accepted-run']), loops: new Set<string>()};
    expect(reopened.maintenance(actor, all, inventory).readers).toEqual([]);
    const staging = reopened.maintenance(actor, all, inventory); reopened.maintenance(actor, all, inventory, staging.planId);
    expect(reopened.maintenance(actor, all, inventory).protected.referenced).toBe(1);
  });
  it('isolates conversation ownership and preserves unowned or damaged legacy files', () => {
    const {root, store} = setup(), other = {...actor, sessionId: 'another-generation'};
    store.snapshot(other, {private: 'foreign content'}, emptyDocumentLinks(), false);
    store.upload(other, {uploadId: 'foreign', offset: 0, text: 'private upload'});
    writeFileSync(join(root, `upload-${'a'.repeat(64)}.json`), '{"text":"legacy unowned","completed":false}');
    writeFileSync(join(root, `document-${'b'.repeat(64)}.json`), '{partial unknown evidence');
    const own = store.snapshot(actor, {own: true}, emptyDocumentLinks(), false), preview = store.maintenance(actor, all, references());
    expect(preview.total).toBe(1); expect(JSON.stringify(preview)).not.toMatch(/foreign|private|unowned/);
    store.maintenance(actor, all, references(), preview.planId); expect(readdirSync(root)).toHaveLength(4);
    expect(() => store.read(other, own.documentId)).toThrow('not found');
    expect(() => store.maintenance({...actor, check: () => { throw Error('revoked'); }}, all, references())).toThrow('revoked');
  });
  it('reports partial reclamation honestly and resumes from a new preview after reopen', () => {
    const {root, store} = setup(); for (let i = 0; i < 3; i++) store.snapshot(actor, {i}, emptyDocumentLinks(), false);
    const preview = store.maintenance(actor, all, references()), real = vi.mocked(unlinkSync).getMockImplementation()!; let calls = 0;
    vi.mocked(unlinkSync).mockImplementation(path => { if (++calls === 2) throw Object.assign(Error('private failing path'), {code: 'EIO'}); real(path); });
    expect(() => store.maintenance(actor, all, references(), preview.planId)).toThrow(expect.objectContaining({detail: expect.objectContaining({code: 'LOOPS_MAINTENANCE_PARTIAL', message: expect.stringMatching(/1 of 3/)})}));
    expect(readdirSync(root)).toHaveLength(2); vi.mocked(unlinkSync).mockReset();
    const reopened = new DocumentStore(root); expect(() => reopened.maintenance(actor, all, references(), preview.planId)).toThrow('changed since preview');
    const next = reopened.maintenance(actor, all, references()); reopened.maintenance(actor, all, references(), next.planId); expect(readdirSync(root)).toEqual([]);
  });
  it('reads an already-reserved managed document without allocating files when the disk is full', () => {
    const {store} = setup(), value = {text: 'complete result'}, reference = store.snapshot(actor, value, emptyDocumentLinks());
    vi.mocked(writeFileSync).mockImplementation(() => { throw Object.assign(Error('disk full'), {code: 'ENOSPC'}); });
    expect(store.read(actor, reference.documentId, 0, 16000, reference.readerId).text).toBe(JSON.stringify(value));
    expect(() => store.release(actor, {kind: 'reader', documentId: reference.documentId, readerId: reference.readerId!})).toThrow(expect.objectContaining({detail: expect.objectContaining({code: 'LOOPS_STORAGE_FULL'})}));
    expect(store.maintenance(actor, all, references()).protected.readers).toBe(1);
  });
});
