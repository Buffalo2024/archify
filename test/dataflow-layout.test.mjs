import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(root, 'archify/renderers/dataflow/render-dataflow.mjs');
function inspect(doc, extra = ['--layout-json']) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-budget-'));
  try {
    const input = path.join(dir, 'input.json'), output = path.join(dir, 'diagram.html');
    fs.writeFileSync(input, JSON.stringify(doc));
    const result = spawnSync(process.execPath, [renderer, input, output, ...extra], { encoding: 'utf8', env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' } });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr, artifact: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null, report: extra.includes('--layout-json') ? JSON.parse(result.stdout) : null };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function fixture() {
  return { schema_version: 1, diagram_type: 'dataflow', meta: { title: 'Fork', output: 'diagram.html', viewBox: [1080, 720], quality_profile: 'showcase' },
    stages: [{ label: 'Source' }, { label: 'Consume' }],
    nodes: [
      { id: 'source', type: 'external', label: 'Source', stage: 0, row: 0 },
      { id: 'sink', type: 'backend', label: 'Sink', stage: 1, row: 0 },
      { id: 'branch', type: 'database', label: 'Branch', stage: 1, row: 2 },
    ], flows: [{ id: 'main', from: 'source', to: 'sink', label: 'facts' }, { id: 'branch', from: 'source', to: 'branch', label: 'archive' }],
  };
}
test('Dataflow invalid renderer row yields capacity evidence before non-finite routing cascades', () => {
  const doc = fixture(); doc.nodes[1].row = 6;
  const result = inspect(doc);
  assert.equal(result.code, 1);
  assert.equal(result.artifact, null);
  assert.equal(result.report.geometryStatus, 'partial');
  assert.equal(result.report.status, 'fail');
  assert.deepEqual(result.report.diagnostics.map(d => d.code), ['layout/dataflow-row-capacity']);
  const diagnostic = result.report.diagnostics[0];
  assert.equal(diagnostic.subject.nodeId, 'sink');
  assert.equal(diagnostic.evidence.maximum, 4);
  assert.match(diagnostic.message, /increasing meta.viewBox does not add rows/);
  const node = result.report.nodes.find(n => n.id === 'sink');
  assert.equal(node.available, false); assert.equal('y' in node, false);
  assert.equal(result.report.flows.find(f => f.id === 'main').available, false);
  assert.equal(result.report.nodes.find(n => n.id === 'source').available, true);
  assert.doesNotMatch(result.stdout, /NaN|non-finite/);
});
test('Dataflow budgets come from measured stage capacity and fixed centers instead of wider canvas guesses', () => {
  const doc = fixture(); delete doc.meta.viewBox;
  doc.stages = ['A', 'B', 'C', 'D', 'E'].map(label => ({ label }));
  doc.nodes[0].width = 170; doc.nodes[1].width = 170;
  const result = inspect(doc);
  assert.equal(result.code, 1);
  assert.equal(result.report.geometryStatus, 'complete');
  assert.equal(result.report.budgets.minimumStageCanvasWidth, 1068);
  assert.equal(result.report.budgets.stageCenterGap, 215);
  assert.equal(result.report.nodes.find(n => n.id === 'source').maximumCenteredWidth, 152);
  assert.equal(result.report.flows.find(f => f.id === 'main').horizontalClearGap, 45);
  assert.equal(result.artifact, null);
  assert.match(result.report.diagnostics[0].message, /Stages exceed viewBox width/);
});
test('Dataflow default fan-out replaces a 7px midpoint turn with perpendicular readable automatic segments', () => {
  const doc = fixture();
  const result = inspect(doc);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.report.ok, true);
  assert.equal(result.report.geometryStatus, 'complete');
  assert.deepEqual(result.report.diagnostics, []);
  assert.equal(result.artifact, null, 'layout evidence never writes HTML');
  const flow = result.report.flows.find(f => f.id === 'main');
  assert.equal(flow.points.length, 6);
  assert.deepEqual(flow.points[0], [156, 150]);
  assert.deepEqual(flow.points.at(-1), [259, 157]);
  for (let i = 1; i < flow.points.length; i++) {
    const [a, b] = [flow.points[i - 1], flow.points[i]];
    assert.ok(a[0] === b[0] || a[1] === b[1]);
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert.ok(length >= (i > 1 && i < flow.points.length - 1 ? 16 : 8));
  }
  const rendered = inspect(doc, []);
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.match(rendered.artifact, /data-reader-fit="authored-height"/);
  assert.match(rendered.artifact, /facts/);
  assert.match(rendered.artifact, /archive/);
});
test('Dataflow explicit controls preserve authored route geometry instead of acquiring an automatic bridge', () => {
  const doc = fixture(); doc.flows[0].via = [[207.5, 150], [207.5, 157]];
  doc.flows[0].fromSide = 'right'; doc.flows[0].toSide = 'left';
  const result = inspect(doc);
  assert.equal(result.code, 1);
  assert.deepEqual(result.report.flows.find(f => f.id === 'main').points, [[156, 157], [207.5, 150], [207.5, 157], [259, 157]]);
  assert.ok(result.report.diagnostics.some(d => d.code === 'composition/micro-segment'));
});

test('Dataflow all invalid placements expose unavailable geometry, and stage capacity is a node-specific error', () => {
  const doc = fixture();
  for (const node of doc.nodes) node.row = 8;
  doc.nodes[0].stage = 5;
  const result = inspect(doc);
  assert.equal(result.code, 1);
  assert.equal(result.report.geometryStatus, 'unavailable');
  assert.ok(result.report.nodes.every(n => !n.available));
  assert.ok(result.report.flows.every(f => !f.available));
  assert.ok(result.report.diagnostics.some(d => d.code === 'layout/dataflow-stage-capacity' && d.subject.nodeId === 'source'));
});
test('Dataflow explicit straight routing keeps its established two endpoints and passes unchanged', () => {
  const doc = fixture(); doc.flows[0].route = 'straight';
  const result = inspect(doc);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.deepEqual(result.report.flows.find(f => f.id === 'main').points, [[156, 157], [259, 157]]);
  assert.equal(result.report.nodes.length, doc.nodes.length);
  assert.equal(result.report.flows.length, doc.flows.length);
});
