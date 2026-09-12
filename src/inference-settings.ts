import {Type, type Static} from 'typebox';
import {Value} from 'typebox/value';

// These are portable requests, not promises that every runtime implements them.
export const AdvancedSchema = Type.Object({
  temperature: Type.Optional(Type.Number({minimum: 0})),
  topP: Type.Optional(Type.Number({minimum: 0, maximum: 1})),
  topK: Type.Optional(Type.Integer({minimum: 0})),
  minP: Type.Optional(Type.Number({minimum: 0, maximum: 1})),
  typicalP: Type.Optional(Type.Number({minimum: 0, maximum: 1})),
  frequencyPenalty: Type.Optional(Type.Number()),
  presencePenalty: Type.Optional(Type.Number()),
  repetitionPenalty: Type.Optional(Type.Number({minimum: 0})),
  seed: Type.Optional(Type.Integer()),
  stop: Type.Optional(Type.Array(Type.String({minLength: 1}), {uniqueItems: true})),
  maxTokens: Type.Optional(Type.Integer({minimum: 1})),
}, {additionalProperties: false});
export type Advanced = Static<typeof AdvancedSchema>;
export const ReasoningSchema = Type.Union([Type.Literal('off'),Type.Literal('minimal'),Type.Literal('low'),Type.Literal('medium'),Type.Literal('high'),Type.Literal('xhigh'),Type.Literal('adaptive'),Type.Literal('max'),Type.Literal('ultra')]);
export type InferenceSettings = {model?: string; agentId?: string; reasoning?: string; advanced?: Advanced};
export type ParameterDescriptor = {
  key: keyof Advanced; label: string; type: 'number'|'integer'|'string[]';
  support: 'supported'|'advisory'|'unsupported'|'unknown';
  reason: string; minimum?: number; maximum?: number; defaultValue?: Advanced[keyof Advanced];
};
export type InferenceCapabilities = {
  model?: string; runtime?: string; configured: boolean|'unknown'; authorized: boolean|'unknown';
  available: boolean|'unknown'; parameters: ParameterDescriptor[]; notes: string[];
};
const labels: Record<keyof Advanced,string> = {
  temperature:'Temperature',topP:'Top p',topK:'Top k',minP:'Min p',typicalP:'Typical p',
  frequencyPenalty:'Frequency penalty',presencePenalty:'Presence penalty',repetitionPenalty:'Repetition penalty',
  seed:'Seed',stop:'Stop sequences',maxTokens:'Output tokens',
};

export function completionParameters(options: {model?: string; supportsTemperature?: boolean; defaults?: Record<string,unknown>} = {}): ParameterDescriptor[] {
  return (Object.keys(labels) as (keyof Advanced)[]).map(key => {
    const schema = AdvancedSchema.properties[key];
    const publicParameter = key === 'temperature' || key === 'maxTokens';
    const unsupportedTemperature = key === 'temperature' && options.supportsTemperature === false;
    const defaultValue = options.defaults?.[key];
    return {
      key, label: labels[key], type: key === 'stop' ? 'string[]' : ['topK','seed','maxTokens'].includes(key) ? 'integer' : 'number',
      support: unsupportedTemperature || !publicParameter ? 'unsupported' : 'advisory',
      reason: unsupportedTemperature ? 'The host model catalog marks temperature unsupported for this model.'
        : publicParameter ? 'OpenClaw 2026.9.3 accepts this as a hint; its runtime may ignore it.'
        : 'OpenClaw 2026.9.3 does not expose this parameter through the public isolated completion API.',
      ...'minimum' in schema ? {minimum: schema.minimum as number} : {},
      ...'maximum' in schema ? {maximum: schema.maximum as number} : {},
      ...(defaultValue !== undefined && Value.Check(schema, defaultValue)) ? {defaultValue: defaultValue as Advanced[keyof Advanced]} : {},
    };
  });
}

export function validateAdvanced(overrides: Advanced | undefined, descriptors: ParameterDescriptor[]): string[] {
  if (!overrides) return [];
  if (!Value.Check(AdvancedSchema, overrides)) return ['Advanced settings contain invalid values or unknown parameters.'];
  const issues: string[] = [];
  for (const [key,value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const descriptor = descriptors.find(d => d.key === key);
    if (!descriptor || descriptor.support === 'unsupported' || descriptor.support === 'unknown') {
      issues.push(`${labels[key as keyof Advanced] ?? key}: ${descriptor?.reason ?? 'No host capability descriptor is available.'}`);
    }
    if (typeof value === 'number' && descriptor &&
        ((descriptor.minimum !== undefined && value < descriptor.minimum) || (descriptor.maximum !== undefined && value > descriptor.maximum))) {
      issues.push(`${descriptor.label} is outside the supported range.`);
    }
  }
  return issues;
}
