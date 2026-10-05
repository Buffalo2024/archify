import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'archify/bin/archify.mjs');

function withDiagnosticInstallation(inspect) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-diagnostic-loading-'));
  try {
    const skill = path.join(tmp, 'skill');
    for (const directory of ['bin', 'scripts', 'renderers/shared', 'renderers/workflow', 'renderers/architecture']) {
      fs.mkdirSync(path.join(skill, directory), { recursive: true });
    }
    fs.copyFileSync(cli, path.join(skill, 'bin/archify.mjs'));
    fs.writeFileSync(path.join(skill, 'renderers/shared/output-path.mjs'), 'export function validateAuthoredOutputPath() {}\n');
    fs.writeFileSync(path.join(skill, 'renderers/shared/validator.mjs'), 'export function validateSchema() {}\n');
    for (const type of ['workflow', 'architecture']) {
      fs.writeFileSync(path.join(skill, `renderers/${type}/render-${type}.mjs`), `
import fs from 'node:fs';
fs.writeFileSync(process.argv[3], '<svg></svg>');
`);
    }
    const input = path.join(tmp, 'input.json');
    fs.writeFileSync(input, JSON.stringify({ nodes: [{ id: 'node', width: 100, sublabel: 'context' }] }));
    const run = (type, issue) => {
      fs.writeFileSync(path.join(skill, 'scripts/check-render-output.mjs'), `
console.log(JSON.stringify(${JSON.stringify({ ok: false, composition: { issues: [issue] } })}));
process.exitCode = 1;
`);
      return spawnSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'validate', type, input, '--json'], {
        cwd: tmp,
        encoding: 'utf8',
      });
    };
    inspect(run);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const contextIssue = {
  severity: 'error', code: 'composition/desktop-readability', detail: 'context',
  owner: { kind: 'node', id: 'node' }, text: 'context',
};

test('CLI diagnostics load workflow budget runtime only for a contextual workflow readability error', () => {
  withDiagnosticInstallation(run => {
    const cases = [
      ['architecture', contextIssue],
      ['workflow', { ...contextIssue, code: 'composition/proper-crossing' }],
      ['workflow', { ...contextIssue, severity: 'warning' }],
      ['workflow', { ...contextIssue, detail: 'label' }],
      ['workflow', { ...contextIssue, owner: { kind: 'relationship' } }],
    ];
    for (const [type, issue] of cases) {
      const result = run(type, issue);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.stage, 'check');
      assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
      assert.ok(receipt.diagnostics.every(diagnostic => diagnostic.evidence.nodeTextBudget === undefined));
    }
  });
});

test('CLI diagnostics preserve a missing runtime error when workflow budget context requires it', () => {
  withDiagnosticInstallation(run => {
    const result = run('workflow', contextIssue);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(result.stderr, /text-fit\.mjs|utils\.mjs|workflow-text-profile\.mjs/);
    assert.equal(result.stdout, '');
  });
});
