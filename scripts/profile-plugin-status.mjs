import {readFileSync,realpathSync} from 'node:fs';
import {join,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {profileEnvironment} from './isolated-runtime.mjs';

const inside=(path,parent)=>path.startsWith(parent+sep);

export function installedProfilePlugin(info,profile,id){
  if(!['codex','loops-poc'].includes(id))return false;
  try{
    const config=JSON.parse(readFileSync(join(profile,'openclaw.json'),'utf8'));
    if(config.plugins?.entries?.[id]?.enabled!==true)return false;
    if(info?.plugin?.id!==id||info.plugin.enabled!==true||info.plugin.activated!==true||info.plugin.status!=='loaded')return false;
    if(typeof info.install?.installPath!=='string'||typeof info.plugin.source!=='string')return false;
    const state=realpathSync(join(profile,'state'));
    const installed=realpathSync(info.install.installPath),source=realpathSync(info.plugin.source);
    return inside(installed,state)&&inside(source,installed);
  }catch{return false;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    let input='';for await(const chunk of process.stdin)input+=chunk;
    const info=JSON.parse(input),id=process.argv[2];
    const {profile}=profileEnvironment(process.cwd(),'codex-test');
    if(!installedProfilePlugin(info,profile,id))process.exitCode=1;
  }catch{process.exitCode=1;}
}
