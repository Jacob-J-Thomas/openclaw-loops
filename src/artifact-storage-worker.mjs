import {createHash} from 'node:crypto';

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const operationName=/^[a-zA-Z0-9_-]{1,128}$/;
const digest=/^[a-f0-9]{64}$/;
const mime=/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const exact=(value,fields)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===fields.slice().sort().join(',');
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const scopeFor=owner=>createHash('sha256').update(JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId])).digest('hex');
const conflict=message=>Object.assign(new Error(message),{code:'LOOPS_ARTIFACT_CONFLICT'});
const busy=()=>Object.assign(new Error('Artifact cleanup lease is active; reconcile it before changing references.'),{code:'LOOPS_ARTIFACT_BUSY'});
const corrupt=message=>new Error(`Invalid saved artifact custody: ${message}.`);
const quota=message=>Object.assign(new Error(`Artifact metadata quota exceeded: ${message}.`),{code:'LOOPS_ARTIFACT_QUOTA'});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Immutable identities, references and receipts are never pruned or recycled.
// These limits bound their lifetime footprint per owner. The audit reserve is
// charged at admission, so settling an admitted publication or GC lease does
// not depend on room being available after filesystem work has happened.
const limits=Object.freeze({operations:4096,operationBytes:1024*1024,items:16384,live:256,referenceBytes:4096,itemBytes:64*1024*1024,
  links:65536,linkBytes:64*1024*1024,receipts:21504,receiptBytes:64*1024*1024,
  publicationReservePerItem:8192,cleanupReserveBytes:4*1024*1024,cleanupReserveRows:1024});
const bytes=value=>Buffer.byteLength(value,'utf8');
function metadataUsage(database,scope){
  const operations=database.prepare('SELECT count(*) AS n,coalesce(sum(length(CAST(operation_id AS BLOB))+length(CAST(status AS BLOB))+length(CAST(scope AS BLOB))),0) AS b FROM artifact_operations WHERE scope=?').get(scope);
  const items=database.prepare('SELECT count(*) AS n,coalesce(sum(length(CAST(record AS BLOB))),0) AS b FROM artifact_items WHERE scope=?').get(scope);
  const live=database.prepare("SELECT count(*) AS n FROM artifact_items WHERE scope=? AND status IN ('reserved','published','released')").get(scope).n;
  const pending=database.prepare("SELECT count(*) AS n FROM artifact_items WHERE scope=? AND status='reserved'").get(scope).n;
  const runLinks=database.prepare("SELECT count(*) AS n,coalesce(sum(length(CAST(run_id AS BLOB))+length(CAST(node_id AS BLOB))+length(CAST(artifact_id AS BLOB))),0) AS b FROM artifact_links WHERE scope=?").get(scope);
  const memoryLinks=database.prepare("SELECT count(*) AS n,coalesce(sum(length(CAST(loop_id AS BLOB))+length(CAST(memory_key AS BLOB))+length(CAST(artifact_id AS BLOB))),0) AS b FROM artifact_memory_links WHERE scope=?").get(scope);
  const links={n:runLinks.n+memoryLinks.n,b:runLinks.b+memoryLinks.b};
  const audit=database.prepare(`SELECT count(*) AS n,coalesce(sum(length(CAST(record AS BLOB))),0) AS b FROM (
    SELECT record FROM artifact_gc_receipts WHERE scope=? UNION ALL SELECT record FROM artifact_recovery_receipts WHERE scope=?)`).get(scope,scope);
  return {operations,items,live,pending,links,audit};
}
function requireAdmissible(database,scope){
  const u=metadataUsage(database,scope);
  if(u.operations.n>limits.operations||u.operations.b>limits.operationBytes||u.items.n>limits.items||u.items.b>limits.itemBytes||u.live>limits.live||
    u.links.n>limits.links||u.links.b>limits.linkBytes||u.audit.n>limits.receipts||u.audit.b>limits.receiptBytes)throw quota('owner lifetime cap');
  if(u.audit.n+u.pending+u.live+limits.cleanupReserveRows>limits.receipts||
    u.audit.b+u.pending*limits.publicationReservePerItem+limits.cleanupReserveBytes>limits.receiptBytes)throw quota('recovery and cleanup headroom');
}
function requireAuditRoom(database,scope,record){
  const u=metadataUsage(database,scope),size=bytes(record);
  if(u.audit.n+1>limits.receipts||u.audit.b+size>limits.receiptBytes)throw quota('immutable receipt capacity');
}

