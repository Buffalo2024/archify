import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { segmentRectClearanceWithin } from '../archify/renderers/shared/geometry.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
function inspect(t, diagram) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-auto-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'source.json');
  const source = JSON.stringify(diagram);
  fs.writeFileSync(input, source);
  const result = spawnSync(process.execPath, [cli, 'validate', 'dataflow', input, '--json'], { encoding: 'utf8' });
  assert.equal(fs.readFileSync(input, 'utf8'), source, 'automatic layout must not rewrite authored input');
  const receipt = JSON.parse(result.stdout);
  return { result, receipt, input, output: path.join(cwd, 'diagram.html') };
}
function pipeline() {
  return {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Request processing', output: 'diagram.html', quality_profile: 'showcase' },
    stages: ['Input', 'Prepare', 'Execute', 'Decode', 'Output'].map(label => ({ label })),
    nodes: [
      { id: 'input', type: 'frontend', label: 'Configuration', stage: 0, row: 0 },
      { id: 'prepare', type: 'backend', label: 'Invocation', stage: 1, row: 0 },
      { id: 'task', type: 'backend', label: 'Task', stage: 2, row: 0 },
      { id: 'provider', type: 'external', label: 'Provider', stage: 2, row: 2 },
      { id: 'bytes', type: 'external', label: 'Log bytes', stage: 3, row: 2 },
      { id: 'decoded', type: 'backend', label: 'Answer and status', stage: 3, row: 0,
        sublabel: 'success / failed / timeout / cancelled' },
      { id: 'output', type: 'backend', label: 'Ordered results', stage: 4, row: 0,
        sublabel: 'complete / partial / failed' },
      { id: 'archive', type: 'database', label: 'Archive', stage: 4, row: 2 },
    ],
    flows: [
      ['input', 'prepare', 'configuration'], ['prepare', 'task', 'task input'],
      ['task', 'provider', 'command'], ['provider', 'bytes', 'log bytes'],
      ['bytes', 'decoded', 'decode'], ['task', 'decoded', 'timeout / cancellation'],
      ['decoded', 'output', 'answer'], ['output', 'archive', 'save mode'],
    ].map(([from, to, label], index) => ({ id: `f${index}`, from, to, label })),
  };
}

test('five-stage unpinned pipeline passes first draft with complete text and projected typography', t => {
  const diagram = pipeline();
  const { result, receipt, input, output } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(receipt.composition.metrics.desktopReadabilityIssues, 0);
  assert.ok(receipt.composition.metrics.minProjectedNodeTextPx >= 6);
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /viewBox="0 0 1068 512"/);
  assert.match(html, /data-reader-fit="intrinsic-height"/);
  assert.ok(html.includes(diagram.nodes[5].sublabel));
  for (const flow of diagram.flows) {
    assert.ok(html.includes(flow.label), flow.label);
    const points = html.match(new RegExp(`<path[^>]*data-edge-id="${flow.id}"[^>]*data-composition-points="([^"]+)"`))[1]
      .split(';').map(point => point.split(',').map(Number));
    const mask = html.match(new RegExp(`<g data-detail="context"[^>]*data-edge-id="${flow.id}"[^>]*>\\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`));
    const [x, y, width, height] = mask.slice(1).map(Number);
    assert.ok(points.slice(1).some((end, index) =>
      segmentRectClearanceWithin({ start: points[index], end }, { x, y, width, height }, 36) <= 36), flow.id);
  }
  assert.equal(receipt.composition.metrics.maxBends, 0, 'aligned routes must remain straight');
});

test('spread vertical ports use perpendicular bridges without tiny interior segments', t => {
  const diagram = pipeline();
  diagram.stages = [{ label: 'In' }, { label: 'Out' }];
  diagram.nodes = [
    { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0 },
    { id: 'b', type: 'backend', label: 'Local', stage: 0, row: 1 },
    { id: 'c', type: 'backend', label: 'Remote', stage: 1, row: 1 },
  ];
  diagram.flows = [
    { from: 'a', to: 'b', label: 'local' },
    { from: 'a', to: 'c', label: 'remote', fromSide: 'bottom', toSide: 'top' },
  ];
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(receipt.composition.metrics.microSegmentCount, 0);
  assert.equal(receipt.composition.metrics.shortInteriorSegmentCount, 0);
  assert.ok(receipt.composition.metrics.minInteriorSegmentPx >= 16);
});

