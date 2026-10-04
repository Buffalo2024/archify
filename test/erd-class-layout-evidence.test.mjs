import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segmentRectClearance, rectsOverlap } from '../archify/renderers/shared/geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../archify');
function example(kind) {
  const file = kind === 'erd' ? 'orders.erd.json' : 'payments.class.json';
  const input = JSON.parse(fs.readFileSync(path.join(root, 'examples', file), 'utf8'));
  delete input.meta.views;
  return input;
}
function inspect(kind, input) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-layout-evidence-'));
  try {
    input.meta.output = 'diagram.html';
    fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(input));
    const environment = { ...process.env };
    delete environment.ARCHIFY_DIAGNOSTIC_FORMAT;
    const result = spawnSync(process.execPath, [path.join(root, 'renderers', kind, `render-${kind}.mjs`), 'input.json', 'diagram.html', '--layout-json'], {
      cwd: directory, encoding: 'utf8', env: environment,
    });
    assert.equal(fs.existsSync(path.join(directory, 'diagram.html')), false, 'inspect never writes an HTML artifact');
    assert.ok(result.stdout.trim(), result.stderr);
    return { status: result.status, report: JSON.parse(result.stdout) };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
for (const kind of ['erd', 'class']) {
  test(`${kind}: successful inspect retains geometry, actual labels, legend and reader budget`, () => {
    const input = example(kind);
    const { status, report } = inspect(kind, input);
    assert.equal(status, 0);
    const key = kind === 'erd' ? 'entities' : 'types';
    for (const node of input[key]) {
      const measured = report[key].find((entry) => entry.id === node.id);
      for (const field of ['row', 'col']) {
        if (Number.isInteger(node[field])) assert.equal(measured[field], node[field]);
      }
    }
    assert.equal(report.contract, 'archify-layout-report/v1');
    assert.equal(report.ok, true);
    assert.equal(report.geometryStatus, 'complete');
    assert.deepEqual(report.diagnostics, []);
    const r = report.relationships.find((r) => r.labelGeometry);
    assert.deepEqual(r.ports.source.point, r.points[0]);
    assert.deepEqual(r.ports.target.point, r.points.at(-1));
    assert.equal(r.labelGeometry.rect.width > 0, true);
    assert.ok(report.legend.rects.length);
    assert.equal(report.readerBudget.scope, 'source-projection');
  });
  test(`${kind}: invalid self relation stays explicit while remaining geometry is measurable`, () => {
    const input = example(kind);
    input.relationships[0].to = input.relationships[0].from;
    const { status, report } = inspect(kind, input);
    assert.equal(status, 1);
    assert.equal(report.ok, false);
    assert.equal(report.status, 'fail');
    assert.equal(report.geometryStatus, 'partial');
    assert.equal(report.relationships.length, input.relationships.length);
    assert.equal(report.relationships[0].available, false);
    assert.equal(report.relationships[0].geometryStatus, 'unavailable');
    assert.ok(report.diagnostics.length);
    assert.ok(report[kind === 'erd' ? 'entities' : 'types'].every((node) => Number.isFinite(node.x) && Number.isFinite(node.height)));
    assert.equal(report.readerBudget.validationPassed, false);
  });
  test(`${kind}: inspect does not round fractional authored node positions`, () => {
    const input = example(kind);
    const nodes = input[kind === 'erd' ? 'entities' : 'types'];
    nodes[0].pos = [32.125, 40.375];
    input.relationships = [];
    const { report } = inspect(kind, input);
    assert.equal(report[kind === 'erd' ? 'entities' : 'types'][0].x, 32.125);
    assert.equal(report[kind === 'erd' ? 'entities' : 'types'][0].y, 40.375);
    if (kind === 'erd') assert.deepEqual(report.entities[0].pos, [32, 40]);
  });
}

test('erd: endpoint repair is an exact JSON edit verified only for the endpoint', () => {
  const input = example('erd');
  input.relationships = [input.relationships[0]];
  const r = input.relationships[0];
  r.fromSide = 'right'; r.toSide = 'left';
  const measured = inspect('erd', input).report.relationships[0].points;
  r.via = [[measured[0][0] + 40, measured[0][1] + 20], [measured.at(-1)[0] - 40, measured.at(-1)[1]]];
  const { status, report } = inspect('erd', input);
  assert.equal(status, 1);
  const d = report.diagnostics.find((d) => d.code === 'clean-flow/endpoint-side-direction' && d.evidence.endpoint === 'source');
  assert.deepEqual(d.evidence.repair.edits, [{ path: '/relationships/0/via/0/1', value: measured[0][1] }]);
  assert.equal(d.evidence.repair.verification.scope, 'endpoint');
  assert.ok(d.evidence.repair.verification.unchecked.includes('remaining route segments'));
  assert.equal(report.relationships[0].available, true);
  assert.equal(report.relationships[0].validationStatus, 'invalid');
  assert.ok(d.supportedFixes.every((fix) => typeof fix === 'string'));
});