export const artifactSchema=`
  CREATE TABLE IF NOT EXISTS artifact_operations(scope TEXT NOT NULL,operation_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('reserved','published','abandoned')),reference_count INTEGER NOT NULL CHECK(reference_count>0),PRIMARY KEY(scope,operation_id));
  CREATE TABLE IF NOT EXISTS artifact_items(id TEXT PRIMARY KEY,scope TEXT NOT NULL,operation_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('reserved','published','released','retired','abandoned')),ever_linked INTEGER NOT NULL DEFAULT 0 CHECK(ever_linked IN (0,1)),released_at TEXT,record TEXT NOT NULL CHECK(json_valid(record)),FOREIGN KEY(scope,operation_id) REFERENCES artifact_operations(scope,operation_id) ON DELETE RESTRICT);
  CREATE INDEX IF NOT EXISTS artifact_items_operation ON artifact_items(scope,operation_id);
  CREATE TABLE IF NOT EXISTS artifact_links(scope TEXT NOT NULL,run_id TEXT NOT NULL,node_id TEXT NOT NULL,artifact_id TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),PRIMARY KEY(scope,run_id,node_id,artifact_id),FOREIGN KEY(artifact_id) REFERENCES artifact_items(id) ON DELETE RESTRICT);
  CREATE INDEX IF NOT EXISTS artifact_links_item ON artifact_links(artifact_id,active);
  CREATE TABLE IF NOT EXISTS artifact_memory_links(scope TEXT NOT NULL,loop_id TEXT NOT NULL,memory_key TEXT NOT NULL,artifact_id TEXT NOT NULL,PRIMARY KEY(scope,loop_id,memory_key,artifact_id),FOREIGN KEY(scope,loop_id,memory_key) REFERENCES memory_records(scope,loop_id,key) ON DELETE RESTRICT,FOREIGN KEY(artifact_id) REFERENCES artifact_items(id) ON DELETE RESTRICT);
  CREATE INDEX IF NOT EXISTS artifact_memory_links_item ON artifact_memory_links(artifact_id);
  CREATE TABLE IF NOT EXISTS artifact_memory_opaque(scope TEXT NOT NULL,loop_id TEXT NOT NULL,memory_key TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),value_sha256 TEXT NOT NULL,PRIMARY KEY(scope,loop_id,memory_key),FOREIGN KEY(scope,loop_id,memory_key) REFERENCES memory_records(scope,loop_id,key) ON DELETE RESTRICT);
  CREATE TABLE IF NOT EXISTS artifact_gc(scope TEXT PRIMARY KEY,token TEXT NOT NULL,started_at TEXT NOT NULL,plan TEXT NOT NULL CHECK(json_valid(plan)));
  CREATE TABLE IF NOT EXISTS artifact_gc_receipts(scope TEXT NOT NULL,token TEXT NOT NULL,record TEXT NOT NULL CHECK(json_valid(record)),PRIMARY KEY(scope,token));
  CREATE TABLE IF NOT EXISTS artifact_recovery_receipts(scope TEXT NOT NULL,recovery_id TEXT NOT NULL,target_type TEXT NOT NULL CHECK(target_type IN ('publication','cleanup')),target_id TEXT NOT NULL,at TEXT NOT NULL,record TEXT NOT NULL CHECK(json_valid(record)),PRIMARY KEY(scope,recovery_id));
`;

function validReference(ref){
  return exact(ref,['kind','id','sha256','mediaType','bytes','ownerScope','runId','nodeId','createdAt','expiresAt'])&&
    ref.kind==='loops-artifact'&&uuid.test(ref.id)&&digest.test(ref.sha256)&&digest.test(ref.ownerScope)&&
    mime.test(ref.mediaType)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>=0&&
    typeof ref.runId==='string'&&ref.runId.length>0&&ref.runId.length<=256&&
    typeof ref.nodeId==='string'&&ref.nodeId.length>0&&ref.nodeId.length<=256&&
    iso(ref.createdAt)&&iso(ref.expiresAt)&&Date.parse(ref.expiresAt)>=Date.parse(ref.createdAt);
}
function validOwner(owner){return exact(owner,['agentId','sessionKey','sessionId'])&&
  [owner.agentId,owner.sessionKey,owner.sessionId].every(value=>typeof value==='string'&&value.length>0&&value.length<=1024);}
function checkOwner(owner){if(!validOwner(owner))throw conflict('Invalid artifact owner.');return scopeFor(owner);}
function validateRefs(refs,scope){
  if(!Array.isArray(refs)||refs.length<1||refs.length>256||refs.some(ref=>!validReference(ref)||ref.ownerScope!==scope||bytes(JSON.stringify(ref))>limits.referenceBytes)||new Set(refs.map(ref=>ref.id)).size!==refs.length)throw conflict('Invalid artifact reference batch.');
}
function validPlan(plan,scope){
  return exact(plan,['planId','candidates','protected','total','bytes'])&&digest.test(plan.planId)&&
    Array.isArray(plan.candidates)&&plan.candidates.length<=256&&
    plan.candidates.every(ref=>validReference(ref)&&ref.ownerScope===scope)&&
    new Set(plan.candidates.map(ref=>ref.id)).size===plan.candidates.length&&
    exact(plan.protected,['active','recent'])&&
    [plan.protected.active,plan.protected.recent,plan.total,plan.bytes].every(value=>Number.isSafeInteger(value)&&value>=0)&&
    plan.candidates.reduce((sum,ref)=>sum+ref.bytes,0)===plan.bytes&&plan.total>=plan.candidates.length;
}
function validReadback(readback,items){
  if(!Array.isArray(readback)||readback.length!==items.length||new Set(readback.map(item=>item?.id)).size!==items.length)return false;
  const expected=new Map(items.map(item=>[item.reference.id,item.reference]));
  return readback.every(item=>item&&uuid.test(item.id)&&expected.has(item.id)&&
    (item.status==='missing'&&item.reference===undefined||item.status==='published'&&validReference(item.reference)&&same(item.reference,expected.get(item.id))));
}
function tx(database,action){
  database.exec('BEGIN IMMEDIATE');
  try{const result=action();database.exec('COMMIT');return result;}
  catch(error){if(database.isTransaction)database.exec('ROLLBACK');throw error;}
}
function assertNoGc(database){if(database.prepare('SELECT 1 FROM artifact_gc LIMIT 1').get())throw busy();}
function operation(database,scope,operationId){
  const row=database.prepare('SELECT status,reference_count FROM artifact_operations WHERE scope=? AND operation_id=?').get(scope,operationId);
  if(!row)return undefined;
  const refs=database.prepare('SELECT record,status,ever_linked,released_at FROM artifact_items WHERE scope=? AND operation_id=? ORDER BY id').all(scope,operationId);
  if(refs.length!==row.reference_count)throw corrupt('operation reference count');
  return {status:row.status,references:refs.map(item=>({reference:JSON.parse(item.record),status:item.status,everLinked:item.ever_linked===1,releasedAt:item.released_at??undefined}))};
}
function protectedRun(run){
  if(!run||typeof run!=='object')return true;
  if(!['completed','failed','cancelled'].includes(run.state)||run.cleanupPending===true||typeof run.uncertainty==='string'&&run.uncertainty.length>0||typeof run.pending==='string'&&run.pending.length>0)return true;
  return Array.isArray(run.trace)&&run.trace.some(entry=>['running','interrupted'].includes(entry?.state));
}
function protectedIds(database,scope){
  const ids=new Set();
  for(const item of database.prepare("SELECT id FROM artifact_items WHERE scope=? AND (status='reserved' OR status='published' AND ever_linked=0)").all(scope))ids.add(item.id);
  for(const row of database.prepare(`SELECT links.artifact_id AS id,runs.record AS run
    FROM artifact_links AS links LEFT JOIN runs ON runs.id=links.run_id
    WHERE links.scope=? AND links.active=1`).all(scope)){
    if(row.run===null||protectedRun(JSON.parse(row.run)))ids.add(row.id);
  }
  for(const row of database.prepare('SELECT artifact_id AS id FROM artifact_memory_links WHERE scope=?').all(scope))ids.add(row.id);
  return [...ids].sort();
}
function findRefs(value,nodeId,found,depth=0){
  if(depth>100)throw conflict('Artifact reference nesting exceeds the limit.');
  if(Array.isArray(value)){for(const item of value)findRefs(item,nodeId,found,depth+1);return;}
  if(!value||typeof value!=='object')return;
  if(value.kind==='loops-artifact'){
    if(!validReference(value))throw conflict('Malformed artifact reference in a saved value.');
    const key=`${nodeId}\0${value.id}`,prior=found.get(key);
    if(prior&&!same(prior.reference,value))throw conflict('Conflicting artifact reference identities.');
    found.set(key,{nodeId,reference:value});return;
  }
  for(const child of Object.values(value))findRefs(child,nodeId,found,depth+1);
}
function checkpointRefs(run){
  const found=new Map();
  findRefs(run.input,'input',found);
  findRefs(run.context,'context',found);
  for(const [nodeId,value] of Object.entries(run.outputs??{}))findRefs(value,nodeId,found);
  findRefs(run.result,'result',found);
  return [...found.values()];
}
function memoryRefs(record){
  const found=new Map();
  if(!record.deleted)findRefs(record.value,'memory',found);
  return [...found.values()].map(item=>item.reference);
}

