import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

// Anonymous staged flow: a branch spanning two lanes competes with the normal
// serpentine stages. The canonical reservation order used to leave a corridor.
function stagedFlow(branch = true) {
  const doc = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Route reservations', output: 'reservations.html', quality_profile: 'showcase' },
    lanes: [], nodes: [], edges: [], mainPath: [],
  };
  for (let row = 0; row < 3; row += 1) {
    doc.lanes.push({ id: `l${row}`, label: `Stage ${row}` });
    for (let col = 0; col < 6; col += 1) {
      doc.nodes.push({ id: `n${row}_${col}`, lane: `l${row}`, col, type: 'backend', label: `Step ${row}/${col}`, width: 132 });
    }
    const ids = Array.from({ length: 6 }, (_, index) => `n${row}_${row % 2 ? 5 - index : index}`);
    for (const id of ids) {
      if (doc.mainPath.length) doc.edges.push({ id: `e${doc.edges.length}`, from: doc.mainPath.at(-1), to: id, role: 'main' });
      doc.mainPath.push(id);
    }
  }
  if (branch) doc.edges.push({ id: 'b2', from: 'n0_1', to: 'n2_4', role: 'branch' });
  return doc;
}

test('automatic reservations recover a full scene without changing its authored flow', () => {
  const doc = stagedFlow();
  const frozen = JSON.stringify(doc);
  const result = compileWorkflow({ workflow: doc });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.receipt.geometryStatus, 'complete');
  assert.deepEqual(result.receipt.mainPath.steps, doc.mainPath);
  assert.equal(result.receipt.edges.length, doc.edges.length);
  assert.equal(result.diagnostics?.some(d => d.severity === 'error') ?? false, false);
  assert.equal(JSON.stringify(doc), frozen);

  // An explicitly authored zero offset has the same geometry but disables
  // automatic replay. This preserves the original complete-scene failure.
  const pinned = structuredClone(doc);
  pinned.nodes[0].yOffset = 0;
  const preserved = compileWorkflow({ workflow: pinned });
  assert.equal(preserved.ok, false);
  assert.ok(preserved.diagnostics.some(d => d.code === 'composition/ambiguous-corridor'));
});

test('default success retains SVG, source badges, and deterministic document order', () => {
  const doc = stagedFlow(false);
  const sourceEvidence = { nodes: { n0_0: [{ path: 'example.mjs', line: 1 }] } };
  const result = compileWorkflow({ workflow: doc, sourceEvidence });
  const pinned = structuredClone(doc);
  pinned.nodes[0].yOffset = 0;
  const fixed = compileWorkflow({ workflow: pinned, sourceEvidence });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.svg, fixed.svg);
  const permuted = structuredClone(doc);
  permuted.edges.reverse();
  assert.equal(compileWorkflow({ workflow: permuted, sourceEvidence }).svg, result.svg);
  assert.notEqual(compileWorkflow({ workflow: doc }).svg, result.svg);
});

test('a recovered scene keeps source evidence through the internal replay', () => {
  const doc = stagedFlow();
  const ordinary = compileWorkflow({ workflow: doc });
  const sourced = compileWorkflow({ workflow: doc, sourceEvidence: { nodes: { n0_0: [{ path: 'example.mjs', line: 1 }] } } });
  assert.equal(sourced.ok, true, sourced.error);
  assert.deepEqual(sourced.receipt.edges, ordinary.receipt.edges);
  assert.notEqual(sourced.svg, ordinary.svg);
});

test('unresolved joint routing returns the original failure receipt', () => {
  const doc = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Dense routing', output: 'dense.html', quality_profile: 'showcase' },
    lanes: [{ id: 'a', label: 'First' }, { id: 'b', label: 'Next' }],
    nodes: [], edges: [], mainPath: ['a0', 'b0'],
  };
  for (const lane of ['a', 'b']) for (let col = 0; col < 3; col += 1) doc.nodes.push({ id: `${lane}${col}`, lane, col, type: 'backend', label: `${lane}${col}` });
  for (let from = 0; from < 3; from += 1) for (let to = 0; to < 3; to += 1) doc.edges.push({ id: `e${from}${to}`, from: `a${from}`, to: `b${to}`, role: 'branch' });
  const frozen = JSON.stringify(doc);
  const result = compileWorkflow({ workflow: doc });
  const pinned = structuredClone(doc);
  pinned.nodes[0].yOffset = 0;
  const original = compileWorkflow({ workflow: pinned });
  assert.equal(result.ok, false);
  assert.deepEqual(result.diagnostics, original.diagnostics);
  assert.deepEqual(result.receipt, original.receipt);
  assert.equal(result.error, original.error);
  assert.equal(JSON.stringify(doc), frozen);
});

