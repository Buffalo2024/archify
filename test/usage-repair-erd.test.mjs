import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-straight-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const document = {
  schema_version: 1, diagram_type: 'erd',
  meta: { title: 'Reference relation', viewBox: [900, 500] },
  entities: [
    { id: 'child', label: 'Child', pos: [70, 70], width: 210, attributes: [{ name: 'id', key: 'pk' }, { name: 'parent_id', key: 'fk', references: 'parent.id' }] },
    { id: 'parent', label: 'Parent', pos: [350, 230], width: 210, attributes: [{ name: 'id', key: 'pk' }, { name: 'name' }] },
  ],
  relationships: [{ id: 'reference', from: 'child', to: 'parent', fromCardinality: 'many', toCardinality: 'one', route: 'straight' }],
};
function run(...args) {
  return spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), ...args], { encoding: 'utf8' });
}
function inputFor(name, value) {
  const file = path.join(tmp, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
function pass(result) { assert.equal(result.status, 0, result.stderr + result.stdout); }
function orthogonal(result) { return JSON.parse(result.stdout).checks.find((check) => check.name === 'orthogonal_arrows'); }
for (const quality of ['standard', 'showcase']) {
  test(`ERD authored diagonal straight preserves source geometry and passes public validation (${quality})`, () => {
    const value = structuredClone(document);
    value.meta.quality_profile = quality;
    const input = inputFor(quality, value);
    const output = path.join(tmp, `${quality}.html`);
    pass(run('render', 'erd', input, output));
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /data-composition-points="280,108;350,268" data-composition-route="straight" d="M 280 108 L 350 268"/);
    assert.match(html, /data-er-ends="many one"/);
    pass(run('validate', 'erd', input, '--quality', quality, '--json'));
    pass(run('check', output));
    const measured = run('validate', 'erd', input, '--quality', quality, '--layout-json');
    pass(measured);
    assert.deepEqual(JSON.parse(measured.stdout).relationships[0].points, [[280, 108], [350, 268]]);
    const unmarked = path.join(tmp, `${quality}-unmarked.html`);
    fs.writeFileSync(unmarked, html.replace(' data-composition-route="straight"', ''));
    const rejected = run('check', unmarked);
    assert.equal(rejected.status, 1);
    assert.equal(orthogonal(rejected).ok, false, 'an unauthored diagonal retains the artifact rejection');
  });
}
test('ERD straight intent does not waive explicit endpoint sides or mark authored via geometry', () => {
  const pinned = structuredClone(document);
  pinned.relationships[0].fromSide = 'right';
  const rejected = run('render', 'erd', inputFor('pinned', pinned), path.join(tmp, 'pinned.html'));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /clean-flow\/endpoint-side-direction/);
  const via = structuredClone(document);
  via.relationships[0].via = [[310, 150]];
  const output = path.join(tmp, 'via.html');
  pass(run('render', 'erd', inputFor('via', via), output));
  assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /data-composition-route="straight"/);
  const checked = run('check', output);
  assert.equal(checked.status, 1);
  assert.equal(orthogonal(checked).ok, false);
});
