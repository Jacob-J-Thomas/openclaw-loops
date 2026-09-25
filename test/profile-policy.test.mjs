import {afterEach,describe,it,expect,vi} from 'vitest';
import {copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createProfile,repairGeneratedPolicy,configureLoopPolicy,writeProfileWithBackup} from '../scripts/profile-policy.mjs';
const config=policy=>({plugins:{entries:{'loops-poc':{enabled:true,llm:policy}}},agents:{defaults:{model:{primary:'custom/selected'}}}});
describe('profile policy migration',()=>{
  it('removes only the exact generated single-model policies and is repeatable',()=>{
    for(const model of ['openai/gpt-6-astra','ollama/qwen3.5:4b']){
      const value=config({allowAgentIdOverride:true,allowModelOverride:true,allowedModels:[model],allowedCompletionModels:[model]});
      expect(repairGeneratedPolicy(value)).toBe(true);expect(repairGeneratedPolicy(value)).toBe(false);
      expect(value.plugins.entries['loops-poc'].llm).toEqual({allowAgentIdOverride:true,allowModelOverride:true});
      expect(value.agents.defaults.model.primary).toBe('custom/selected');
    }
  });
  it('preserves operator models and additional policy keys on repeated setup',()=>{
    for(const policy of [{allowedModels:['custom/special']},{allowModelOverride:false},{allowAgentIdOverride:true,allowModelOverride:true,allowedModels:['openai/gpt-6-astra'],allowedCompletionModels:['openai/gpt-6-astra'],allowAuthProfileOverride:false}]){
      const value=config(policy),before=structuredClone(value);configureLoopPolicy(value);configureLoopPolicy(value);expect(value).toEqual(before);
    }
  });
});

