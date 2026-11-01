// Type-check ratchet: fails CI on any NEW TypeScript error, tolerates the known
// backlog listed in scripts/tsc-baseline.txt. Fix errors, then shrink the baseline:
//   node scripts/typecheck-ratchet.mjs --update
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const baselinePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tsc-baseline.txt');
const update = process.argv.includes('--update');

const res = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], { encoding: 'utf8', shell: process.platform === 'win32' });
const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;

// Line numbers drift on unrelated edits, so key on file + code + first message line.
const current = out
  .split('\n')
  .map((l) => l.match(/^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/))
  .filter(Boolean)
  .map((m) => `${m[1]} ${m[2]} ${m[3].slice(0, 120)}`)
  .sort();

if (current.length === 0 && res.status !== 0) {
  console.error(out);
  console.error('tsc failed without reporting parseable errors.');
  process.exit(1);
}

if (update) {
  writeFileSync(baselinePath, current.join('\n') + (current.length ? '\n' : ''));
  console.log(`Baseline written: ${current.length} known error(s).`);
  process.exit(0);
}

const baseline = existsSync(baselinePath)
  ? readFileSync(baselinePath, 'utf8').split('\n').filter(Boolean)
  : [];

const remaining = [...baseline];
const added = [];
for (const e of current) {
  const i = remaining.indexOf(e);
  if (i >= 0) remaining.splice(i, 1);
  else added.push(e);
}

if (added.length) {
  console.error(`\n${added.length} NEW type error(s) (not in scripts/tsc-baseline.txt):\n`);
  added.forEach((e) => console.error('  ' + e));
  console.error('\nFix them. Run `npx tsc --noEmit` locally for line numbers.');
  process.exit(1);
}
if (remaining.length) {
  console.log(`\n${remaining.length} baseline error(s) are fixed now — run \`npm run typecheck:update\` to shrink the baseline.`);
}
console.log(`Type check OK (${current.length} known baseline error(s), 0 new).`);
