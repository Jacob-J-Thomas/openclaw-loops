import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve('.');
const paths=execFileSync('npm',['ls','--omit=dev','--all','--parseable'],{encoding:'utf8'}).trim().split('\n').filter(path=>path!==root);
const sections=[];
for(const path of paths){
  const pkg=JSON.parse(readFileSync(join(path,'package.json'),'utf8'));
  const licenses=readdirSync(path).filter(file=>/^(license|licence|copying|notice)(\.|$)/i.test(file));
  if(!licenses.length)throw new Error(`Missing license text for ${pkg.name}@${pkg.version}. Review before packaging.`);
  sections.push({name:pkg.name,text:`## ${pkg.name} ${pkg.version}\n\nDeclared license: ${pkg.license??'See text below'}.\n\n`+licenses.sort().map(file=>`### ${file}\n\n\`\`\`text\n${readFileSync(join(path,file),'utf8').trim()}\n\`\`\`\n`).join('\n')});
}
writeFileSync('docs/THIRD_PARTY_NOTICES.md','# Third-party notices\n\nGenerated from the installed production dependency closure. This includes type-only dependencies declared by upstream packages; not every listed package is bundled. OpenClaw remains an external host dependency with its own distribution and notices.\n\n'+sections.sort((a,b)=>a.name.localeCompare(b.name)).map(section=>section.text).join('\n'));
console.log(`Recorded licenses for ${sections.length} dependencies.`);
