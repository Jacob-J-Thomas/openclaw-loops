import {Value} from 'typebox/value';
import {createFeatureClient, type FeatureClient, type FeatureTransport, type FeatureInput, type FeatureOutput} from 'openclaw/plugin-sdk/feature-contract';
import {contract} from './contract.js';
import {DocumentReferenceSchema, uploadFields, wireContract} from './wire-contract.js';
import {fitsFeatureJson, textPage} from './feature-json.js';

const digest = async(text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(byte => byte.toString(16).padStart(2, '0')).join('');

export function createLoopsClient(host: FeatureTransport): Pick<FeatureClient<typeof contract>, 'invoke' | 'on'> {
  const wire = createFeatureClient(wireContract, host);
  const invoke: FeatureClient<typeof contract>['invoke'] = async(operation, input, options) => {
    const payload = structuredClone(input) as Record<string, unknown>;
    if (!fitsFeatureJson(payload)) {
      for (const field of uploadFields[operation] ?? []) {
        if (payload[field] === undefined) continue;
        const text = JSON.stringify(payload[field]), sha256 = await digest(text), uploadId = crypto.randomUUID();
        let offset = 0;
        while (true) {
          const page = textPage(text, offset), complete = page.nextOffset === null;
          const uploaded = await wire.invoke('upload', {uploadId, offset, text: page.text, complete, ...complete ? {sha256} : {}}, options);
          if (complete) { payload[field] = uploaded.reference; break; }
          offset = page.nextOffset!;
        }
        if (fitsFeatureJson(payload)) break;
      }
    }
    if (!fitsFeatureJson(payload)) throw new Error('This request exceeds the host transport envelope and has no remaining upload-capable fields. No operation was submitted.');
    let result = await wire.invoke(operation, payload as FeatureInput<typeof wireContract, typeof operation>, options);
    if (Value.Check(DocumentReferenceSchema, result)) {
      const reference = result;
      let text = '', offset = 0;
      while (true) {
        const page = await wire.invoke('document', {documentId: reference.documentId, offset}, options);
        if (page.offset !== offset || page.sha256 !== reference.sha256 || page.nextOffset !== null && page.nextOffset <= offset) throw new Error('Document page identity or sequence changed.');
        text += page.text;
        if (page.nextOffset === null) break;
        offset = page.nextOffset;
      }
      if (new TextEncoder().encode(text).byteLength !== reference.bytes || await digest(text) !== reference.sha256) throw new Error('Document integrity check failed.');
      result = JSON.parse(text);
    }
    if (!Value.Check(contract.operations[operation].output, result)) throw new Error('Operation result does not match its Loops schema.');
    return result as FeatureOutput<typeof contract, typeof operation>;
  };
  return {invoke, on: wire.on};
}