function retryFlow() {
  const doc = {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Retry ports', output: 'retry.html', quality_profile: 'showcase' },
    lanes: [], nodes: [], edges: [], mainPath: ['m0', 'm1', 'm2'],
  };
  for (let row = 0; row < 3; row += 1) {
    doc.lanes.push({ id: `l${row}`, label: `Stage ${row}` });
    doc.nodes.push({ id: `m${row}`, lane: `l${row}`, col: 1, type: 'backend', label: `Step ${row}`, width: 160, height: 76 });
    if (!row) continue;
    doc.nodes.push({ id: `r${row}`, lane: `l${row}`, col: 0, type: 'backend', label: `Retry ${row}`, width: 160, height: 76 });
    doc.edges.push(
      { id: `main${row}`, from: `m${row - 1}`, to: `m${row}`, route: 'straight', fromSide: 'bottom', toSide: 'top', role: 'main' },
      { id: `out${row}`, from: `m${row}`, to: `r${row}`, route: 'straight', fromSide: 'left', toSide: 'right', role: 'branch', label: 'Retry' },
      { id: `back${row}`, from: `r${row}`, to: `m${row}`, route: 'auto', fromSide: 'bottom', toSide: 'left', role: 'return', label: 'Again' },
    );
  }
  return doc;
}

test('two retry returns avoid fixed straight exits while keeping every side and absolute straight point', () => {
  const doc = retryFlow();
  const frozen = JSON.stringify(doc);
  const result = compileWorkflow({ workflow: doc });
  assert.equal(result.ok, true, result.error);
  const nodes = new Map(result.receipt.nodes.map(node => [node.id, node]));
  const routes = new Map(result.receipt.edges.map(edge => [edge.id, edge.points]));
  for (let row = 1; row < 3; row += 1) {
    const main = nodes.get(`m${row}`), retry = nodes.get(`r${row}`), previous = nodes.get(`m${row - 1}`);
    assert.deepEqual(routes.get(`out${row}`), [[main.x, main.y + main.height / 2], [retry.x + retry.width, retry.y + retry.height / 2]]);
    assert.deepEqual(routes.get(`main${row}`), [[previous.x + previous.width / 2, previous.y + previous.height], [main.x + main.width / 2, main.y]]);
    const back = routes.get(`back${row}`);
    assert.equal(back[0][1], retry.y + retry.height);
    assert.ok(back[1][1] > back[0][1], 'source leaves the required bottom side');
    assert.equal(back.at(-1)[0], main.x);
    assert.ok(back.at(-2)[0] < main.x, 'target enters the required left side');
    assert.ok(back.at(-1)[1] >= main.y + 16 && back.at(-1)[1] <= main.y + main.height - 16);
    assert.notEqual(back.at(-1)[1], main.y + main.height / 2);
  }
  assert.deepEqual(result.receipt.mainPath.steps, doc.mainPath);
  assert.equal(JSON.stringify(doc), frozen);
});

for (const pin of [{ via: [[0, 0]] }, { channelY: -1 }]) {
  test(`invalid absolute retry geometry remains authoritative ${JSON.stringify(pin)}`, () => {
    const doc = retryFlow();
    Object.assign(doc.edges.find(edge => edge.id === 'back1'), pin);
    const frozen = JSON.stringify(doc);
    const result = compileWorkflow({ workflow: doc });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(d => d.code === 'workflow/explicit-pin-conflict'));
    assert.equal(result.svg, undefined);
    assert.equal(JSON.stringify(doc), frozen);
  });
}
