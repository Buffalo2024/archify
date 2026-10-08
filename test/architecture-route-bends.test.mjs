import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter } from '../archify/renderers/architecture/routing.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

function box(id, x, y, width = 230, height = 80) {
  return [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
}

// The hive runtime case: a bottom-to-left relationship shares the runtime's
// bottom side with an upward security link. Both a three-bend stub route and
// a one-bend corner pass every check at the same length.
function scene(labelRectFor) {
  const boxes = new Map([box('runtime', 440, 230), box('tasks', 870, 450), box('tunnel', 440, 650)]);
  const connections = [
    { id: 'tasks', from: 'runtime', to: 'tasks', label: 'watch', fromSide: 'bottom', toSide: 'left' },
    { id: 'tunnel', from: 'tunnel', to: 'runtime', fromSide: 'top', toSide: 'bottom' },
  ];
  const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true, labelRectFor });
  return router.pathFor(connections[0]).points;
}

test('architecture takes the fewest-bend route among equally long side-aware candidates', () => {
  const points = scene();
  assert.equal(points.length, 3, JSON.stringify(points));
  assert.deepEqual(points.at(-1), [870, 490]);
  assert.equal(points[1][1], 490);
});

test('architecture keeps a feasible route with label room over a fewer-bend route without it', () => {
  const points = scene((conn, route) => (route.length > 3 ? { x: 0, y: 0, width: 1, height: 1 } : null));
  assert.equal(points.length, 5, JSON.stringify(points));
});

function validate(t, profile, replySides) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pinned-reply-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Reply', output: 'diagram.html', quality_profile: profile },
    components: [
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [40, 120], size: [200, 80] },
      { id: 'agents', type: 'backend', label: 'Agents', pos: [440, 120], size: [200, 80] },
    ],
    connections: [
      { id: 'spawn', from: 'runtime', to: 'agents', label: 'spawn' },
      { id: 'report', from: 'agents', to: 'runtime', label: 'report', ...replySides },
    ],
  }));
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--quality', profile, '--json'], {
    cwd: directory, encoding: 'utf8',
  });
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

test('showcase rejects a reply pinned around both nodes when the pair fits two straight lanes', t => {
  const { status, receipt } = validate(t, 'showcase', { fromSide: 'top', toSide: 'top' });
  assert.equal(status, 1);
  const diagnosis = receipt.diagnostics.find(({ code }) => code === 'composition/pinned-reply-detour');
  assert.ok(diagnosis, JSON.stringify(receipt.diagnostics));
  assert.equal(diagnosis.subject.id, 'report');
  assert.equal(diagnosis.evidence.replyId, 'spawn');
  assert.ok(diagnosis.evidence.unpinnedPoints.every((points) => points.length === 2));
  assert.equal(validate(t, 'showcase', {}).status, 0);
  assert.equal(validate(t, 'standard', { fromSide: 'top', toSide: 'top' }).status, 0);
});

test('architecture straightens a dogleg between facing nodes that overlap across the route', () => {
  const boxes = new Map([box('api', 40, 100, 200, 80), box('worker', 440, 130, 200, 80), box('store', 440, 330, 200, 80)]);
  const connections = [
    { id: 'run', from: 'api', to: 'worker' },
    { id: 'save', from: 'worker', to: 'store' },
  ];
  const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true });
  const points = router.pathFor(connections[0]).points;
  assert.equal(points.length, 2, JSON.stringify(points));
  assert.equal(points[0][1], points[1][1]);
  assert.ok(points[0][1] >= 146 && points[0][1] <= 164, JSON.stringify(points));
});