const roots=[];
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const policy={allowAgentIdOverride:true,allowModelOverride:true,allowedModels:['ollama/qwen3.5:4b'],allowedCompletionModels:['ollama/qwen3.5:4b']};
function fixture(codex=false){
  const root=realpathSync(mkdtempSync(join(tmpdir(),'loops-setup-')));roots.push(root);
  copyFileSync(resolve('openclaw.plugin.json'),join(root,'openclaw.plugin.json'));
  const file=join(root,'.dev-profile',codex?'codex-test':'','openclaw.json');mkdirSync(dirname(file),{recursive:true});
  return {root,file};
}
function command(paths,script,args=[],fault){
  return spawnSync(process.execPath,[...(fault?['--import',pathToFileURL(resolve('test/helpers/profile-fault.mjs')).href]:[]),resolve('scripts',script),...args],{
    cwd:paths.root,encoding:'utf8',timeout:15000,env:{...process.env,LOOPS_TEST_PROFILE_FILE:paths.file,LOOPS_TEST_PROFILE_FAULT:fault??''},
  });
}
function custom(){return {gateway:{auth:{mode:'token',token:'synthetic-local-fixture'}},agents:{defaults:{model:{primary:'custom/selected',fallbacks:['other/fallback']},models:{'custom/selected':{params:{temperature:0}}}}},models:{providers:{custom:{baseUrl:'http://127.0.0.1:1',apiKey:'synthetic-key'}}},tools:{profile:'minimal',deny:['exec'],alsoAllow:['operator_tool']},plugins:{allow:['codex','loops-poc','custom'],entries:{custom:{enabled:false,config:{keep:'value'}},codex:{enabled:true,config:{sessionCatalog:{enabled:true,limit:13},keep:'value'}},'loops-poc':{enabled:true,llm:structuredClone(policy)}}}};}
const bytes=value=>Buffer.from(JSON.stringify(value)+'\r\n');
const backups=file=>readdirSync(dirname(file)).filter(name=>name.includes('.before-loops-')&&name.endsWith('.bak')).map(name=>join(dirname(file),name));
describe('real profile setup files',()=>{
  it.each([false,true])('initializes a complete private profile once (Codex=%s)',codex=>{
    const paths=fixture(codex),script=codex?'init-codex-profile.mjs':'init-profile.mjs';
    expect(command(paths,script).status).toBe(0);const before=readFileSync(paths.file);expect(()=>JSON.parse(before)).not.toThrow();expect(statSync(paths.file).mode&0o777).toBe(0o600);
    expect(command(paths,script).status).toBe(0);expect(readFileSync(paths.file)).toEqual(before);expect(backups(paths.file)).toEqual([]);
    const parsed=JSON.parse(before);expect(parsed.plugins?.entries?.['loops-poc']?.llm?.allowedCompletionModels).toBeUndefined();
  });
  it.each([false,true])('repairs recognized policy only for an admitted setup (Codex=%s)',codex=>{
    const paths=fixture(codex),before=custom(),original=bytes(before);writeFileSync(paths.file,original);
    const script=codex?'init-codex-profile.mjs':'init-profile.mjs',args=codex?['finish']:[];
    const result=command(paths,script,args);
    if(codex){
      expect(result.status).not.toBe(0);
      expect(readFileSync(paths.file)).toEqual(original);
      expect(backups(paths.file)).toEqual([]);
      return;
    }
    expect(result.status,result.stderr).toBe(0);const after=JSON.parse(readFileSync(paths.file));
    expect(after.agents).toEqual(before.agents);expect(after.models).toEqual(before.models);expect(after.gateway).toEqual(before.gateway);
    expect(after.plugins).toEqual({...before.plugins,entries:{...before.plugins.entries,'loops-poc':{enabled:true,llm:{allowAgentIdOverride:true,allowModelOverride:true}}}});
    expect(after.tools.deny).toEqual(['exec']);expect(after.tools.profile).toBe('minimal');expect(after.tools.alsoAllow).toContain('operator_tool');
    if(codex)for(const tool of JSON.parse(readFileSync('openclaw.plugin.json')).contracts.tools)expect(after.tools.alsoAllow).toContain(tool);
    const [backup]=backups(paths.file);expect(readFileSync(backup)).toEqual(original);expect(statSync(backup).mode&0o777).toBe(0o600);
    const committed=readFileSync(paths.file);expect(command(paths,script,args).status).toBe(0);expect(readFileSync(paths.file)).toEqual(committed);expect(backups(paths.file)).toEqual([backup]);
  });
  it('preserves custom restrictions, independent Codex settings and explicit tool denial',()=>{
    const paths=fixture(true);
    expect(command(paths,'init-codex-profile.mjs').status).toBe(0);
    const before=JSON.parse(readFileSync(paths.file));
    before.plugins.entries.codex.enabled=true;
    before.plugins.entries['loops-poc']={enabled:true,llm:{...policy,allowAuthProfileOverride:false}};
    before.tools={profile:'minimal',deny:['exec'],alsoAllow:['operator_tool']};
    writeFileSync(paths.file,bytes(before));
    expect(command(paths,'init-codex-profile.mjs',['finish']).status).toBe(0);
    const after=JSON.parse(readFileSync(paths.file));expect(after.plugins).toEqual(before.plugins);expect(after.agents).toEqual(before.agents);expect(after.tools.deny).toEqual(before.tools.deny);
    const updated=readFileSync(paths.file),originalBackups=backups(paths.file);expect(command(paths,'enable-agent-tools.mjs',[paths.file]).status).toBe(0);expect(readFileSync(paths.file)).toEqual(updated);expect(backups(paths.file)).toEqual(originalBackups);
  });
  it('backs up an explicit tool update and leaves unrelated policy intact',()=>{
    const paths=fixture(),before=custom(),original=bytes(before);writeFileSync(paths.file,original);
    expect(command(paths,'enable-agent-tools.mjs',[paths.file]).status).toBe(0);const after=JSON.parse(readFileSync(paths.file));
    expect({...after,tools:before.tools}).toEqual(before);expect(after.tools.deny).toEqual(before.tools.deny);expect(after.tools.alsoAllow).toContain('operator_tool');expect(readFileSync(backups(paths.file)[0])).toEqual(original);
    const saved=readFileSync(paths.file);expect(command(paths,'enable-agent-tools.mjs',[paths.file]).status).toBe(0);expect(readFileSync(paths.file)).toEqual(saved);expect(backups(paths.file)).toHaveLength(1);
  });
  it('repairs both development-profile paths only when recognizable and repeats safely',()=>{
    const paths=fixture(),before=custom(),original=bytes(before),second=join(dirname(paths.file),'codex-test','openclaw.json');
    const operator=custom();operator.plugins.entries['loops-poc'].llm.allowModelOverride=false;
    mkdirSync(dirname(second));writeFileSync(paths.file,original);writeFileSync(second,bytes(operator));
    expect(command(paths,'repair-dev-policies.mjs').status).toBe(0);const saved=readFileSync(paths.file);expect(readFileSync(backups(paths.file)[0])).toEqual(original);expect(readFileSync(second)).toEqual(bytes(operator));expect(backups(second)).toEqual([]);
    expect(command(paths,'repair-dev-policies.mjs').status).toBe(0);expect(readFileSync(paths.file)).toEqual(saved);expect(backups(paths.file)).toHaveLength(1);expect(readFileSync(second)).toEqual(bytes(operator));
  });
  it('keeps unique byte-exact backups for updates in the same millisecond and preserves symlinks',()=>{
    const paths=fixture(),original=bytes(custom()),target=join(dirname(paths.file),'actual.json');writeFileSync(target,original);symlinkSync(target,paths.file);vi.spyOn(Date,'now').mockReturnValue(1000);
    writeProfileWithBackup(paths.file,{step:1},original);const first=readFileSync(target);writeProfileWithBackup(paths.file,{step:2},first);
    const copies=backups(target).map(file=>readFileSync(file));expect(copies).toHaveLength(2);expect(copies).toContainEqual(original);expect(copies).toContainEqual(first);expect(lstatSync(paths.file).isSymbolicLink()).toBe(true);expect(JSON.parse(readFileSync(paths.file))).toEqual({step:2});
  });
  it('rejects stale edits and initial creation over an existing profile',()=>{
    const paths=fixture(),original=bytes(custom());writeFileSync(paths.file,original);
    expect(()=>writeProfileWithBackup(paths.file,{replacement:true},'stale')).toThrow('changed');expect(()=>createProfile(paths.file,{replacement:true})).toThrow();expect(readFileSync(paths.file)).toEqual(original);expect(backups(paths.file)).toEqual([]);
  });
  it.each(['partial-error','backup-error','rename-error','partial-kill','before-commit','after-commit'])('retains a complete active profile across %s and permits explicit retry',fault=>{
    const paths=fixture(),original=bytes(custom());writeFileSync(paths.file,original);const result=command(paths,'init-profile.mjs',[],fault);
    if(['partial-kill','before-commit','after-commit'].includes(fault))expect(result.signal).toBe('SIGKILL');else expect(result.status).not.toBe(0);
    const actual=readFileSync(paths.file);if(fault==='after-commit'){const expected=custom();repairGeneratedPolicy(expected);expect(JSON.parse(actual)).toEqual(expected);}else expect(actual).toEqual(original);
    for(const backup of backups(paths.file))expect(readFileSync(backup)).toEqual(original);
    expect(command(paths,'init-profile.mjs').status).toBe(0);expect(JSON.parse(readFileSync(paths.file)).plugins.entries['loops-poc'].llm).toEqual({allowAgentIdOverride:true,allowModelOverride:true});
    if(!['partial-kill','before-commit'].includes(fault))expect(readdirSync(dirname(paths.file)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
  });
  it.each(['partial-error','partial-kill','create-race'])('never leaves a partial new profile across %s',fault=>{
    const paths=fixture(),result=command(paths,'init-profile.mjs',[],fault);expect(result.status).not.toBe(0);
    if(fault==='create-race')expect(JSON.parse(readFileSync(paths.file))).toEqual({external:'winner'});else expect(existsSync(paths.file)).toBe(false);
    expect(command(paths,'init-profile.mjs').status).toBe(0);expect(()=>JSON.parse(readFileSync(paths.file))).not.toThrow();
  });
  it('preserves an observed external edit after staging without replacement',()=>{
    const paths=fixture(),original=bytes(custom());writeFileSync(paths.file,original);const result=command(paths,'init-profile.mjs',[],'external-edit');
    expect(result.status).not.toBe(0);expect(result.stderr).toContain('profile changed');expect(JSON.parse(readFileSync(paths.file))).toEqual({external:'winner'});expect(readFileSync(backups(paths.file)[0])).toEqual(original);
  });
  it('leaves malformed profiles and disabled plugins untouched',()=>{
    const paths=fixture(true);writeFileSync(paths.file,'{"incomplete":');expect(command(paths,'init-codex-profile.mjs',['finish']).status).not.toBe(0);expect(readFileSync(paths.file,'utf8')).toBe('{"incomplete":');
    const before=custom();before.plugins.entries['loops-poc'].enabled=false;writeFileSync(paths.file,bytes(before));expect(command(paths,'init-codex-profile.mjs',['finish']).status).not.toBe(0);expect(readFileSync(paths.file)).toEqual(bytes(before));expect(backups(paths.file)).toEqual([]);
  });
});
