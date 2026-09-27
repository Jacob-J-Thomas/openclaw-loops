import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'../..');

export async function runPortableControlsRegression(){
  const source=`
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {PortablePackageControls} from './src/portability-ui.tsx';
    const sourcePackage={kind:'loops-template-package',formatVersion:1,digest:'a'.repeat(64),templates:[{templateId:'source',content:{},contentDigest:'b'.repeat(64),dependencies:[]}],bindings:[
      {name:'settings',type:'json',locations:[{templateId:'source',pointer:'/description'}]},
      {name:'count',type:'number',locations:[{templateId:'source',pointer:'/limits/maxExecutions'}]},
    ]};
    const calls=[];globalThis.portableControlsCalls=calls;
    const controls={
      exportPackage:async()=>sourcePackage,
      previewImport:async(pkg,environment)=>{
        calls.push({operation:'preview',environment});
        if(!Object.hasOwn(environment,'settings')||!Object.hasOwn(environment,'count'))throw Error('Missing binding.');
        return {digest:pkg.digest,resolvedDigest:'c'.repeat(64),libraryDigest:'d'.repeat(64),bindings:pkg.bindings,templates:[{templateId:'source',contentDigest:'b'.repeat(64),dependencies:[{templateId:'dependency',digest:'e'.repeat(64)}],definition:{id:'target-local',slug:'source-imported-2',name:'Bound target',settings:environment.settings},validation:{valid:false,issues:[{nodeId:'return',message:'Missing next edge.'}]}}]};
      },
      importPackage:async request=>{calls.push({operation:'import',environment:request.environment});return {imported:[{id:'target-local',slug:'source-imported-2',revision:1,enabled:false}]};},
    };
    createRoot(document.getElementById('app')).render(React.createElement(PortablePackageControls,{controls}));
  `;
  const bundle=await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',platform:'browser',write:false,target:'es2022'});
  const server=createServer((_request,response)=>{response.setHeader('content-type','text/html');response.end(`<!doctype html><html><body><div id="app"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);});
  await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
  const address=server.address(),url=`http://127.0.0.1:${address.port}`;
  const result={runner:'mounted-portability-controls-playwright',transport:'synthetic controls; no provider invoked',checks:[],errors:[]};let browser;
  try{
    browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>result.errors.push(error.message));
    await page.goto(url);await page.getByRole('button',{name:'Export package'}).click();
    await page.getByLabel('Portable environment bindings JSON').fill('{"settings":{"region":"west"},"count":2}');
    await page.getByRole('button',{name:'Preview import'}).click();await page.getByText('Previewed 1 template',{exact:false}).waitFor();
    const settings=page.getByLabel('Environment settings'),count=page.getByLabel('Environment count');
    assert.equal(await settings.inputValue(),'{\n  "region": "west"\n}');assert.equal(await count.inputValue(),'2');
    const details=page.locator('.lp-portability-preview details');assert.match(await details.locator('summary').textContent(),/source-imported-2.*Bound target/);
    await details.locator('summary').click();await page.getByText('Missing next edge.').waitFor();
    assert.match(await details.textContent(),/dependency.*e{64}/);result.checks.push('resolved target, dependency pin and invalid-draft graph diagnostic are inspectable');
    await settings.fill('{');assert.equal(await settings.inputValue(),'{');assert.equal(await settings.getAttribute('aria-invalid'),'true');
    assert.equal(await page.getByRole('button',{name:'Preview import'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Import inspected package'}).isDisabled(),true);
    result.checks.push('partial JSON text survives and blocks stale import');
    await settings.fill('["west"]');await page.getByRole('button',{name:'Preview import'}).click();await page.getByText('Previewed 1 template',{exact:false}).waitFor();
    assert.equal(await settings.inputValue(),'[\n  "west"\n]');result.checks.push('array binding remains editable JSON');
    await count.fill('');assert.equal(await count.inputValue(),'');await page.getByText('blank is not zero',{exact:false}).first().waitFor();
    assert.equal(await page.getByRole('button',{name:'Preview import'}).isDisabled(),true);result.checks.push('blank number is invalid and is not coerced to zero');
    await count.fill('0');await page.getByRole('button',{name:'Preview import'}).click();await page.getByText('Previewed 1 template',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Import inspected package'}).click();await page.getByText('Imported 1 template as drafts.').waitFor();
    const calls=await page.evaluate(()=>globalThis.portableControlsCalls);
    assert.deepEqual(calls.at(-1),{operation:'import',environment:{settings:['west'],count:0}});result.checks.push('zero and array arrive in exact inspected import while graph-invalid draft remains allowed');
    assert.deepEqual(result.errors,[]);result.passed=true;return result;
  }finally{await browser?.close();await new Promise(resolveClose=>server.close(resolveClose));}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await runPortableControlsRegression(),null,2));