for (const pin of [{ labelAt: [530, 176] }, { labelDx: 0 }, { labelDy: 0 }, { labelSegment: 0 }]) {
  test(`authored ${Object.keys(pin)[0]} keeps its vertical-label collision`, t => {
    const diagram = pipeline();
    Object.assign(diagram.flows[2], pin);
    const { result, receipt } = inspect(t, diagram);
    assert.equal(result.status, 1);
    assert.ok(receipt.diagnostics.some(({ message }) => /Label "command" overlaps node "task"/.test(message)));
  });
}

test('explicit cross-row straight route and horizontal sides remain correctly rejected', t => {
  const diagram = pipeline();
  Object.assign(diagram.flows[3], { route: 'straight', fromSide: 'right', toSide: 'left' });
  diagram.nodes[4].row = 1;
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ code }) => code === 'clean-flow/endpoint-side-direction'));
});

test('explicit canvas and node width retain the established typography and diagnostics', t => {
  const diagram = pipeline();
  diagram.meta.viewBox = [1180, 720];
  diagram.nodes[5].width = 160;
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /Label "command" overlaps node "task"/.test(message)));
  assert.ok(!receipt.diagnostics.some(({ message }) => /7\.7px legible minimum/.test(message)));
});

test('explicit wide adjacent nodes retain the 34px flow-length floor', t => {
  const diagram = pipeline();
  diagram.meta.viewBox = [1080, 720];
  diagram.nodes[5].width = 200;
  diagram.nodes[6].width = 180;
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /too short \(25px; minimum 34px\)/.test(message)));
});

test('standard keeps default node sizing and label failure instead of silently restyling', t => {
  const diagram = pipeline();
  diagram.meta.quality_profile = 'standard';
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /node "decoded" provides 104px/.test(message)));
  assert.ok(receipt.diagnostics.some(({ message }) => /Label "command" overlaps node "task"/.test(message)));
});

test('automatic labels reject a distant free island rather than lose the relationship', t => {
  const diagram = pipeline();
  diagram.stages = [{ label: 'In' }, { label: 'Out' }];
  diagram.nodes = [
    { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0,
      sublabel: 'Long supporting description for source', height: 100 },
    { id: 'b', type: 'backend', label: 'Target', stage: 1, row: 0,
      sublabel: 'Long supporting description for target', height: 100 },
  ];
  diagram.flows = [{ from: 'a', to: 'b', label: 'Long asset description' }];
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /Label "Long asset description" overlaps node/.test(message)));
});

test('natural height includes explicit outer route and two-line label plate', t => {
  const diagram = pipeline();
  diagram.stages = [{ label: 'In' }, { label: 'Out' }];
  diagram.nodes = [
    { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0 },
    { id: 'b', type: 'backend', label: 'Target', stage: 1, row: 0 },
  ];
  diagram.flows = [{ from: 'a', to: 'b', label: 'archive', classification: 'restricted',
    fromSide: 'bottom', toSide: 'bottom', via: [[100, 560], [315, 560]], labelAt: [210, 560] }];
  const { result, input, output } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /viewBox="0 0 940 674"/);
  assert.match(html, /data-composition-points="100,186;100,560;315,560;315,186"/);
  assert.match(html, /<text x="210" y="560"/);
});

function smallFootprintDiagram(flow) {
  return {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Path footprint', output: 'diagram.html', quality_profile: 'showcase' },
    stages: [{ label: 'In' }, { label: 'Out' }],
    nodes: [
      { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0 },
      { id: 'b', type: 'backend', label: 'Target', stage: 1, row: 0 },
    ],
    flows: [{ from: 'a', to: 'b', label: 'data', ...flow }],
  };
}

function footprintSvg(t, diagram) {
  const { result, input, output } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr);
  return fs.readFileSync(output, 'utf8').match(/<svg\b[^]*?<\/svg>/)[0];
}

test('straight ignores inactive channelY in both route and natural height', t => {
  const plain = footprintSvg(t, smallFootprintDiagram({ route: 'straight' }));
  const inactive = footprintSvg(t, smallFootprintDiagram({ route: 'straight', channelY: 1500 }));
  assert.match(plain, /viewBox="0 0 940 360"/);
  assert.match(plain, /data-composition-points="156,157;259,157"/);
  assert.equal(inactive, plain);
});

test('explicit via overrides channelY in both route and natural height', t => {
  const flow = { route: 'bottom-channel', fromSide: 'bottom', toSide: 'bottom',
    via: [[100, 560], [315, 560]], labelAt: [210, 560], classification: 'restricted' };
  const plain = footprintSvg(t, smallFootprintDiagram(flow));
  const inactive = footprintSvg(t, smallFootprintDiagram({ ...flow, channelY: 1500 }));
  assert.match(plain, /viewBox="0 0 940 674"/);
  assert.equal(inactive, plain);
});

