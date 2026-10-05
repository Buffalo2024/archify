import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

function labeledRetry() {
  const workflow = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Anonymous retry', output: 'retry.html', quality_profile: 'showcase' },
    lanes: [{ id: 'a', label: 'Work' }, { id: 'b', label: 'Retry' }],
    nodes: [
      { id: 'work', lane: 'a', col: 0, type: 'backend', label: 'Work', width: 168, height: 58 },
      { id: 'retry', lane: 'b', col: 0, type: 'backend', label: 'Retry', width: 168, height: 58 },
    ],
    edges: [{ id: 'forward', from: 'work', to: 'retry', role: 'main', label: 'Rejected request', route: 'straight', fromSide: 'bottom', toSide: 'top' }],
    mainPath: ['work', 'retry'],
  };
  const initial = compileWorkflow({ workflow });
  assert.equal(initial.ok, true, initial.error);
  assert.equal(initial.receipt.geometryStatus, 'complete');
  const cx = initial.receipt.nodes.find(n => n.id === 'work').x + 84;
  workflow.edges.push({ id: 'return', from: 'retry', to: 'work', role: 'return', label: 'Retry allowed', route: 'outside-right', fromSide: 'right', toSide: 'right', channelX: cx + 10 });
  return workflow;
}

function failure(result) {
  const d = result.diagnostics.find(d => d.code === 'workflow/route-preset-conflict' && d.subject.edge === 'forward');
  assert.ok(d, JSON.stringify(result.diagnostics));
  return d;
}

test('preset label collision identifies the neighboring pinned segment without changing input', () => {
  const workflow = labeledRetry();
  const original = JSON.stringify(workflow);
  const result = compileWorkflow({ workflow });
  const d = failure(result);
  assert.equal(result.receipt.geometryStatus, 'partial');
  assert.equal(result.receipt.measurementStatus, 'partial-invalid');
  assert.equal(result.receipt.nodes.length, workflow.nodes.length);
  const blocked = result.receipt.edges.find(edge => edge.id === 'forward');
  const measured = result.receipt.edges.find(edge => edge.id === 'return');
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.points, undefined);
  assert.equal(measured.status, 'measured-invalid');
  assert.ok(measured.points.length >= 2);
  const f = d.evidence.feasibilityFailures[0];
  assert.equal(f.predicate, 'routeClearsPlacedLabels');
  assert.equal(f.kind, 'label-near-placed-route');
  assert.equal(f.labelEdge, 'forward');
  assert.equal(f.routeEdge, 'return');
  assert.equal(f.blockingEdge, 'return');
  assert.equal(f.labelPath, '/edges/0/label');
  assert.equal(f.routePath, '/edges/1/route');
  assert.equal(f.clearancePx, 0);
  assert.equal(f.minimumClearancePx, 4);
  assert.equal(f.segmentIndex, 1);
  assert.equal(f.segment[0][0], workflow.edges[1].channelX);
  assert.ok(f.segment[0][1] > f.labelRect.y);
  assert.ok(f.segment[1][1] < f.labelRect.y);
  assert.ok(d.supportedFixes.some(s => s.includes('not a verified repair')));
  assert.equal(JSON.stringify(workflow), original);
});

test('preset route near a previously placed label identifies the label owner', () => {
  const workflow = labeledRetry();
  delete workflow.edges[0].label;
  const oneEdge = structuredClone(workflow);
  oneEdge.edges.pop();
  const points = compileWorkflow({ workflow: oneEdge }).receipt.edges[0].points;
  workflow.edges[1].channelX = points[0][0] + 100;
  workflow.edges[1].labelAt = [points[0][0], (points[0][1] + points[1][1]) / 2];
  const d = failure(compileWorkflow({ workflow }));
  const f = d.evidence.feasibilityFailures[0];
  assert.equal(f.kind, 'route-near-placed-label');
  assert.equal(f.routeEdge, 'forward');
  assert.equal(f.labelEdge, 'return');
  assert.equal(f.blockingEdge, 'return');
  assert.equal(f.labelPath, '/edges/1/label');
  assert.equal(f.routePath, '/edges/0/route');
  assert.equal(f.clearancePx, 0);
});

