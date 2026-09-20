import {afterEach,describe,expect,it} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const directories=[],secret='SYNTHETIC_PRIVATE_SETUP_MARKER';
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
const fixture=()=>{const directory=mkdtempSync(join(tmpdir(),'loops-sustained-setup-'));directories.push(directory);return directory;};
const verifier=fileURLToPath(new URL('../scripts/verify-sustained-workload.mjs',import.meta.url));
const run=(directory,archive,evidence)=>spawnSync(process.execPath,[verifier,...archive?[archive]:[]],{cwd:directory,encoding:'utf8',timeout:10000,env:{...process.env,LOOPS_EVIDENCE_DIR:evidence}});
const fakeInstallFailure=directory=>{const cli=join(directory,'node_modules','openclaw','openclaw.mjs');mkdirSync(join(directory,'node_modules','openclaw'),{recursive:true});writeFileSync(cli,`process.stderr.write(${JSON.stringify(secret)});process.exit(17);`);return cli;};

describe('sustained verifier setup failures',()=>{
  it('writes a sanitized receipt for a missing verifier argument',()=>{
    const directory=fixture(),evidence=join(directory,'evidence'),result=run(directory,undefined,evidence);
    expect(result.status).toBe(1);expect(result.stdout+result.stderr).not.toContain('Usage:');
    expect(JSON.parse(readFileSync(join(evidence,'sustained-workload','receipt.json'),'utf8'))).toMatchObject({status:'failed',phase:'start',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'unknown'});
  });

  it('writes a sanitized receipt for a missing archive before any host install',()=>{
    const directory=fixture(),evidence=join(directory,'evidence'),result=run(directory,join(directory,'missing.tgz'),evidence);
    expect(result.status).toBe(1);expect(result.stdout+result.stderr).not.toContain(directory);
    expect(JSON.parse(readFileSync(join(evidence,'sustained-workload','receipt.json'),'utf8'))).toMatchObject({status:'failed',phase:'start',code:'SUSTAINED_VERIFICATION_FAILED',archiveSha256:'unknown',noModelCalls:true,progress:{completeRuns:0,parkedRuns:0}});
  });

  it('captures a child install failure privately without echoing its stderr',()=>{
    const directory=fixture(),evidence=join(directory,'evidence'),archive=join(directory,'candidate.tgz');writeFileSync(archive,'fixture archive');fakeInstallFailure(directory);
    const result=run(directory,archive,evidence),publicOutput=result.stdout+result.stderr,receipt=readFileSync(join(evidence,'sustained-workload','receipt.json'),'utf8');
    expect(result.status).toBe(1);expect(publicOutput).not.toContain(secret);expect(publicOutput).not.toContain(directory);expect(receipt).not.toContain(secret);expect(JSON.parse(receipt)).toMatchObject({status:'failed',phase:'start',code:'SUSTAINED_VERIFICATION_FAILED',noModelCalls:true});
    const privateDirectory=join(directory,'.dev-profile'),rawDirectory=readdirSync(privateDirectory,{withFileTypes:true}).find(entry=>entry.isDirectory()&&entry.name.startsWith('sustained-workload-raw-'));
    expect(rawDirectory).toBeDefined();expect(readFileSync(join(privateDirectory,rawDirectory.name,'failure.txt'),'utf8')).toContain(secret);
  });

  it('exits nonzero without leaking setup errors when the receipt destination is unavailable',()=>{
    const directory=fixture(),archive=join(directory,'candidate.tgz'),unavailable=join(directory,'not-a-directory');writeFileSync(archive,'fixture archive');writeFileSync(unavailable,'occupied');fakeInstallFailure(directory);
    const result=run(directory,archive,unavailable);
    expect(result.status).toBe(1);expect(result.stdout+result.stderr).not.toContain(secret);expect(result.stdout+result.stderr).not.toContain(directory);expect(existsSync(join(unavailable,'sustained-workload','receipt.json'))).toBe(false);
  });

  it('keeps public output static when both receipt and private diagnostic paths are unavailable',()=>{
    const directory=fixture(),unavailable=join(directory,'not-a-directory');writeFileSync(unavailable,'occupied');writeFileSync(join(directory,'.dev-profile'),'occupied');
    const result=run(directory,join(directory,'missing.tgz'),unavailable);
    expect(result.status).toBe(1);expect(result.stdout+result.stderr).not.toContain(directory);expect(result.stdout+result.stderr).not.toContain('ENOENT');expect(result.stdout+result.stderr).not.toContain('ENOTDIR');
  });
});
