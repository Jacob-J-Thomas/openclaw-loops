import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(js.configs.recommended, ...ts.configs.recommended, {
  files:['**/*.{ts,tsx,mjs}'],
  languageOptions:{globals:{process:'readonly',console:'readonly',structuredClone:'readonly',setTimeout:'readonly',clearTimeout:'readonly',AbortController:'readonly',AbortSignal:'readonly',Buffer:'readonly',URL:'readonly'}},
  rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}
});
