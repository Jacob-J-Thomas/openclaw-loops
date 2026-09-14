import {Type, type Static} from 'typebox';
import {featureJsonLimits} from './feature-json.js';

export const uploadChunkCharacters = 16000;
export const uploadEncodedLength = featureJsonLimits.stringLength;

// The joint representation constraint is checked by the upload handler so every
// adapter returns the same actionable error for missing or ambiguous content.
export const UploadChunkSchema = Type.Object({
  uploadId: Type.String({minLength: 1, maxLength: 100, pattern: '^[a-zA-Z0-9_-]+$'}),
  offset: Type.Integer({minimum: 0}),
  text: Type.Optional(Type.String({maxLength: uploadChunkCharacters * 2, description: 'Plaintext fragment. Supply exactly one of text or textBase64; an empty string is valid.'})),
  textBase64: Type.Optional(Type.String({maxLength: uploadEncodedLength, description: 'Canonical standard Base64 of the fragment UTF-8 bytes, with required padding and no whitespace. Supply exactly one of text or textBase64. Decoded content is limited to 16,000 Unicode code points; offsets and the final digest refer to decoded content.'})),
  complete: Type.Optional(Type.Boolean()),
  sha256: Type.Optional(Type.String({pattern: '^[a-f0-9]{64}$'})),
}, {additionalProperties: false});
export type UploadChunkInput = Static<typeof UploadChunkSchema>;
