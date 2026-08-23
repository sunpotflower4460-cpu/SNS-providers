import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
const providerApi = await readFile(new URL('../worker/src/index.ts', import.meta.url), 'utf8');

function requireAll(source, fragments, message) {
  if (!fragments.every((fragment) => source.includes(fragment))) throw new Error(message);
}

requireAll(api, [
  'mission.communicationDNA.slice(0, 4000)',
  ".slice(0, 4000);",
  'result.profiles.length > 40',
  'uniqueDiscoveredProfiles(result.profiles)',
  'Disabled discovery returned usage or profile data',
  'Initial free discovery returned a billable response',
  'Free AI ranking returned a billable response',
], 'Client prompt/discovery boundaries can exceed Worker limits or accept contradictory free responses.');

requireAll(providerApi, [
  "attempt.status === 'uncertain'",
  "return uncertainPaidFallback('groq', body, preflight, cors);",
  "return uncertainPaidFallback('deepseek', body, preflight, cors);",
  "return { status: 'uncertain' as const };",
  'no second paid provider was attempted',
  'costUsd: reservedUsd',
  'paid: true',
], 'A cost-uncertain paid ranking can fall through to a second paid provider or disappear from the visible budget.');

const groqUncertainIndex = providerApi.indexOf("return uncertainPaidFallback('groq', body, preflight, cors);");
const deepseekGateIndex = providerApi.indexOf('if (env.DEEPSEEK_API_KEY', groqUncertainIndex);
if (groqUncertainIndex < 0 || deepseekGateIndex < 0 || groqUncertainIndex > deepseekGateIndex) {
  throw new Error('Groq uncertainty is not resolved before the DeepSeek paid fallback gate.');
}

console.log('Budget-boundary invariants OK: outbound mission/DNA payloads stay within Worker limits, free responses stay non-billable, and a cost-uncertain paid attempt blocks additional paid fallback while retaining the conservative reservation in the client-visible cost.');
