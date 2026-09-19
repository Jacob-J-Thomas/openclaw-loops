import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {runEditorAdvancedRegression} from '../test/browser/editor-advanced.spec.mjs';

const receipt=resolve(process.env.LOOPS_EVIDENCE_DIR??'evidence/issue-45/review-repair','editor-advanced-receipt.json');
await mkdir(dirname(receipt),{recursive:true});
const result=await runEditorAdvancedRegression({receiptPath:receipt});
await writeFile(receipt,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,receipt},null,2));