test('labelAt overrides labelDy in both label and natural height', t => {
  const flow = { route: 'straight', labelAt: [210, 210] };
  const plain = footprintSvg(t, smallFootprintDiagram(flow));
  const inactive = footprintSvg(t, smallFootprintDiagram({ ...flow, labelDy: 1500 }));
  assert.match(plain, /viewBox="0 0 940 360"/);
  assert.match(plain, /<text x="210" y="210"/);
  assert.equal(inactive, plain);
});

test('empty authored via also suppresses the preset channel footprint', t => {
  const flow = { route: 'bottom-channel', fromSide: 'right', toSide: 'left', via: [] };
  const plain = footprintSvg(t, smallFootprintDiagram(flow));
  const inactive = footprintSvg(t, smallFootprintDiagram({ ...flow, channelY: 1500 }));
  assert.match(plain, /viewBox="0 0 940 360"/);
  assert.equal(inactive, plain);
});

for (const [name, flow, expectedPoints, expectedHeight] of [
  ['default bottom channel', { route: 'bottom-channel', fromSide: 'bottom', toSide: 'bottom', labelAt: [210, 230] },
    '100,186;100,212;315,212;315,186', 360],
  ['authored bottom channel', { route: 'bottom-channel', fromSide: 'bottom', toSide: 'bottom', channelY: 700, labelAt: [210, 700], classification: 'restricted' },
    '100,186;100,700;315,700;315,186', 814],
  ['default top channel', { route: 'top-channel', fromSide: 'top', toSide: 'top', labelAt: [210, 100] },
    '100,128;100,104;315,104;315,128', 360],
  ['authored top channel', { route: 'top-channel', fromSide: 'bottom', toSide: 'bottom', channelY: 700, labelAt: [210, 700], classification: 'restricted' },
    '100,186;100,700;315,700;315,186', 814],
  ['authored label offset', { route: 'straight', labelDy: 550, classification: 'restricted' },
    '156,157;259,157', 811],
]) {
  test(`natural height contains actual points and final label plate for ${name}`, t => {
    const svg = footprintSvg(t, smallFootprintDiagram(flow));
    assert.ok(svg.includes(`viewBox="0 0 940 ${expectedHeight}"`), svg.slice(0, 200));
    assert.ok(svg.includes(`data-composition-points="${expectedPoints}"`));
    const contentBottom = expectedHeight - 74 - 24;
    for (const point of expectedPoints.split(';')) assert.ok(Number(point.split(',')[1]) <= contentBottom);
    const masks = [...svg.matchAll(/<rect\b[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"[^>]*class="c-mask"/g)];
    assert.equal(masks.length, 3, 'two node masks and the rendered label plate must be measured');
    for (const match of masks) assert.ok(Number(match[1]) + Number(match[2]) <= contentBottom);
  });
}

// Frozen public SVG bytes from dev e23fc2c5. The complete HTML/receipt byte
// comparison is recorded in the PR evidence; SVG isolates renderer behavior
// from unrelated future Viewer-template changes.
for (const [name, mutate, expectedSha256] of [
  ['standard-auto', diagram => { diagram.meta.quality_profile = 'standard'; }, 'e0755ef81c30e0f0065b4766d586910f8d98354145ba7958776c3932ea40fc09'],
  ['explicit-viewbox', diagram => { diagram.meta.viewBox = [1080, 720]; }, '0517c0d97ba67919a6e3a0150abd4467fdcec0b01f32b667d086bba6be373e23'],
  ['explicit-one-width', diagram => { diagram.nodes[0].width = 152; }, 'd463001a31326170def94dce37c21967d24bc558ee404004cc9e29054db6cb36'],
  ['explicit-both', diagram => { diagram.meta.viewBox = [1080, 720]; diagram.nodes[0].width = 152; }, '258cb1e9c70c4e5377b69f4c7ef1dd04b964cc298f5061f963148f91037d9a61'],
]) {
  test(`dev byte compatibility for ${name}`, t => {
    const diagram = smallFootprintDiagram({ id: 'f' });
    diagram.nodes[0].sublabel = 'context text for processing';
    mutate(diagram);
    const { result, input, output } = inspect(t, diagram);
    assert.equal(result.status, name === 'explicit-viewbox' ? 1 : 0, result.stdout + result.stderr);
    const render = spawnSync(process.execPath, [cli, 'render', 'dataflow', input, output], { encoding: 'utf8' });
    assert.equal(render.status, 0, render.stderr);
    const svg = fs.readFileSync(output, 'utf8').match(/<svg\b[^]*?<\/svg>/)[0];
    assert.equal(crypto.createHash('sha256').update(svg).digest('hex'), expectedSha256);
  });
}
