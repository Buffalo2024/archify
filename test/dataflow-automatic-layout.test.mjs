import assert from 'node:assert/strict';
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
  for (const flow of diagram.flows) assert.ok(html.includes(flow.label), flow.label);
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

test('explicit canvas and node width retain their real projected text budget', t => {
  const diagram = pipeline();
  diagram.meta.viewBox = [1180, 720];
  diagram.nodes[5].width = 160;
  const { result, receipt } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(({ message }) => /7\.7px legible minimum.*provides 152px/.test(message)));
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
    { id: 'a', type: 'backend', label: 'Source', stage: 0, row: 0, width: 152, height: 100 },
    { id: 'b', type: 'backend', label: 'Target', stage: 1, row: 0, width: 168, height: 100 },
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