test('unrelated preset direction failures do not invent placed-label evidence', () => {
  const workflow = labeledRetry();
  workflow.edges.pop();
  workflow.edges[0].toSide = 'bottom';
  const d = failure(compileWorkflow({ workflow }));
  assert.equal(d.evidence.endpointDirectionsHonored, false);
  assert.equal(d.evidence.feasibilityFailures, undefined);
});

test('public validate JSON and partial layout preserve the route-label evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-label-diagnostic-'));
  try {
    const input = join(dir, 'retry.json');
    writeFileSync(input, JSON.stringify(labeledRetry()));
    for (const flags of [['--json'], ['--json', '--layout-json']]) {
      const child = spawnSync(process.execPath, ['archify/bin/archify.mjs', 'validate', 'workflow', input, '--quality', 'showcase', ...flags], { encoding: 'utf8' });
      assert.equal(child.status, 1, child.stderr);
      const receipt = JSON.parse(child.stdout);
      const d = receipt.diagnostics.find(d => d.code === 'workflow/route-preset-conflict' && d.subject.edge === 'forward');
      assert.equal(d.evidence.feasibilityFailures[0].blockingEdge, 'return');
      assert.equal(d.evidence.feasibilityFailures[0].minimumClearancePx, 4);
      if (flags.includes('--layout-json')) assert.ok(receipt.layout || receipt.measurement || receipt.geometryStatus || receipt.scene, Object.keys(receipt).join(','));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('workflow input-contract failure reports unavailable geometry without route measurements', () => {
  const result = compileWorkflow({ workflow: {} });
  assert.equal(result.ok, false);
  assert.equal(result.receipt.geometryStatus, 'unavailable');
  assert.equal(result.receipt.nodes, undefined);
  assert.equal(result.receipt.edges, undefined);
});

test('partial workflow receipts omit overflowed boxes and canvas dimensions', () => {
  const workflow = labeledRetry();
  workflow.edges.pop();
  for (const node of workflow.nodes) node.yOffset = Number.MAX_VALUE;
  const result = compileWorkflow({ workflow });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === 'workflow/non-finite-node-geometry'));
  assert.equal(result.receipt.geometryStatus, 'partial', 'finite columns are still usable evidence');
  assert.equal(result.receipt.viewBox, undefined);
  assert.equal(result.receipt.viewBoxStatus, 'unavailable');
  assert.equal(result.receipt.requiredViewBox, undefined);
  assert.equal(result.receipt.requiredViewBoxStatus, 'unavailable');
  assert.ok(result.receipt.columns.every(Number.isFinite));
  for (const node of result.receipt.nodes) {
    assert.equal(node.status, 'unavailable');
    for (const field of ['x', 'y', 'width', 'height']) assert.equal(field in node, false);
  }
  for (const edge of result.receipt.edges) {
    assert.equal(edge.status, 'blocked');
    assert.equal(edge.points, undefined);
  }
  const { diagnostics, ...measurements } = result.receipt;
  const serialized = JSON.parse(JSON.stringify(measurements));
  assert.deepEqual(serialized, measurements, 'measurement coordinates survive JSON without null substitutions');
});

test('invalid workflow columns keep unavailable receipt geometry and schema diagnostics', () => {
  const workflow = labeledRetry();
  workflow.nodes[0].col = 6;
  const result = compileWorkflow({ workflow });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code.startsWith('schema/')));
  assert.equal(result.receipt.geometryStatus, 'unavailable');
  assert.equal(result.receipt.columns, undefined);
  assert.equal(result.receipt.nodes, undefined);
  assert.equal(result.receipt.edges, undefined);
});
