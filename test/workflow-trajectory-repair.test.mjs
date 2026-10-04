import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

function document() {
  return {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Narrative stages', output: 'stages.html' },
    lanes: [{ id: 'first', label: 'First stage' }, { id: 'next', label: 'Next stage' }],
    nodes: [
      { id: 'a', lane: 'first', col: 1, type: 'backend', label: 'Prepare' },
      { id: 'b', lane: 'first', col: 0, type: 'backend', label: 'Return result' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', role: 'main' }],
    mainPath: ['a', 'b'],
  };
}

test('readable-v2 retains narrative steps when the next operation is placed to the left', () => {
  const input = document();
  input.meta.animation = 'trace';
  const frozen = JSON.stringify(input);
  const compiled = compileWorkflow({ workflow: input });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.receipt.geometryStatus, 'complete');
  assert.deepEqual(compiled.receipt.mainPath.steps, ['a', 'b']);
  assert.equal(compiled.receipt.mainPath.spatialWarnings[0].code, 'workflow/main-path-spatial-backtrack');
  assert.match(compiled.svg, /data-animate="node" style="--step:1"/);
  assert.equal(JSON.stringify(input), frozen);
});

test('a downward stage wrap preserves directed narrative connectivity', () => {
  const input = document();
  input.nodes[1].lane = 'next';
  const compiled = compileWorkflow({ workflow: input });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.receipt.mainPath.steps, input.mainPath);
  assert.equal(compiled.receipt.mainPath.spatialWarnings[0].toLane, 'next');
  input.edges = [];
  const disconnected = compileWorkflow({ workflow: input });
  assert.equal(disconnected.ok, false);
  assert.match(disconnected.error, /has no matching edge/);
  assert.equal(disconnected.receipt.geometryStatus, 'partial');
  assert.equal(disconnected.receipt.nodes.length, 2);
});

test('fixed-v1 keeps its established linear-column mainPath contract', () => {
  const input = document();
  input.schema_version = 1;
  const compiled = compileWorkflow({ workflow: input });
  assert.equal(compiled.ok, false);
  assert.match(compiled.error, /moves backward/);
});

test('a previously accepted repeated step remains accepted with explicit semantic measurement', () => {
  const input = document();
  input.nodes[0].col = 0;
  input.nodes[1].lane = 'next';
  input.edges.push({ id: 'ba', from: 'b', to: 'a', role: 'return' });
  input.mainPath.push('a');
  const compiled = compileWorkflow({ workflow: input });
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.receipt.mainPath.steps, ['a', 'b', 'a']);
  assert.deepEqual(compiled.receipt.mainPath.semanticWarnings[0].stepIndexes, [0, 2]);
});

test('independent authored preset failures are reported together with invalid partial geometry', () => {
  const input = document();
  input.nodes.push(
    { id: 'c', lane: 'next', col: 0, type: 'backend', label: 'Collect' },
    { id: 'd', lane: 'next', col: 1, type: 'backend', label: 'Publish' },
  );
  input.edges[0] = { id: 'ab', from: 'a', to: 'b', route: 'outside-right', fromSide: 'bottom', toSide: 'bottom' };
  input.edges.push({ id: 'cd', from: 'c', to: 'd', route: 'drop', fromSide: 'right', toSide: 'left' });
  const frozen = JSON.stringify(input);
  const compiled = compileWorkflow({ workflow: input });
  assert.equal(compiled.ok, false);
  assert.equal(compiled.svg, undefined);
  assert.deepEqual(new Set(compiled.diagnostics.map(d => d.subject.edge)), new Set(['ab', 'cd']));
  assert.equal(compiled.receipt.geometryStatus, 'partial');
  assert.equal(compiled.receipt.nodes.length, 4);
  assert.ok(compiled.receipt.edges.every(edge => edge.status === 'blocked'));
  assert.ok(compiled.diagnostics.every(d => d.evidence.endpointDirectionsHonored === false));
  assert.equal(JSON.stringify(input), frozen);
});

test('verified preset repair patches address authored indexes and pass a complete compiler replay', () => {
  const input = document();
  input.nodes.push(
    { id: 'c', lane: 'next', col: 0, type: 'backend', label: 'Collect' },
    { id: 'd', lane: 'next', col: 1, type: 'backend', label: 'Publish' },
  );
  // Canonical routing sorts this first authored edge after the second one.
  input.edges = [
    { id: 'zz', from: 'c', to: 'd', route: 'drop', fromSide: 'right', toSide: 'left' },
    { id: 'aa', from: 'a', to: 'b' },
  ];
  const compiled = compileWorkflow({ workflow: input });
  assert.equal(compiled.ok, false);
  const repairs = compiled.diagnostics.find(d => d.subject.edge === 'zz').evidence.verifiedRepairs;
  assert.ok(repairs.length > 0);
  for (const repair of repairs) {
    assert.equal(repair.verification.scope, 'workflow-compiler');
    const revised = structuredClone(input);
    for (const edit of repair.edits) {
      assert.match(edit.path, /^\/edges\/0\//);
      const [, , index, field] = edit.path.split('/');
      if (edit.op === 'remove') delete revised.edges[index][field];
      else revised.edges[index][field] = edit.value;
    }
    assert.equal(compileWorkflow({ workflow: revised }).ok, true, JSON.stringify(repair));
    assert.deepEqual(revised.nodes, input.nodes);
    assert.deepEqual(revised.mainPath, input.mainPath);
  }
});

test('invalid input reports unavailable geometry rather than a fabricated scene', () => {
  const compiled = compileWorkflow({ workflow: null });
  assert.equal(compiled.ok, false);
  assert.equal(compiled.receipt.geometryStatus, 'unavailable');
  assert.equal(compiled.receipt.nodes, undefined);
});
