// Tests for init-kb.mjs and check-kb.mjs. No dependencies.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'reverse-engineering-saas', 'scripts');
const run = (name, ...args) => spawnSync(process.execPath, [join(scripts, name), ...args], { encoding: 'utf8' });

let dir;
let kb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 're-kb-'));
  kb = join(dir, 're-acme');
  const init = run('init-kb.mjs', kb, '--product', 'Acme CRM');
  assert.equal(init.status, 0, init.stderr);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (path, text) => writeFileSync(join(kb, path), text);
const check = (...args) => run('check-kb.mjs', kb, ...args);

test('init creates the tree, fills product and date, copies artifact templates', () => {
  for (const path of ['STATUS.md', 'sandbox/ledger.csv', 'inventory/coverage.md', '_templates/screen.md', 'evidence/.gitkeep']) {
    assert.ok(existsSync(join(kb, path)), `${path} missing`);
  }
  const status = readFileSync(join(kb, 'STATUS.md'), 'utf8');
  assert.match(status, /# Status: Acme CRM/);
  assert.match(status, /Updated: \d{4}-\d{2}-\d{2}/);
});

test('init never overwrites existing files', () => {
  write('STATUS.md', 'kept');
  const again = run('init-kb.mjs', kb, '--product', 'Other');
  assert.equal(again.status, 0);
  assert.equal(readFileSync(join(kb, 'STATUS.md'), 'utf8'), 'kept');
});

test('a fresh KB passes with warnings for unfilled placeholders only', () => {
  const result = check();
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /OK with warnings/);
  assert.match(result.stdout, /00-charter\.md: template placeholders/);
});

test('references must resolve to definitions', () => {
  write('screens/S-001-board.md', '# S-001 Board\nFeatures: F-001\n\n## Not tested\n- Drag.\n');
  let result = check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /F-001 is referenced but not defined/);
  appendFileSync(join(kb, 'inventory/features.md'), '| F-001 | Deals | Board | Free | P1 | S-001 | todo | [doc SRC-001] |\n');
  appendFileSync(join(kb, 'sources.md'), '| SRC-001 | Help center | https://example.com/help | docs | 2026-10-15 | features |\n');
  result = check();
  assert.equal(result.status, 0, result.stdout);
});

test('rules need evidence, and cited evidence must exist', () => {
  write('rules/deals.md', '# Rules: deals\n\n### R-001 Won deals leave the board\n- Given a deal\n- When won\n- Then hidden\n');
  let result = check();
  assert.match(result.stdout, /R-001 has no evidence tag/);
  write('rules/deals.md', '# Rules: deals\n\n### R-001 Won deals leave the board\n- Evidence: [obs EV-001]\n');
  result = check();
  assert.match(result.stdout, /EV-001 is referenced but not defined/);
  write('evidence/EV-001-deal-won.png', 'png');
  result = check();
  assert.equal(result.status, 0, result.stdout);
});

test('malformed evidence tags, placeholder IDs, duplicates and broken links are errors', () => {
  write('evidence/EV-001-a.png', 'png');
  write('rules/a.md', '### R-001 One\n- Evidence: [obs SRC-001]\n\n### R-001 Again\n- Evidence: [obs EV-001]\n');
  write('topics/search.md', '# Topic: search\nSee S-000 and ![x](../evidence/EV-404-missing.png)\n\n## Not tested\n- All.\n');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[obs \.\.\.\] must cite EV-###/);
  assert.match(result.stdout, /R-001 is defined more than once/);
  assert.match(result.stdout, /placeholder ID S-000/);
  assert.match(result.stdout, /broken link \.\.\/evidence\/EV-404-missing\.png/);
});

test('[inf] needs a question and artifacts need a Not tested section', () => {
  write('components/C-001-card.md', '# C-001 Card\nProbably virtualized [inf]\n');
  const result = check();
  assert.match(result.stdout, /\[inf\] without a Q-###/);
  assert.match(result.stdout, /components\/C-001-card\.md: no "## Not tested" section/);
});

test('open ledger rows warn, and fail with --closing', () => {
  appendFileSync(join(kb, 'sandbox/ledger.csv'), 'L-001,2026-10-15T10:00:00Z,A2,create,"task ""[RE] typical""",Sandbox,123,,delete task,open,\n');
  let result = check();
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /L-001 is still open/);
  assert.match(result.stdout, /says 0 open ledger rows, ledger has 1/);
  result = check('--closing');
  assert.equal(result.status, 1);
});

test('invalid ledger rows are errors', () => {
  appendFileSync(join(kb, 'sandbox/ledger.csv'), 'L-001,2026-10-15,A9,poke,thing,here,,,,kept,\n');
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /class must be one of/);
  assert.match(result.stdout, /action must be one of/);
  assert.match(result.stdout, /kept rows need a note/);
});

test('coverage cells are counted and invalid values flagged', () => {
  appendFileSync(join(kb, 'inventory/features.md'), '| F-001 | Deals | Board | Free | P1 | | todo | |\n');
  appendFileSync(join(kb, 'inventory/coverage.md'), '| F-001 Board | done | partial | blocked: drag | todo | n/a | done | maybe | done | notes |\n');
  const result = check();
  assert.match(result.stdout, /Coverage cells: todo 1, partial 1, done 3, blocked 1, n\/a 1/);
  assert.match(result.stdout, /"maybe" is not one of/);
});

test('--next prints the next free ID per prefix', () => {
  appendFileSync(join(kb, 'inventory/features.md'), '| F-007 | Deals | Board | Free | P1 | | todo | |\n');
  write('evidence/EV-012-x.png', 'png');
  const result = check('--next');
  assert.match(result.stdout, /F-008/);
  assert.match(result.stdout, /EV-013/);
  assert.match(result.stdout, /R-001/);
});
