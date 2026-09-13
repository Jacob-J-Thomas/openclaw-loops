import {describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import type {FeatureTransport} from 'openclaw/plugin-sdk/feature-contract';
import {createLoopsClient} from '../src/feature-client.js';
import {textPage} from '../src/feature-json.js';
import {defaultBudgets} from '../src/budgets.js';

const readerId = '11111111-1111-4111-8111-111111111111', documentId = 'a'.repeat(64);
const capabilities = {configured: 'unknown', authorized: 'unknown', available: 'unknown', parameters: [], notes: [], budgets: defaultBudgets, concurrency: 1};
function fixture(value: unknown, failure?: 'page' | 'release' | 'lost-release') {
  const text = JSON.stringify(value), sha256 = createHash('sha256').update(text).digest('hex'), calls: string[] = []; let reserved = true;
  const error = (operation: string) => ({kind: 'loops-error', operation, error: {code: 'LOOPS_STORAGE_FULL', message: 'Loops storage is full.', phase: 'storage', retryable: false, recovery: 'Free space, then inspect before retrying.'}});
  const host = {pluginId: 'loops-poc', signal: new AbortController().signal, connection: {connected: true}, onEvent: () => () => {}, subscribe: () => () => {},
    request: async(_method: string, params: Record<string, unknown>) => {
      const operation = params.actionId as string, input = params.payload as Record<string, unknown>; calls.push(operation);
      if (operation === 'capabilities') return {ok: true, result: {kind: 'loops-document', documentId, readerId, sha256, bytes: Buffer.byteLength(text), read: 'loops_document', description: 'Fixture snapshot'}};
      if (operation === 'document') {
        expect(input.readerId).toBe(readerId); expect(reserved).toBe(true);
        return {ok: true, result: failure === 'page' && input.offset !== 0 ? error(operation) : {documentId, sha256, ...textPage(text, input.offset as number, 40)}};
      }
      expect(operation).toBe('document_release'); expect(input).toEqual({documentId, readerId});
      if (failure === 'release') return {ok: true, result: error(operation)};
      reserved = false;
      if (failure === 'lost-release') throw Error('Synthetic lost release acknowledgement');
      return {ok: true, result: {released: true}};
    },
  } as FeatureTransport;
  return {client: createLoopsClient(host), calls, reserved: () => reserved};
}
describe('native document reader lifecycle', () => {
  it('releases only after complete pages, integrity and the operation result schema pass', async() => {
    const valid = fixture(capabilities); expect(await valid.client.invoke('capabilities', {})).toEqual(capabilities);
    expect(valid.calls.at(-1)).toBe('document_release'); expect(valid.reserved()).toBe(false);
    const invalid = fixture({validJsonButInvalidCapabilities: true});
    await expect(invalid.client.invoke('capabilities', {})).rejects.toThrow('Operation result does not match');
    expect(invalid.calls).not.toContain('document_release'); expect(invalid.reserved()).toBe(true);
  });
  it('keeps a failed paged retrieval reserved for inspection instead of presenting partial data', async() => {
    const source = fixture(capabilities, 'page');
    await expect(source.client.invoke('capabilities', {})).rejects.toMatchObject({detail: {code: 'LOOPS_STORAGE_FULL'}});
    expect(source.calls).not.toContain('document_release'); expect(source.reserved()).toBe(true);
  });
  it.each(['release', 'lost-release'] as const)('preserves a complete verified result after %s failure without replaying cleanup', async failure => {
    const source = fixture(capabilities, failure); expect(await source.client.invoke('capabilities', {})).toEqual(capabilities);
    expect(source.calls.filter(operation => operation === 'document_release')).toHaveLength(1);
    expect(source.reserved()).toBe(failure === 'release');
  });
});