// Schema 4 predates artifact custody. Keep its existing JSON values opaque at
// their exact version/hash; a later v5 write must establish real custody.
export function markLegacyMemoryOpaque(database){
  for(const row of database.prepare('SELECT scope,loop_id,key,record FROM memory_records WHERE deleted=0').iterate()){
    const record=JSON.parse(row.record);
    database.prepare('INSERT INTO artifact_memory_opaque(scope,loop_id,memory_key,version,value_sha256) VALUES (?,?,?,?,?)').run(row.scope,row.loop_id,row.key,record.version,record.valueSha256);
  }
}

export function artifactStore(database){
  return {
    assertNoGc:()=>assertNoGc(database),
    operation:({owner,operationId})=>{
      const scope=checkOwner(owner);if(!operationName.test(operationId))throw conflict('Invalid artifact operation ID.');
      return operation(database,scope,operationId);
    },
    referenceStatus:({owner,id})=>{
      const scope=checkOwner(owner);if(!uuid.test(id))throw conflict('Invalid artifact reference ID.');
      const row=database.prepare('SELECT operation_id AS operationId,status,ever_linked AS everLinked,released_at AS releasedAt FROM artifact_items WHERE scope=? AND id=?').get(scope,id);
      return row?{operationId:row.operationId,status:row.status,everLinked:row.everLinked===1,releasedAt:row.releasedAt??undefined}:undefined;
    },
    operationsPage:({owner,cursor='',limit=50})=>{
      const scope=checkOwner(owner);if(cursor!==''&&!operationName.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw conflict('Invalid artifact operation page.');
      const rows=database.prepare('SELECT operation_id AS operationId,status FROM artifact_operations WHERE scope=? AND operation_id>? ORDER BY operation_id LIMIT ?').all(scope,cursor,limit+1);
      return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].operationId:null};
    },
    reserve:({owner,refs,operationId})=>{
      const scope=checkOwner(owner);if(!operationName.test(operationId))throw conflict('Invalid artifact operation ID.');validateRefs(refs,scope);
      return tx(database,()=>{
        assertNoGc(database);
        if(operation(database,scope,operationId))throw conflict('Artifact operation ID was already reserved.');
        for(const ref of refs){
          const run=database.prepare('SELECT owner_key FROM runs WHERE id=?').get(ref.runId);
          if(run&&run.owner_key!==JSON.stringify([owner.agentId,owner.sessionKey,owner.sessionId]))throw conflict('Artifact origin run belongs to another owner.');
        }
        database.prepare("INSERT INTO artifact_operations(scope,operation_id,status,reference_count) VALUES (?,?,'reserved',?)").run(scope,operationId,refs.length);
        for(const ref of refs)database.prepare("INSERT INTO artifact_items(id,scope,operation_id,status,record) VALUES (?,?,?,'reserved',?)").run(ref.id,scope,operationId,JSON.stringify(ref));
        requireAdmissible(database,scope);
        return operation(database,scope,operationId);
      });
    },
    published:({owner,refs,operationId})=>{
      const scope=checkOwner(owner);if(!operationName.test(operationId))throw conflict('Invalid artifact operation ID.');validateRefs(refs,scope);
      return tx(database,()=>{
        assertNoGc(database);
        const saved=operation(database,scope,operationId);
        if(!saved||saved.references.length!==refs.length||!same(saved.references.map(item=>item.reference).sort((a,b)=>a.id.localeCompare(b.id)),[...refs].sort((a,b)=>a.id.localeCompare(b.id))))throw conflict('Artifact publication does not match its reservation.');
        if(saved.status==='reserved'){
          database.prepare("UPDATE artifact_operations SET status='published' WHERE scope=? AND operation_id=?").run(scope,operationId);
          database.prepare("UPDATE artifact_items SET status='published' WHERE scope=? AND operation_id=? AND status='reserved'").run(scope,operationId);
        }
        else if(saved.references.some(item=>item.status!=='published'))throw conflict('Retired artifact cannot be republished.');
        return operation(database,scope,operationId);
      });
    },
    releaseUnlinked:({owner,id,operationId,at})=>{
      const scope=checkOwner(owner);if(!uuid.test(id)||!operationName.test(operationId)||!iso(at))throw conflict('Invalid artifact release identity.');
      return tx(database,()=>{
        assertNoGc(database);
        const op=database.prepare('SELECT status FROM artifact_operations WHERE scope=? AND operation_id=?').get(scope,operationId);
        const item=database.prepare('SELECT status,ever_linked,released_at,record FROM artifact_items WHERE scope=? AND operation_id=? AND id=?').get(scope,operationId,id);
        if(!op||op.status!=='published'||!item)throw conflict('Artifact release requires a published operation and exact reference.');
        const origin=JSON.parse(item.record);
        if(origin.runId!==`capture-${operationId}`||origin.nodeId!=='upload'||database.prepare('SELECT 1 FROM runs WHERE id=? LIMIT 1').get(origin.runId))throw conflict('Artifact release requires standalone capture provenance without a run.');
        if(item.released_at!==null&&['released','retired'].includes(item.status))return {id,operationId,status:item.status,releasedAt:item.released_at};
        if(item.status!=='published'||item.ever_linked!==0||database.prepare('SELECT 1 FROM artifact_links WHERE artifact_id=? LIMIT 1').get(id)||database.prepare('SELECT 1 FROM artifact_memory_links WHERE artifact_id=? LIMIT 1').get(id))throw conflict('Artifact release requires a never-linked published reference.');
        database.prepare("UPDATE artifact_items SET status='released',released_at=? WHERE scope=? AND operation_id=? AND id=? AND status='published'").run(at,scope,operationId,id);
        return {id,operationId,status:'released',releasedAt:at};
      });
    },
    recoverPublication:({owner,operationId,readback,recoveryId,at})=>{
      const scope=checkOwner(owner);
      if(!operationName.test(operationId)||!uuid.test(recoveryId)||!iso(at))throw conflict('Invalid artifact publication recovery identity.');
      return tx(database,()=>{
        assertNoGc(database);
        if(database.prepare('SELECT 1 FROM artifact_recovery_receipts WHERE scope=? AND recovery_id=?').get(scope,recoveryId))throw conflict('Artifact recovery ID was already used.');
        const saved=operation(database,scope,operationId);
        if(!saved||saved.status!=='reserved')throw conflict('Artifact publication is no longer reserved.');
        if(!validReadback(readback,saved.references))throw conflict('Artifact custody readback is incomplete, uncertain or changed.');
        const statuses=new Set(readback.map(item=>item.status));
        if(statuses.size!==1)throw conflict('Mixed artifact custody readback requires explicit investigation.');
        const outcome=statuses.has('published')?'published':'abandoned';
        if(outcome==='abandoned'&&saved.references.some(item=>database.prepare('SELECT 1 FROM artifact_links WHERE artifact_id=? LIMIT 1').get(item.reference.id)||database.prepare('SELECT 1 FROM artifact_memory_links WHERE artifact_id=? LIMIT 1').get(item.reference.id)))throw conflict('Linked artifact cannot be abandoned.');
        database.prepare('UPDATE artifact_operations SET status=? WHERE scope=? AND operation_id=?').run(outcome,scope,operationId);
        database.prepare('UPDATE artifact_items SET status=? WHERE scope=? AND operation_id=?').run(outcome,scope,operationId);
        const receipt={operationId,recoveryId,outcome,at,readback};
        const record=JSON.stringify(receipt);requireAuditRoom(database,scope,record);
        database.prepare("INSERT INTO artifact_recovery_receipts(scope,recovery_id,target_type,target_id,at,record) VALUES (?,?,'publication',?,?,?)").run(scope,recoveryId,operationId,at,record);
        return {operationId,recoveryId,outcome};
      });
    },
    snapshot:({owner})=>protectedIds(database,checkOwner(owner)),
    beginGc:({owner,token,plan,at})=>{
      const scope=checkOwner(owner);if(!uuid.test(token)||!iso(at)||!validPlan(plan,scope))throw conflict('Invalid artifact cleanup lease or plan.');
      return tx(database,()=>{
        assertNoGc(database);
        if(database.prepare("SELECT 1 FROM artifact_operations WHERE scope=? AND status='reserved' LIMIT 1").get(scope))throw conflict('Resolve uncertain artifact publication before cleanup.');
        if(plan.candidates.length===0)throw conflict('No cleanup candidates; preview is read-only.');
        const protectedSet=new Set(protectedIds(database,scope));
        for(const ref of plan.candidates){
          const item=database.prepare('SELECT status,record FROM artifact_items WHERE id=? AND scope=?').get(ref.id,scope);
          if(protectedSet.has(ref.id)||!item||!['published','released'].includes(item.status)||!same(JSON.parse(item.record),ref))throw conflict('Artifact cleanup plan includes protected or changed custody.');
        }
        const planRecord=JSON.stringify(plan);
        if(bytes(planRecord)>limits.cleanupReserveBytes/2)throw quota('cleanup plan exceeds bounded recovery receipt');
        const u=metadataUsage(database,scope);
        if(u.audit.n+1>limits.receipts||u.audit.b+limits.cleanupReserveBytes>limits.receiptBytes)throw quota('cleanup receipt headroom');
        database.prepare('INSERT INTO artifact_gc(scope,token,started_at,plan) VALUES (?,?,?,?)').run(scope,token,at,planRecord);
        return {token,protectedIds:[...protectedSet].sort()};
      });
    },
    gcLease:({owner})=>{
      const row=database.prepare('SELECT token,started_at AS startedAt,plan FROM artifact_gc WHERE scope=?').get(checkOwner(owner));
      return row?{token:row.token,startedAt:row.startedAt,plan:JSON.parse(row.plan)}:undefined;
    },
    recoveryInventory:({owner,cursor='',limit=50})=>{
      const scope=checkOwner(owner);if(cursor!==''&&!uuid.test(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>100)throw conflict('Invalid artifact recovery inventory page.');
      const rows=database.prepare("SELECT id,record FROM artifact_items WHERE scope=? AND status IN ('published','released') AND id>? ORDER BY id LIMIT ?").all(scope,cursor,limit+1);
      return {items:rows.slice(0,limit).map(row=>JSON.parse(row.record)),nextCursor:rows.length>limit?rows[limit-1].id:null};
    },
    recoveryReceipt:({owner,recoveryId})=>{
      const scope=checkOwner(owner);if(!uuid.test(recoveryId))throw conflict('Invalid artifact recovery receipt ID.');
      const row=database.prepare('SELECT target_type AS targetType,target_id AS targetId,record FROM artifact_recovery_receipts WHERE scope=? AND recovery_id=?').get(scope,recoveryId);
      return row?{targetType:row.targetType,targetId:row.targetId,receipt:JSON.parse(row.record)}:undefined;
    },
    gcReceipt:({owner,token})=>{
      const scope=checkOwner(owner);if(!uuid.test(token))throw conflict('Invalid artifact cleanup receipt token.');
      const row=database.prepare('SELECT record FROM artifact_gc_receipts WHERE scope=? AND token=?').get(scope,token);
      return row?JSON.parse(row.record):undefined;
    },
    finishGc:({owner,token,receipt})=>{
      const scope=checkOwner(owner);if(!uuid.test(token)||!receipt||!Array.isArray(receipt.candidates)||!Number.isSafeInteger(receipt.removed)||receipt.removed!==receipt.candidates.length)throw conflict('Invalid artifact cleanup receipt.');
      return tx(database,()=>{
        const lease=database.prepare('SELECT token,plan FROM artifact_gc WHERE scope=?').get(scope);
        if(!lease||lease.token!==token||!same({...receipt,removed:undefined}, {...JSON.parse(lease.plan),removed:undefined}))throw conflict('Artifact cleanup lease or plan changed.');
        const protectedSet=new Set(protectedIds(database,scope));
        for(const ref of receipt.candidates){
          if(!validReference(ref)||ref.ownerScope!==scope||protectedSet.has(ref.id))throw conflict('Protected artifact cannot be retired.');
          const saved=database.prepare('SELECT record,status FROM artifact_items WHERE id=? AND scope=?').get(ref.id,scope);
          if(!saved||!['published','released'].includes(saved.status)||!same(JSON.parse(saved.record),ref))throw conflict('Artifact cleanup receipt does not match custody.');
          database.prepare("UPDATE artifact_items SET status='retired' WHERE id=? AND scope=?").run(ref.id,scope);
          database.prepare('UPDATE artifact_links SET active=0 WHERE artifact_id=? AND scope=?').run(ref.id,scope);
        }
        const record=JSON.stringify(receipt);
        if(bytes(record)>limits.cleanupReserveBytes)throw conflict('Cleanup receipt exceeds its admission reserve.');
        requireAuditRoom(database,scope,record);
        database.prepare('INSERT INTO artifact_gc_receipts(scope,token,record) VALUES (?,?,?)').run(scope,token,record);
        database.prepare('DELETE FROM artifact_gc WHERE scope=? AND token=?').run(scope,token);
        return receipt;
      });
    },
    recoverGc:({owner,token,readback,recoveryId,at})=>{
      const scope=checkOwner(owner);if(!uuid.test(token)||!uuid.test(recoveryId)||!iso(at))throw conflict('Invalid artifact cleanup recovery identity.');
      return tx(database,()=>{
        const lease=database.prepare('SELECT token,plan FROM artifact_gc WHERE scope=?').get(scope);
        if(!lease||lease.token!==token)throw conflict('Artifact cleanup lease changed.');
        if(database.prepare('SELECT 1 FROM artifact_recovery_receipts WHERE scope=? AND recovery_id=?').get(scope,recoveryId))throw conflict('Artifact recovery ID was already used.');
        const plan=JSON.parse(lease.plan),items=database.prepare("SELECT record FROM artifact_items WHERE scope=? AND status IN ('published','released') ORDER BY id").all(scope).map(row=>({reference:JSON.parse(row.record)}));
        if(!validReadback(readback,items))throw conflict('Artifact cleanup readback is incomplete, uncertain or changed.');
        const candidateIds=new Set(plan.candidates.map(ref=>ref.id)),missing=new Set(readback.filter(item=>item.status==='missing').map(item=>item.id));
        if([...missing].some(id=>!candidateIds.has(id)))throw conflict('A noncandidate artifact is missing; cleanup recovery is blocked.');
        const protectedSet=new Set(protectedIds(database,scope));
        if([...missing].some(id=>protectedSet.has(id)))throw conflict('A protected artifact is missing; cleanup recovery is blocked.');
        const retiredIds=[...missing].sort(),remainingIds=plan.candidates.map(ref=>ref.id).filter(id=>!missing.has(id)).sort();
        for(const id of retiredIds){
          database.prepare("UPDATE artifact_items SET status='retired' WHERE scope=? AND id=? AND status IN ('published','released')").run(scope,id);
          database.prepare('UPDATE artifact_links SET active=0 WHERE scope=? AND artifact_id=?').run(scope,id);
        }
        const outcome=retiredIds.length===0?'aborted':remainingIds.length===0?'all_absent':'partial';
        const receipt={token,recoveryId,at,outcome,plan,retiredIds,remainingIds,readback};
        const record=JSON.stringify(receipt);
        if(bytes(record)>limits.cleanupReserveBytes)throw conflict('Cleanup recovery receipt exceeds its admission reserve.');
        requireAuditRoom(database,scope,record);
        database.prepare("INSERT INTO artifact_recovery_receipts(scope,recovery_id,target_type,target_id,at,record) VALUES (?,?,'cleanup',?,?,?)").run(scope,recoveryId,token,at,record);
        database.prepare('DELETE FROM artifact_gc WHERE scope=? AND token=?').run(scope,token);
        return {token,recoveryId,outcome,retiredIds,remainingIds};
      });
    },
    reconcileRun:(run)=>{
      const scope=checkOwner(run.owner),desired=checkpointRefs(run),old=database.prepare('SELECT node_id,artifact_id FROM artifact_links WHERE scope=? AND run_id=? AND active=1').all(scope,run.id);
      const wanted=new Set(desired.map(item=>`${item.nodeId}\0${item.reference.id}`));
      for(const link of old)if(!wanted.has(`${link.node_id}\0${link.artifact_id}`))database.prepare('UPDATE artifact_links SET active=0 WHERE scope=? AND run_id=? AND node_id=? AND artifact_id=?').run(scope,run.id,link.node_id,link.artifact_id);
      for(const {nodeId,reference} of desired){
        if(reference.ownerScope!==scope)throw conflict('Artifact owner scope does not match the run.');
        const item=database.prepare('SELECT status,record FROM artifact_items WHERE id=? AND scope=?').get(reference.id,scope);
        if(!item||!same(JSON.parse(item.record),reference))throw conflict('Run references an unpublished or changed artifact.');
        if(item.status==='retired'){
          // A historical run may continue to display an expired reference, but
          // a new run or node must not revive custody after confirmed deletion.
          if(!database.prepare('SELECT 1 FROM artifact_links WHERE scope=? AND run_id=? AND node_id=? AND artifact_id=? AND active=0').get(scope,run.id,nodeId,reference.id))throw conflict('Retired artifact cannot acquire a new run link.');
          continue;
        }
        if(item.status!=='published')throw conflict('Run references an unpublished or released artifact.');
        database.prepare('INSERT INTO artifact_links(scope,run_id,node_id,artifact_id,active) VALUES (?,?,?,?,1) ON CONFLICT(scope,run_id,node_id,artifact_id) DO UPDATE SET active=1').run(scope,run.id,nodeId,reference.id);
        database.prepare('UPDATE artifact_items SET ever_linked=1 WHERE id=?').run(reference.id);
      }
      const links=metadataUsage(database,scope).links;
      if(links.n>limits.links||links.b>limits.linkBytes)throw quota('immutable run-link history');
    },
    reconcileMemory:(record)=>{
      const {scope,loopId,key}=record;
      if(!digest.test(scope)||typeof loopId!=='string'||typeof key!=='string')throw conflict('Invalid memory artifact owner scope.');
      const desired=memoryRefs(record),old=database.prepare('SELECT artifact_id FROM artifact_memory_links WHERE scope=? AND loop_id=? AND memory_key=?').all(scope,loopId,key);
      if(old.length||desired.length)assertNoGc(database);
      for(const ref of desired){
        if(ref.ownerScope!==scope)throw conflict('Artifact owner scope does not match memory.');
        const item=database.prepare('SELECT status,record FROM artifact_items WHERE id=? AND scope=?').get(ref.id,scope);
        if(!item||item.status!=='published'||!same(JSON.parse(item.record),ref))throw conflict('Memory references an unpublished or changed artifact.');
      }
      database.prepare('DELETE FROM artifact_memory_links WHERE scope=? AND loop_id=? AND memory_key=?').run(scope,loopId,key);
      for(const ref of desired){
        database.prepare('INSERT INTO artifact_memory_links(scope,loop_id,memory_key,artifact_id) VALUES (?,?,?,?)').run(scope,loopId,key,ref.id);
        database.prepare('UPDATE artifact_items SET ever_linked=1 WHERE id=?').run(ref.id);
      }
      database.prepare('DELETE FROM artifact_memory_opaque WHERE scope=? AND loop_id=? AND memory_key=?').run(scope,loopId,key);
      const links=metadataUsage(database,scope).links;
      if(links.n>limits.links||links.b>limits.linkBytes)throw quota('artifact link history and live memory links');
    },
    retireRun:(runId)=>database.prepare('UPDATE artifact_links SET active=0 WHERE run_id=?').run(runId),
  };
}

