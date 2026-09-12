import {afterEach,describe,it,expect} from 'vitest';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteStorage} from '../src/storage.js';
import {examples} from '../src/examples.js';
import type {State} from '../src/engine.js';
const cleanups:Array<()=>void>=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
function setup(){const directory=mkdtempSync(join(tmpdir(),'loops-sqlite-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));const filename=join(directory,'loops.sqlite');return {directory,filename};}
const initial=():State=>({version:1,loops:Object.fromEntries(examples.map(d=>[d.id,{definition:{...structuredClone(d),revision:1},enabledRevision:null,grants:[]}])),runs:{}});
describe('plugin-owned SQLite worker',()=>{
  it('migrates JSON transactionally, retains original and backup, then reopens the database',()=>{
    const {directory,filename}=setup(),legacy=join(directory,'state.json'),state=initial();writeFileSync(legacy,JSON.stringify(state));
    const store=new SqliteStorage(filename,legacy);cleanups.push(()=>store.close());
    expect(store.read()).toEqual(state);expect(JSON.parse(readFileSync(legacy,'utf8'))).toEqual(state);
    expect(readdirSync(directory).some(name=>name.startsWith('state.json.before-sqlite-'))).toBe(true);
    expect(store.integrity()).toEqual([{integrity_check:'ok'}]);store.close();
    const reopened=new SqliteStorage(filename,legacy);cleanups.push(()=>reopened.close());expect(reopened.read()).toEqual(state);
  });
  it('rejects a competing process/store and immutable revision overwrite without a partial commit',()=>{
    const {filename}=setup();const store=new SqliteStorage(filename);cleanups.push(()=>store.close());const state=initial();store.write(state);
    expect(()=>new SqliteStorage(filename)).toThrow(/already open/);
    const invalid=structuredClone(state);invalid.loops['summarize-text'].definition.name='Changed without a revision';
    expect(()=>store.write(invalid)).toThrow(/Immutable revision conflict/);expect(store.read()).toEqual(state);
  });
  it('produces a verified backup that can be restored independently',()=>{
    const {directory,filename}=setup();const store=new SqliteStorage(filename);cleanups.push(()=>store.close());store.write(initial());
    const snapshot=join(directory,'backup.sqlite');store.backup(snapshot);const restored=new SqliteStorage(snapshot);cleanups.push(()=>restored.close());
    expect(restored.read()).toEqual(store.read());expect(restored.integrity()).toEqual([{integrity_check:'ok'}]);
  });
  it('refuses invalid legacy data without replacing it',()=>{
    const {directory,filename}=setup(),legacy=join(directory,'state.json');writeFileSync(legacy,'{"version":99}');
    expect(()=>new SqliteStorage(filename,legacy)).toThrow(/unsupported/);expect(readFileSync(legacy,'utf8')).toBe('{"version":99}');
  });
  it('reports a corrupt SQLite file promptly without replacing it',()=>{
    const {filename}=setup();writeFileSync(filename,'not a sqlite database');const start=Date.now();
    expect(()=>new SqliteStorage(filename)).toThrow(/not a database/);expect(Date.now()-start).toBeLessThan(5000);expect(readFileSync(filename,'utf8')).toBe('not a sqlite database');
  });
});
