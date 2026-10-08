import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  authoredControls,
  benchmarkDocument,
  contentLost,
  finalizeStatus,
} from '../.agents/skills/archify-tuning/scripts/lib.mjs';

test('tuning: content lost names the elements and relationships a final candidate dropped', () => {
  const first = {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'invalid' }],
    edges: [{ id: 'ab', from: 'a', to: 'b' }, { from: 'b', to: 'invalid', label: 'rejects' }],
  };
  const final = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'ab', from: 'a', to: 'b' }] };
  assert.deepEqual(contentLost('workflow', first, final), {
    elements: ['invalid'],
    relations: ['b>invalid>rejects'],
    firstCounts: [3, 2],
    finalCounts: [2, 1],
  });
  assert.equal(contentLost('workflow', first, null), null);
});

test('tuning: authored controls separate fully automatic drafts from pinned ones', () => {
  assert.deepEqual(authoredControls('workflow', { edges: [{ from: 'a', to: 'b', route: 'auto' }] }), {});
  assert.deepEqual(authoredControls('dataflow', {
    flows: [{ from: 'a', to: 'b', fromSide: 'right', via: [[1, 2]] }, { from: 'b', to: 'c', labelDy: 4 }],
  }), { fromSide: 1, via: 1, labelDy: 1 });
});

test('tuning: benchmark drafts drop repository evidence and keep their layout', () => {
  const draft = {
    meta: { title: 'T', output: '.archify/x/y.html', repository: { url: 'https://example.com/private.git' } },
    nodes: [{ id: 'a', col: 1, sources: [{ path: 'src/a.ts' }] }],
  };
  assert.deepEqual(benchmarkDocument(draft, 'r01-demo'), {
    meta: { title: 'T', output: 'r01-demo.html' },
    nodes: [{ id: 'a', col: 1 }],
  });
  assert.ok(draft.meta.repository, 'the source document is not modified');
});

test('tuning: finalize status reads gate results rather than the exit code of a pipe', () => {
  assert.equal(finalizeStatus('fail {"validate":"fail","deliver":"not-run"} ... Exit code: 0'), 'fail');
  assert.equal(finalizeStatus('{"schemaVersion":1,"ok":false,"status":"fail"} Exit code: 1'), 'fail');
  assert.equal(finalizeStatus('pass {"validate":"pass","deliver":"pass","check":"pass","browser-check":"pass"} Exit code: 0'), 'pass');
  assert.equal(finalizeStatus('{"ok":true,"status":"pass"}'), 'pass');
  assert.equal(finalizeStatus('Usage: archify finalize ... Exit code: 2'), 'fail');
  assert.equal(finalizeStatus('done Exit code: 0'), 'unknown');
});
