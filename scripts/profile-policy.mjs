import {copyFileSync, readFileSync, writeFileSync} from 'node:fs';

const generatedModels = new Set(['openai/gpt-6-astra', 'ollama/qwen3.5:4b']);
export function repairGeneratedPolicy(config) {
  const policy = config.plugins?.entries?.['loops-poc']?.llm;
  if (!policy) return false;
  // Only the exact policy emitted by the old two scaffolders is recognizable.
  // A custom model list or additional policy fields are operator-owned.
  const keys = Object.keys(policy).sort().join(',');
  if (keys !== 'allowAgentIdOverride,allowModelOverride,allowedCompletionModels,allowedModels' ||
      policy.allowAgentIdOverride !== true || policy.allowModelOverride !== true ||
      !Array.isArray(policy.allowedModels) || policy.allowedModels.length !== 1 ||
      !generatedModels.has(policy.allowedModels[0]) ||
      JSON.stringify(policy.allowedCompletionModels) !== JSON.stringify(policy.allowedModels)) return false;
  delete policy.allowedModels;
  delete policy.allowedCompletionModels;
  return true;
}
export function configureLoopPolicy(config) {
  config.plugins ??= {};
  config.plugins.entries ??= {};
  const entry = config.plugins.entries['loops-poc'] ??= {enabled: true};
  if (!entry.llm) entry.llm = {allowAgentIdOverride: true, allowModelOverride: true};
  else repairGeneratedPolicy(config);
}
export function writeProfileWithBackup(filename, config) {
  const before = readFileSync(filename, 'utf8');
  const after = JSON.stringify(config, null, 2) + '\n';
  if (before === after) return false;
  copyFileSync(filename, `${filename}.before-loops-${Date.now()}.bak`);
  writeFileSync(filename, after, {mode: 0o600, flush: true});
  return true;
}
