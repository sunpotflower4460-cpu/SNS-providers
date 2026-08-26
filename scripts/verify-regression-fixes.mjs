import { readFile } from 'node:fs/promises';

const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');
const wrangler = await readFile(new URL('../worker/wrangler.jsonc', import.meta.url), 'utf8');
const workload = await readFile(new URL('../src/WorkloadControls.tsx', import.meta.url), 'utf8');

const expectedGroqModel = 'llama-3.3-70b-versatile';
if (!providerApi.includes(`env.GROQ_MODEL || '${expectedGroqModel}'`)
  || !wrangler.includes(`"GROQ_MODEL": "${expectedGroqModel}"`)
  || providerApi.includes('openai/gpt-oss-20b')
  || wrangler.includes('openai/gpt-oss-20b')) {
  throw new Error('Production and fallback Groq model defaults drifted apart or regressed to the retired default.');
}

if (!workload.includes("import type { AppState, AppStateUpdater, RelationshipPolicy } from './types';")
  || !workload.includes('onChange: AppStateUpdater;')
  || (workload.match(/onChange\(\(current\) =>/g) || []).length < 2) {
  throw new Error('Workload edits can again overwrite newer async state instead of applying to the latest state.');
}

if (!workload.includes('const observedConnect =')
  || !workload.includes('const connect = Math.min(60, Math.max(observedConnect, Math.min(20, total)));')) {
  throw new Error('Recommended workload can again zero all connection capacity and starve automatic candidate refill.');
}

console.log('Regression fixes OK: production Groq defaults are aligned, workload edits preserve concurrent state, and recommendations retain auto-refill capacity.');