export function validateArtifactStore(database){
  const tables={
    artifact_operations:[['scope','TEXT',1,1],['operation_id','TEXT',1,2],['status','TEXT',1,0],['reference_count','INTEGER',1,0]],
    artifact_items:[['id','TEXT',0,1],['scope','TEXT',1,0],['operation_id','TEXT',1,0],['status','TEXT',1,0],['ever_linked','INTEGER',1,0],['released_at','TEXT',0,0],['record','TEXT',1,0]],
    artifact_links:[['scope','TEXT',1,1],['run_id','TEXT',1,2],['node_id','TEXT',1,3],['artifact_id','TEXT',1,4],['active','INTEGER',1,0]],
    artifact_memory_links:[['scope','TEXT',1,1],['loop_id','TEXT',1,2],['memory_key','TEXT',1,3],['artifact_id','TEXT',1,4]],
    artifact_memory_opaque:[['scope','TEXT',1,1],['loop_id','TEXT',1,2],['memory_key','TEXT',1,3],['version','INTEGER',1,0],['value_sha256','TEXT',1,0]],
    artifact_gc:[['scope','TEXT',0,1],['token','TEXT',1,0],['started_at','TEXT',1,0],['plan','TEXT',1,0]],
    artifact_gc_receipts:[['scope','TEXT',1,1],['token','TEXT',1,2],['record','TEXT',1,0]],
    artifact_recovery_receipts:[['scope','TEXT',1,1],['recovery_id','TEXT',1,2],['target_type','TEXT',1,0],['target_id','TEXT',1,0],['at','TEXT',1,0],['record','TEXT',1,0]],
  };
  for(const [name,expected] of Object.entries(tables)){
    if(database.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(name)?.type!=='table')throw corrupt(`table ${name}`);
    const actual=database.prepare(`PRAGMA table_info(${name})`).all().map(column=>[column.name,column.type,column.notnull,column.pk]);
    if(!same(actual,expected)||!database.prepare(`PRAGMA index_list(${name})`).all().some(index=>index.origin==='pk'&&index.unique===1))throw corrupt(`table or index ${name}`);
  }
  for(const [table,expected] of Object.entries({
    artifact_items:[[0,0,'artifact_operations','scope','scope','RESTRICT'],[0,1,'artifact_operations','operation_id','operation_id','RESTRICT']],
    artifact_links:[[0,0,'artifact_items','artifact_id','id','RESTRICT']],
    artifact_memory_links:[[0,0,'artifact_items','artifact_id','id','RESTRICT'],[1,0,'memory_records','scope','scope','RESTRICT'],[1,1,'memory_records','loop_id','loop_id','RESTRICT'],[1,2,'memory_records','memory_key','key','RESTRICT']],
    artifact_memory_opaque:[[0,0,'memory_records','scope','scope','RESTRICT'],[0,1,'memory_records','loop_id','loop_id','RESTRICT'],[0,2,'memory_records','memory_key','key','RESTRICT']],
  })){
    const actual=database.prepare(`PRAGMA foreign_key_list(${table})`).all().map(row=>[row.id,row.seq,row.table,row.from,row.to,row.on_delete]);
    if(!same(actual,expected))throw corrupt(`foreign key ${table}`);
  }
  for(const [name,table,columns] of [['artifact_items_operation','artifact_items',['scope','operation_id']],['artifact_links_item','artifact_links',['artifact_id','active']],['artifact_memory_links_item','artifact_memory_links',['artifact_id']]]){
    const index=database.prepare('SELECT type,tbl_name FROM sqlite_schema WHERE name=?').get(name);
    const info=database.prepare(`PRAGMA index_info(${name})`).all().map(row=>row.name);
    if(index?.type!=='index'||index.tbl_name!==table||!same(info,columns))throw corrupt(`index ${name}`);
  }
  if(database.prepare('PRAGMA foreign_key_check').get()||database.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw corrupt('integrity or foreign key');
  for(const row of database.prepare('SELECT id,scope,operation_id,status,ever_linked,released_at,record FROM artifact_items').iterate()){
    const ref=JSON.parse(row.record);
    if(!validReference(ref)||bytes(row.record)>limits.referenceBytes||ref.id!==row.id||ref.ownerScope!==row.scope||!operationName.test(row.operation_id)||!['reserved','published','released','retired','abandoned'].includes(row.status)||![0,1].includes(row.ever_linked)||
      row.status==='released'&&(!iso(row.released_at)||row.ever_linked!==0)||row.status!=='released'&&row.released_at!==null&&!(row.status==='retired'&&iso(row.released_at)))throw corrupt('reference identity');
    const op=database.prepare('SELECT status FROM artifact_operations WHERE scope=? AND operation_id=?').get(row.scope,row.operation_id);
    if(!op||op.status==='reserved'&&row.status!=='reserved'||op.status==='published'&&!['published','released','retired'].includes(row.status)||op.status==='abandoned'&&row.status!=='abandoned')throw corrupt('publication identity');
    if(row.released_at!==null&&(database.prepare('SELECT 1 FROM artifact_links WHERE artifact_id=? LIMIT 1').get(row.id)||database.prepare('SELECT 1 FROM artifact_memory_links WHERE artifact_id=? LIMIT 1').get(row.id)))throw corrupt('released reference link');
  }
  for(const op of database.prepare('SELECT scope,operation_id,status,reference_count FROM artifact_operations').iterate()){
    if(!digest.test(op.scope)||!operationName.test(op.operation_id)||!['reserved','published','abandoned'].includes(op.status)||!Number.isSafeInteger(op.reference_count)||op.reference_count<1||database.prepare('SELECT count(*) AS count FROM artifact_items WHERE scope=? AND operation_id=?').get(op.scope,op.operation_id).count!==op.reference_count)throw corrupt('reservation count');
  }
  for(const link of database.prepare('SELECT scope,run_id,node_id,artifact_id,active FROM artifact_links').iterate()){
    const item=database.prepare('SELECT scope,status,record FROM artifact_items WHERE id=?').get(link.artifact_id);
    const run=database.prepare('SELECT record FROM runs WHERE id=?').get(link.run_id);
    if(!item||item.scope!==link.scope||!uuid.test(link.artifact_id)||typeof link.run_id!=='string'||!link.run_id||typeof link.node_id!=='string'||!link.node_id||![0,1].includes(link.active)||link.active===1&&item.status!=='published'||link.active===1&&!run||link.active===1&&!checkpointRefs(JSON.parse(run.record)).some(found=>found.nodeId===link.node_id&&found.reference.id===link.artifact_id&&same(found.reference,JSON.parse(item.record))))throw corrupt('run link');
  }
  for(const row of database.prepare('SELECT scope,loop_id,memory_key,version,value_sha256 FROM artifact_memory_opaque').iterate()){
    const saved=database.prepare('SELECT version,deleted,record FROM memory_records WHERE scope=? AND loop_id=? AND key=?').get(row.scope,row.loop_id,row.memory_key);
    if(!saved||saved.deleted!==0||saved.version!==row.version||!digest.test(row.value_sha256)||JSON.parse(saved.record).valueSha256!==row.value_sha256||
      database.prepare('SELECT 1 FROM artifact_memory_links WHERE scope=? AND loop_id=? AND memory_key=? LIMIT 1').get(row.scope,row.loop_id,row.memory_key))throw corrupt('legacy opaque memory identity');
  }
  for(const row of database.prepare('SELECT scope,loop_id,key,deleted,record FROM memory_records').iterate()){
    const opaque=database.prepare('SELECT 1 FROM artifact_memory_opaque WHERE scope=? AND loop_id=? AND memory_key=?').get(row.scope,row.loop_id,row.key);
    if(opaque)continue;
    const expected=memoryRefs(JSON.parse(row.record));
    const links=database.prepare('SELECT artifact_id FROM artifact_memory_links WHERE scope=? AND loop_id=? AND memory_key=? ORDER BY artifact_id').all(row.scope,row.loop_id,row.key).map(item=>item.artifact_id);
    if(!same(links,[...new Set(expected.map(ref=>ref.id))].sort())||row.deleted===1&&links.length)throw corrupt('memory reference links');
    for(const ref of expected){
      const item=database.prepare('SELECT scope,status,record,ever_linked FROM artifact_items WHERE id=?').get(ref.id);
      if(ref.ownerScope!==row.scope||!item||item.scope!==row.scope||item.status!=='published'||item.ever_linked!==1||!same(JSON.parse(item.record),ref))throw corrupt('memory reference custody');
    }
  }
  for(const lease of database.prepare('SELECT scope,token,started_at,plan FROM artifact_gc').iterate())if(!digest.test(lease.scope)||!uuid.test(lease.token)||!iso(lease.started_at)||!validPlan(JSON.parse(lease.plan),lease.scope))throw corrupt('cleanup lease');
  for(const receipt of database.prepare('SELECT scope,token,record FROM artifact_gc_receipts').iterate()){
    const record=JSON.parse(receipt.record);
    if(!digest.test(receipt.scope)||!uuid.test(receipt.token)||!exact(record,['planId','candidates','protected','total','bytes','removed'])||!digest.test(record.planId)||!Array.isArray(record.candidates)||record.candidates.some(ref=>!validReference(ref)||ref.ownerScope!==receipt.scope)||!Number.isSafeInteger(record.removed)||record.removed!==record.candidates.length)throw corrupt('cleanup receipt');
  }
  for(const row of database.prepare('SELECT scope,recovery_id,target_type,target_id,at,record FROM artifact_recovery_receipts').iterate()){
    const receipt=JSON.parse(row.record);
    if(!digest.test(row.scope)||!uuid.test(row.recovery_id)||!iso(row.at)||!['publication','cleanup'].includes(row.target_type)||row.target_type==='publication'&&!operationName.test(row.target_id)||row.target_type==='cleanup'&&!uuid.test(row.target_id)||!receipt||receipt.recoveryId!==row.recovery_id||receipt.at!==row.at||row.target_type==='publication'&&(receipt.operationId!==row.target_id||!['published','abandoned'].includes(receipt.outcome))||row.target_type==='cleanup'&&(receipt.token!==row.target_id||!['aborted','partial','all_absent'].includes(receipt.outcome)||!validPlan(receipt.plan,row.scope)))throw corrupt('recovery receipt');
    if(row.target_type==='publication'){
      const saved=operation(database,row.scope,row.target_id);
      if(!exact(receipt,['operationId','recoveryId','outcome','at','readback'])||!saved||saved.status!==receipt.outcome||!validReadback(receipt.readback,saved.references)||receipt.readback.some(item=>item.status!==(receipt.outcome==='published'?'published':'missing')))throw corrupt('publication recovery receipt');
    }else{
      if(!exact(receipt,['token','recoveryId','at','outcome','plan','retiredIds','remainingIds','readback'])||!Array.isArray(receipt.retiredIds)||!Array.isArray(receipt.remainingIds)||new Set([...receipt.retiredIds,...receipt.remainingIds]).size!==receipt.plan.candidates.length||!same([...receipt.retiredIds,...receipt.remainingIds].sort(),receipt.plan.candidates.map(ref=>ref.id).sort())||receipt.outcome!==(receipt.retiredIds.length===0?'aborted':receipt.remainingIds.length===0?'all_absent':'partial')||!Array.isArray(receipt.readback)||receipt.readback.some(item=>!item||!uuid.test(item.id)||!['missing','published'].includes(item.status)))throw corrupt('cleanup recovery receipt');
      const byId=new Map(receipt.readback.map(item=>[item.id,item]));
      if(byId.size!==receipt.readback.length||receipt.plan.candidates.some(ref=>!byId.has(ref.id)))throw corrupt('cleanup recovery inventory');
      for(const item of receipt.readback){
        const saved=database.prepare('SELECT record FROM artifact_items WHERE scope=? AND id=?').get(row.scope,item.id);
        if(!saved||item.status==='missing'&&(!receipt.retiredIds.includes(item.id)||item.reference!==undefined)||item.status==='published'&&(receipt.retiredIds.includes(item.id)||!validReference(item.reference)||!same(item.reference,JSON.parse(saved.record))))throw corrupt('cleanup recovery readback');
      }
    }
  }
  for(const {scope} of database.prepare(`SELECT scope FROM artifact_operations UNION SELECT scope FROM artifact_gc_receipts
    UNION SELECT scope FROM artifact_recovery_receipts UNION SELECT scope FROM artifact_links UNION SELECT scope FROM artifact_memory_links`).iterate()){
    const u=metadataUsage(database,scope);
    if(u.operations.n>limits.operations||u.operations.b>limits.operationBytes||u.items.n>limits.items||u.items.b>limits.itemBytes||u.live>limits.live||
      u.links.n>limits.links||u.links.b>limits.linkBytes||u.audit.n>limits.receipts||u.audit.b>limits.receiptBytes)throw corrupt('metadata quota');
  }
}
