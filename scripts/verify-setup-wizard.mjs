import { readFile } from 'node:fs/promises';

// Each setup popup step must stay "one screen, one job": a link or an in-app action,
// at most three short todos, and an automatic check whenever it blocks on verify.
const source = await readFile(new URL('../src/setupSteps.tsx', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('export const WIZARD_STEPS'), source.indexOf('export const GROUP_LABEL'));
const steps = body.split(/\n  \{\n    id: /).slice(1);
if (steps.length < 7) throw new Error('Setup wizard lost steps.');
const failures = [];
for (const step of steps) {
  const id = step.match(/^'([^']+)'/)?.[1] || '?';
  if (!/\n    open: \{ label: '[^']+', href: ['`](https:\/\/|\$\{)/.test(step) && !/\n    extra: /.test(step)) failures.push(`${id}: needs an open URL or an in-app action`);
  const todo = step.match(/\n    todo: \[([\s\S]*?)\n?    \],?\n|\n    todo: \[([^\n]*)\],\n/);
  const count = todo ? ((todo[1] || todo[2] || '').match(/'[^']+'/g) || []).length : 0;
  if (count < 1 || count > 3) failures.push(`${id}: todo must have 1-3 items (has ${count})`);
  if (/\n    verify: true,/.test(step) && !/\n    done: /.test(step)) failures.push(`${id}: verify without an automatic done() check`);
  if (!/\n    why: '[^']{8,}'/.test(step)) failures.push(`${id}: missing one-line why`);
}
const wizard = await readFile(new URL('../src/SetupWizard.tsx', import.meta.url), 'utf8');
for (const fragment of ['次はこれをやりましょう', 'わからない場合はこちら', 'chatgpt.com/?q=', 'claude.ai/new?q=', 'できた → 次へ']) {
  if (!wizard.includes(fragment)) failures.push(`SetupWizard lost "${fragment}"`);
}
if (failures.length) throw new Error(`Setup wizard invariants failed:\n${failures.join('\n')}`);
console.log(`Setup wizard OK: ${steps.length} steps, each with a link/action, 1-3 todos, verified completion, and external-AI help.`);
