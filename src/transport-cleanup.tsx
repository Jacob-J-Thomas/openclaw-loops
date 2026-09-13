import React, {useState} from 'react';
import type {MaintenancePolicy, MaintenanceResult, TransportRelease} from './document-maintenance.js';
import {FailureNotice, displayFailure, type DisplayFailure} from './failure-notice.js';

export function TransportCleanup({invoke, release, disabled}: {
  invoke: (policy: MaintenancePolicy, planId?: string) => Promise<MaintenanceResult>;
  release: (input: TransportRelease) => Promise<{released: boolean}>;
  disabled: boolean;
}) {
  const [days, setDays] = useState(''), [keep, setKeep] = useState('');
  const [preview, setPreview] = useState<MaintenanceResult>(), [error, setError] = useState<DisplayFailure>('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const policy = (): MaintenancePolicy => ({...days !== '' ? {olderThanDays: Number(days)} : {}, ...keep !== '' ? {keepLatest: Number(keep)} : {}});
  const act = async(apply = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await invoke(apply ? preview!.policy : policy(), apply ? preview!.planId : undefined);
      if (result.applied) { setPreview(undefined); setMessage(`Removed ${result.candidates.length} files (${result.bytes.toLocaleString()} bytes) from this conversation's transport storage.`); }
      else setPreview(result);
    } catch (error) { setError(displayFailure(error)); setPreview(undefined); }
    finally { setBusy(false); }
  };
  const releaseItem = async(input: TransportRelease) => {
    setBusy(true); setError(''); setMessage(''); setPreview(undefined);
    try { await release(input); setPreview(await invoke(policy())); setMessage(input.kind === 'reader' ? 'Reader released. Other readers and referenced evidence remain protected.' : 'Upload abandoned. Preview the files before deleting them.'); }
    catch (error) { setError(displayFailure(error)); }
    finally { setBusy(false); }
  };
  const change = (set: (value: string) => void, value: string) => { set(value); setPreview(undefined); setMessage(''); };
  return <details className="lp-history-cleanup"><summary>Transport file cleanup</summary>
    <p className="lp-hint">Nothing is deleted automatically. Preview old document copies, completed uploads and abandoned staging. Retained run/revision evidence, active readers and open uploads are protected. Backups are separate.</p>
    <label className="lp-field"><span>Transport files older than (days)</span><input type="number" min={0} step="any" placeholder="Any age" disabled={busy} value={days} onChange={event => change(setDays, event.target.value)}/></label>
    <label className="lp-field"><span>Keep at least the latest transport files</span><input type="number" min={0} step={1} placeholder="No minimum" disabled={busy} value={keep} onChange={event => change(setKeep, event.target.value)}/></label>
    <button disabled={disabled || busy || days === '' && keep === ''} onClick={() => void act()}>Preview transport cleanup</button>
    {preview && <>
      <p role="status">{preview.candidates.length} eligible of {preview.total} owned files · {preview.bytes.toLocaleString()} bytes. Protected: {preview.protected.readers} with readers, {preview.protected.uploads} open uploads, {preview.protected.referenced} referenced, {preview.protected.legacy} legacy or untracked, {preview.protected.corrupt} damaged, {preview.protected.recent} recent.</p>
      <details><summary>Files to remove</summary><ul>{preview.candidates.map(file => <li key={`${file.kind}:${file.id}`}>{file.kind} · <code>{file.id}</code> · {file.bytes.toLocaleString()} bytes</li>)}</ul></details>
      <p className="lp-hint">Deletion is permanent. A changed preview is rejected. If storage fails partway through cleanup, completed file removals remain removed; inspect the error and preview again.</p>
      <button className="danger" disabled={disabled || busy || !preview.candidates.length} onClick={() => void act(true)}>Delete {preview.candidates.length} eligible transport files</button>
      {!!preview.readers.length && <details><summary>Reserved document readers ({preview.readers.length})</summary>
        <p className="lp-hint">Release a reader only after its consumer has finished, or when you intend to abandon that reader. Readers survive restart and never expire automatically.</p>
        <ul>{preview.readers.map(reader => <li key={reader.readerId}><code>{reader.documentId}</code> · reader <code>{reader.readerId}</code> · {new Date(reader.createdAt).toLocaleString()} <button disabled={disabled || busy} onClick={() => void releaseItem({kind: 'reader', documentId: reader.documentId, readerId: reader.readerId})}>Release reader</button></li>)}</ul>
      </details>}
      {!!preview.uploads.length && <details><summary>Open uploads ({preview.uploads.length})</summary>
        <p className="lp-hint">Abandon only uploads you no longer intend to finish. A changed upload is rejected and must be inspected again.</p>
        <ul>{preview.uploads.map(upload => <li key={upload.uploadId}><code>{upload.uploadId}</code> · {new Date(upload.updatedAt).toLocaleString()} <button disabled={disabled || busy} onClick={() => void releaseItem({kind: 'upload', uploadId: upload.uploadId, sha256: upload.sha256})}>Abandon upload</button></li>)}</ul>
      </details>}
      <p className="lp-hint">Legacy uploads and files without verified ownership remain outside these conversation totals. Untracked legacy readers and unknown references are preserved conservatively.</p>
    </>}
    <FailureNotice failure={error} label="Transport cleanup failure"/>{message && <p role="status">{message}</p>}
  </details>;
}
