import {linkSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

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
const encode = config => Buffer.from(JSON.stringify(config, null, 2) + '\n');
function stage(filename, bytes, commit) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let cleanup = true;
  try {
    try { writeFileSync(temporary, bytes, {mode: 0o600, flag: 'wx', flush: true}); }
    catch (error) { if (error.code === 'EEXIST') cleanup = false; throw error; }
    return commit(temporary);
  } finally {
    // Only this attempt's staging file: interrupted attempts and valid backups
    // remain available for diagnosis, never mistaken for an active profile.
    if (cleanup) rmSync(temporary, {force: true});
  }
}
export function createProfile(filename, config) {
  // Link a complete file with no replacement: another initializer may have
  // created the profile since its existence check. Never truncate that file.
  return stage(filename, encode(config), temporary => linkSync(temporary, filename));
}
export function writeProfileWithBackup(filename, config, expected) {
  filename = realpathSync(filename);
  const before = readFileSync(filename), after = encode(config);
  const unchanged = () => {
    if ((expected !== undefined && !before.equals(Buffer.from(expected))) || !readFileSync(filename).equals(before))
      throw new Error('The profile changed during setup. Read the current profile and retry; no replacement was applied.');
  };
  unchanged();
  if (before.equals(after)) return false;
  return stage(filename, after, temporary => {
    // Random names and exclusive linking preserve earlier backups even when
    // multiple updates occur within the same millisecond.
    const backup = `${filename}.before-loops-${Date.now()}-${randomUUID()}.bak`;
    stage(backup, before, stagedBackup => linkSync(stagedBackup, backup));
    unchanged();
    renameSync(temporary, filename);
    return true;
  });
}
