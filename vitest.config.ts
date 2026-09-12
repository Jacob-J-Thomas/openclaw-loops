import {defineConfig} from 'vitest/config';

// Development profiles can contain third-party Codex plugin test fixtures.
export default defineConfig({test:{include:['test/**/*.test.ts','test/**/*.test.mjs']}});
