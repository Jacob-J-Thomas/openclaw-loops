import {emptyDocumentLinks, type DocumentLinks} from './document-maintenance.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

// Identify the durable records represented by a validated operation result.
// IDs in maintenance candidate lists are proposed deletions, not new references
// to their payloads. Never let the preview protect its own candidates.
export function documentLinks(operation: string, input: Record<string, unknown>, result: unknown): DocumentLinks {
  const links = emptyDocumentLinks();
  const add = (kind: 'runs' | 'loops', id: unknown) => { if (typeof id === 'string' && id) links[kind].push(id); };
  const rows = (value: unknown, kind: 'runs' | 'loops') => {
    if (!Array.isArray(value)) { links.unknown = true; return; }
    for (const row of value) if (record(row)) add(kind, row.id); else links.unknown = true;
  };
  const value = record(result) ? result : {};
  if (['run', 'test', 'retry', 'status', 'resume', 'cancel', 'inspect', 'review'].includes(operation)) add('runs', value.id);
  else if(operation==='memory')add('runs',input.runId);
  else if (operation === 'output') add('runs', input.runId);
  else if (operation === 'runs') rows(result, 'runs');
  else if (operation === 'history') rows(value.items, 'runs');
  else if (['library', 'list', 'deleted'].includes(operation)) rows(result, 'loops');
  else if (operation === 'browse') rows(value.items, 'loops');
  else if (operation === 'versions' || operation === 'delete') add('loops', input.id);
  else if (operation === 'describe') add('loops', value.id);
  else if (['load', 'save', 'create', 'edit', 'draft', 'publish', 'restore', 'archive', 'recover', 'enable', 'revoke'].includes(operation)) {
    const saved = record(value.record) ? value.record : value;
    if (record(saved.definition)) add('loops', saved.definition.id); else links.unknown = true;
  } else if (operation === 'retention') rows(value.candidates, 'runs');
  else if (!['validate', 'capabilities', 'maintenance', 'transport_release', 'help'].includes(operation)) links.unknown = true;

  const pending = [result], seen = new Set<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (Array.isArray(item)) { for (const child of item) pending.push(child); continue; }
    if (!record(item)) continue;
    const id = item.kind === 'loops-document' ? item.documentId : item.$loopsUpload;
    if (typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)) links.documents.push(id);
    for (const child of Object.values(item)) pending.push(child);
  }
  for (const kind of ['runs', 'loops', 'documents'] as const) links[kind] = [...new Set(links[kind])].sort();
  return links;
}
