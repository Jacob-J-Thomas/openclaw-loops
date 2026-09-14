import {describe, expect, it} from 'vitest';
import {documentLinks} from '../src/document-links.js';

describe('transport evidence provenance', () => {
  it('retains the represented run or immutable definition without treating node IDs as owners', () => {
    expect(documentLinks('inspect', {runId: 'run'}, {id: 'run', definition: {id: 'loop', nodes: [{id: 'node'}]}})).toEqual({runs: ['run'], loops: [], documents: [], unknown: false});
    expect(documentLinks('create', {}, {record: {definition: {id: 'loop', nodes: [{id: 'node'}]}}})).toEqual({runs: [], loops: ['loop'], documents: [], unknown: false});
    expect(documentLinks('output', {runId: 'run'}, {runId: 'run', text: '{"id":"arbitrary output"}'}).runs).toEqual(['run']);
    expect(documentLinks('restore', {id: 'loop'}, {record: {definition: {id: 'loop', revision: 7}}}).loops).toEqual(['loop']);
  });
  it('tracks explicit nested document references without retaining a cleanup preview’s own candidates', () => {
    const documentId = 'a'.repeat(64), readerId = '11111111-1111-1111-1111-111111111111';
    expect(documentLinks('maintenance', {}, {candidates: [{id: documentId, kind: 'document'}], readers: [{documentId, readerId}]})).toEqual({runs: [], loops: [], documents: [], unknown: false});
    expect(documentLinks('inspect', {}, {id: 'run', outputs: {saved: {kind: 'loops-document', documentId}, another: {$loopsUpload: documentId}}}).documents).toEqual([documentId]);
    expect(documentLinks('future-operation', {}, {}).unknown).toBe(true);
  });
  it('walks wide JSON arrays without spreading them into an argument list', () => {
    const documentId = 'b'.repeat(64), value: unknown[] = Array.from({length: 200000}, () => 0); value.push({kind: 'loops-document', documentId});
    expect(documentLinks('validate', {}, value).documents).toEqual([documentId]);
  });
});
