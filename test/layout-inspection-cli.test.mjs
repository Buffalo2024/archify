import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'archify/bin/archify.mjs');
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-layout-inspection-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function inspect(type, input, cwd) {
  const run = spawnSync(process.execPath, [cli, 'validate', type, input, '--layout-json'], {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  assert.doesNotThrow(() => JSON.parse(run.stdout), run.stderr || run.stdout);
  return { run, report: JSON.parse(run.stdout) };
}

test('layout inspection keeps invalid argument failures machine readable without --json', t => {
  const dir = workspace(t);
  for (const args of [
    ['class', 'input.json', '--layout-json', '--bogus'],
    ['class', 'input.json', '--layout-json', '--quality', 'unknown'],
    ...['sequence', 'erd', 'class', 'dataflow'].map(type => [type, 'input.json', '--layout-json']),
  ]) {
    const run = spawnSync(process.execPath, [cli, 'validate', ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 2); // Existing CLI argument-error contract.
    const report = JSON.parse(run.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.stage, 'arguments');
    assert.ok(report.diagnostics.every(d => d.code.startsWith('cli/')));
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

for (const type of ['architecture', 'workflow']) {
  test(`${type} inspection reports unavailable geometry for unreadable or malformed input`, t => {
    const dir = workspace(t);
    const input = path.join(dir, 'candidate.json');
    for (const [content, code] of [[null, 'input/read'], ['{', 'input/json-parse'], ['{}', 'schema/invalid']]) {
      if (content !== null) fs.writeFileSync(input, content);
      const { run, report } = inspect(type, input, dir);
      assert.equal(run.status, 1);
      assert.equal(report.ok, false);
      assert.equal(report.geometryStatus, 'unavailable');
      assert.ok(report.diagnostics.some(d => code === 'schema/invalid' ? d.code.startsWith('schema/') : d.code === code), JSON.stringify(report));
      assert.equal('nodes' in report, false);
      assert.equal(fs.readdirSync(dir).some(f => f.endsWith('.html')), false);
    }
  });
}
