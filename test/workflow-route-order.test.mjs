import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '..', 'archify', 'bin', 'archify.mjs');
// An unedited first draft: the long "no approval needed" branch from the agent
// lane to the execution lane was planned before the same-lane "denied" edge
// and took the gap between Human Approval and Blocked, so "denied" could only
// detour through the same corridor (composition/ambiguous-corridor on dev).
const fixture = path.join(__dirname, 'fixtures', 'workflow-first-draft', 'agent-tool-call.workflow.json');
const load = () => JSON.parse(fs.readFileSync(fixture, 'utf8'));

test('an automatic edge squeezed into a shared corridor is planned first instead of failing the draft', () => {
  const validation = spawnSync(process.execPath, [cli, 'validate', 'workflow', fixture, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
});

test('route-order feedback is deterministic and leaves the document untouched', () => {
  const workflow = load();
  const before = JSON.stringify(workflow);
  const first = compileWorkflow({ workflow });
  const second = compileWorkflow({ workflow: load() });
  assert.equal(first.ok, true, first.error);
  assert.equal(JSON.stringify(workflow), before);
  assert.deepEqual(first.receipt.edges, second.receipt.edges);
});

test('pinned geometry keeps its own diagnostic: only automatic edges are re-ordered', () => {
  const workflow = load();
  workflow.edges.find((edge) => edge.id === 'e_auto').via = [[480.8, 243], [480.8, 449], [539.2, 449]];
  workflow.edges.find((edge) => edge.id === 'e_denied').via = [[480.8, 367], [480.8, 325], [539.2, 325]];
  const pinned = compileWorkflow({ workflow });
  assert.equal(pinned.ok, false);
  assert.deepEqual(pinned.diagnostics.map((diagnostic) => diagnostic.code), ['workflow/explicit-pin-conflict']);
});
