import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

function retryScene() {
  const doc = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Retry handoff', output: 'retry.html', quality_profile: 'showcase', legend: { mode: 'hidden' } },
    lanes: [{ id: 'work', label: 'Work' }, { id: 'retry', label: 'Retry' }],
    nodes: [
      { id: 'a', lane: 'work', col: 0, type: 'backend', label: 'Work', width: 168, height: 58 },
      { id: 'b', lane: 'retry', col: 0, type: 'backend', label: 'Retry', width: 168, height: 58 },
    ],
    mainPath: ['a', 'b'],
    edges: [{ id: 'forward', from: 'a', to: 'b', role: 'main', label: 'Rejected request needing manual review', route: 'straight', fromSide: 'bottom', toSide: 'top' }],
  };
  const base = compileWorkflow({ workflow: doc });
  assert.equal(base.ok, true);
  const node = base.receipt.nodes[0];
  doc.edges.push({ id: 'return', from: 'b', to: 'a', role: 'return', route: 'outside-right', fromSide: 'right', toSide: 'right', channelX: node.x + node.width + 12 });
  return doc;
}

function repairs(result) {
  return result.diagnostics.flatMap(d => d.evidence?.verifiedRepairs || []);
}

function apply(doc, edits) {
  const candidate = structuredClone(doc);
  for (const { op, path, value } of edits) {
    const [, collection, index, field] = path.split('/');
    assert.equal(collection, 'edges');
    assert.ok(candidate.edges[Number(index)], path);
    assert.ok(['via', 'labelAt'].includes(field), path);
    assert.ok(['add', 'replace'].includes(op));
    candidate.edges[Number(index)][field] = structuredClone(value);
  }
  return candidate;
}

test('whole-scene implicit labels restore a legal pinned retry while preserving every route', () => {
  const doc = retryScene();
  const frozen = JSON.stringify(doc);
  const sourceRelative = structuredClone(doc);
  sourceRelative.edges[0].labelDx = 0;
  assert.equal(compileWorkflow({ workflow: sourceRelative }).ok, false);
  const result = compileWorkflow({ workflow: doc });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(JSON.stringify(doc), frozen);
  const forward = result.receipt.edges.find(e => e.id === 'forward');
  assert.equal(forward.points.length, 2);
  const work = result.receipt.nodes.find(n => n.id === 'a');
  const retry = result.receipt.nodes.find(n => n.id === 'b');
  assert.deepEqual(forward.points, [[work.x + 84, work.y + 58], [retry.x + 84, retry.y]]);
  const returning = result.receipt.edges.find(e => e.id === 'return');
  assert.equal(returning.points[1][0], doc.edges[1].channelX);
  assert.equal(returning.points[2][0], doc.edges[1].channelX);
  assert.ok(result.receipt.labels[0].x < work.x + 84);
  assert.equal(compileWorkflow({ workflow: { ...doc, edges: [...doc.edges].reverse() } }).svg, result.svg);
});

test('public validate/render/check deliver a recovered implicit-label scene', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-label-recovery-'));
  try {
    const input = join(dir, 'input.json'), output = join(dir, 'retry.html');
    writeFileSync(input, JSON.stringify(retryScene()));
    const validated = spawnSync(process.execPath, ['archify/bin/archify.mjs', 'validate', 'workflow', input, '--json'], { encoding: 'utf8' });
    assert.equal(validated.status, 0, validated.stdout + validated.stderr);
    const rendered = spawnSync(process.execPath, ['archify/bin/archify.mjs', 'render', 'workflow', input, output], { encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
    const checked = spawnSync(process.execPath, ['archify/scripts/check-render-output.mjs', output], { encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.match(readFileSync(output, 'utf8'), /Rejected request needing manual review/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a coupled label and diagonal endpoint repair remains an executable proposal', () => {
  const doc = retryScene();
  doc.edges[0].labelDx = 0;
  const geometry = compileWorkflow({ workflow: retryScene() }).receipt;
  const returning = geometry.edges.find(e => e.id === 'return').points;
  delete doc.edges[1].channelX;
  doc.edges[1].via = [[returning[1][0], returning[1][1] + 4], returning[2]];
  doc.edges.reverse(); // Authored paths must survive canonical order differences.
  const frozen = JSON.stringify(doc);
  const result = compileWorkflow({ workflow: doc });
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(doc), frozen);
  const repair = repairs(result).find(r => r.edits.some(e => e.path.endsWith('/via')) && r.edits.some(e => e.path.endsWith('/labelAt')));
  assert.ok(repair, JSON.stringify(result.diagnostics));
  assert.deepEqual(repair.verification, { scope: 'workflow-compiler', qualityProfile: 'showcase', outcome: 'pass' });
  const candidate = apply(doc, repair.edits);
  assert.deepEqual(candidate.nodes, doc.nodes);
  assert.deepEqual(candidate.mainPath, doc.mainPath);
  for (let i = 0; i < doc.edges.length; i++) {
    for (const field of ['id', 'from', 'to', 'label', 'route', 'fromSide', 'toSide', 'labelDx']) assert.deepEqual(candidate.edges[i][field], doc.edges[i][field]);
  }
  assert.equal(compileWorkflow({ workflow: candidate }).ok, true);
});

for (const control of [{ labelDx: 0 }, { labelDy: 0 }, { labelSegment: 0 }, { labelAt: [-1, 180] }, { labelAt: [132, 120] }]) {
  test(`authored label controls stay rejected until the author applies a repair: ${JSON.stringify(control)}`, () => {
    const doc = retryScene();
    Object.assign(doc.edges[0], control);
    const frozen = JSON.stringify(doc);
    assert.equal(compileWorkflow({ workflow: doc }).ok, false);
    assert.equal(JSON.stringify(doc), frozen);
  });
}