function classLabelFixture() {
  const input = example('class');
  input.types = [['store', [80, 650], 4], ['task', [600, 650], 8], ['message', [80, 1030], 4]].map(([id, pos, count]) => ({
    id, label: id, kind: 'record', pos, width: 360,
    attributes: Array.from({ length: count }, (_, i) => ({ name: `field${i}`, type: 'Text' })),
  }));
  input.relationships = [
    { id: 'storage', from: 'store', to: 'task', kind: 'dependency', label: 'abcdefghijklmnopqr' },
    { id: 'messages', from: 'task', to: 'message', kind: 'aggregation' },
  ];
  return input;
}
test('class: implicit labels avoid the counterexample node and foreign-route obstacles', () => {
  const { status, report } = inspect('class', classLabelFixture());
  assert.equal(status, 0);
  const label = report.relationships[0].labelGeometry;
  // The former longest-segment default [584.01,734.5] overlaps Task.
  assert.notDeepEqual(label.point, [584.01, 734.5]);
  assert.equal(label.origin, 'computed');
  assert.ok(report.types.every((box) => !rectsOverlap(label.rect, box)));
  const points = report.relationships[1].points;
  assert.ok(points.slice(1).every((end, i) => segmentRectClearance({ start: points[i], end }, label.rect) >= 4));
});
test('class: explicit conflicting labelAt remains authoritative and failure remains measurable', () => {
  const input = classLabelFixture();
  input.relationships[0].labelAt = [475, 815];
  input.meta.viewBox = [1504, 1222];
  const { status, report } = inspect('class', input);
  assert.equal(status, 1);
  assert.deepEqual(report.relationships[0].labelGeometry.point, [475, 815]);
  assert.equal(report.relationships[0].labelGeometry.origin, 'authored');
  assert.ok(report.diagnostics.some((d) => d.code === 'composition/label-route-clearance'));
  assert.equal(report.geometryStatus, 'complete');
  assert.equal(report.readerBudget.projectedRelationshipLabelsMeetFloor, false);
  assert.equal(report.readerBudget.maxCanvasWidthForRelationshipLabels, 1472.5);
});

for (const kind of ['erd', 'class']) {
  for (const cause of ['missing-placement', 'arithmetic-overflow']) {
    test(`${kind}: ${cause} never serializes unavailable geometry as null measurements`, () => {
      const input = example(kind);
      input.relationships = [];
      input.meta.viewBox = [1200, 800];
      if (cause === 'missing-placement') {
        const node = input[kind === 'erd' ? 'entities' : 'types'][0];
        delete node.row; delete node.col; delete node.pos;
      } else input.layout.gapX = 1e308;
      const { status, report } = inspect(kind, input);
      assert.equal(status, 1);
      assert.equal(report.ok, false);
      assert.ok(['partial', 'unavailable'].includes(report.geometryStatus));
      const nodes = report[kind === 'erd' ? 'entities' : 'types'];
      assert.ok(nodes.some((node) => node.available === false));
      for (const node of nodes) {
        if (node.available === false) {
          assert.equal(node.geometryStatus, 'unavailable');
          assert.equal(Object.hasOwn(node, 'x'), false);
          assert.equal(Object.hasOwn(node, 'y'), false);
        } else {
          assert.ok([node.x, node.y, node.width, node.height].every(Number.isFinite));
          if (node.labelGeometry?.available) assert.ok(node.labelGeometry.point.every(Number.isFinite));
          else if (node.labelGeometry) {
            assert.equal(node.labelGeometry.geometryStatus, 'unavailable');
            assert.equal(Object.hasOwn(node.labelGeometry, 'point'), false);
          }
        }
      }
    });
  }
}
test('erd: a collapsed tiny endpoint segment cannot receive a falsely verified repair', () => {
  const input = example('erd');
  input.relationships = [input.relationships[0]];
  const r = input.relationships[0];
  r.fromSide = 'right'; r.toSide = 'left';
  const measured = inspect('erd', input).report.relationships[0].points;
  r.via = [[measured[0][0] + 0.00001, measured[0][1] + 20], [measured[0][0], measured[0][1] + 60], [measured.at(-1)[0] - 40, measured.at(-1)[1]]];
  const { status, report } = inspect('erd', input);
  assert.equal(status, 1);
  const d = report.diagnostics.find((d) => d.code === 'clean-flow/endpoint-side-direction' && d.evidence.endpoint === 'source');
  assert.ok(d);
  assert.equal(d.evidence.repair, undefined);
});


test('class: large early partial reports drain stdout for direct renderer and public CLI', () => {
  const input = example('class');
  input.types = Array.from({ length: 1600 }, (_, index) => ({
    id: `node_${index}`, label: `Node ${index}`, kind: 'class',
    ...(index ? { pos: [32, 40] } : {}),
  }));
  input.relationships = [];
  const direct = inspect('class', input);
  assert.equal(direct.status, 1);
  assert.equal(direct.report.types.length, 1600);
  assert.equal(direct.report.types[0].geometryStatus, 'unavailable');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-large-partial-'));
  try {
    input.meta.output = 'diagram.html';
    fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(input));
    const environment = { ...process.env };
    delete environment.ARCHIFY_DIAGNOSTIC_FORMAT;
    const result = spawnSync(process.execPath, [path.join(root, 'bin', 'archify.mjs'), 'validate', 'class', 'input.json', '--layout-json'], {
      cwd: directory, encoding: 'utf8', env: environment, maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(Buffer.byteLength(result.stdout) > 65536);
    const report = JSON.parse(result.stdout);
    assert.equal(report.contract, 'archify-layout-report/v1');
    assert.equal(report.types.length, 1600);
    assert.equal(report.geometryStatus, 'partial');
    assert.equal(fs.existsSync(path.join(directory, 'diagram.html')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
