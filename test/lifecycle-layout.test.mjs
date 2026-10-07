// Lifecycle v3: geometry follows from mainPath and transitions alone. These
// checks render small public inputs and inspect the artifact, so they hold the
// layout contract (rows, arcs, shared exits) rather than exact coordinates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeLabelLayout } from '../archify/renderers/shared/text-fit.mjs';
import { SOURCE_BADGE_FOOTPRINT } from '../archify/renderers/shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

let counter = 0;
function render(doc) {
  counter += 1;
  const input = path.join(tmp, `case-${counter}.json`);
  const output = path.join(tmp, `case-${counter}.html`);
  fs.writeFileSync(input, JSON.stringify({ ...doc, meta: { ...doc.meta, output: `case-${counter}.html` } }));
  try {
    execFileSync('node', [path.join(skillRoot, 'renderers/lifecycle/render-lifecycle.mjs'), input, output], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    return { code: error.status ?? 1, stderr: String(error.stderr || '') };
  }
  const html = fs.readFileSync(output, 'utf8');
  const check = JSON.parse(execFileSync('node', [path.join(skillRoot, 'scripts/check-render-output.mjs'), output], { encoding: 'utf8' }));
  return { code: 0, html, svg: html.match(/<svg\b[\s\S]*?<\/svg>/)[0], check };
}

const state = (id, type = 'active', label = id) => ({ id, type, label });
const base = (overrides) => ({
  schema_version: 3,
  diagram_type: 'lifecycle',
  meta: { title: 'Lifecycle', quality_profile: 'showcase' },
  ...overrides,
});

function points(svg, from, to) {
  const tag = [...svg.matchAll(/<path [^>]*data-edge-from="([^"]+)" data-edge-to="([^"]+)"[^>]*data-composition-points="([^"]+)"/g)]
    .find((match) => match[1] === from && match[2] === to);
  assert.ok(tag, `route ${from} -> ${to}`);
  return tag[3].split(';').map((pair) => pair.split(',').map(Number));
}
function allPoints(svg, from, to) {
  return [...svg.matchAll(/<path [^>]*data-edge-from="([^"]+)" data-edge-to="([^"]+)"[^>]*data-composition-points="([^"]+)"/g)]
    .filter((match) => match[1] === from && match[2] === to)
    .map((match) => match[3].split(';').map((pair) => pair.split(',').map(Number)));
}
function box(svg, id) {
  const group = svg.match(new RegExp(`data-node-id="${id}"[\\s\\S]*?<rect x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)"`));
  return { x: Number(group[1]), y: Number(group[2]), width: Number(group[3]), height: Number(group[4]) };
}

test('bundled examples pass the showcase artifact check without crossings', () => {
  for (const name of ['agent-run.lifecycle.json', 'deployment-release.lifecycle.json']) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', name), 'utf8'));
    const result = render(doc);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
    assert.equal(result.check.composition.metrics.properCrossings, 0, name);
    assert.equal(result.check.composition.metrics.resolvedCrossovers, 0, name);
  }
});

test('main path is one row, loops arc above it and other states sit one row per step below', () => {
  const result = render(base({
    mainPath: ['draft', 'review', 'done'],
    states: [state('draft', 'start'), state('review', 'decision'), state('done', 'success'), state('hold', 'waiting'), state('archived', 'neutral')],
    transitions: [
      { from: 'draft', to: 'review', label: 'submit' },
      { from: 'review', to: 'done', label: 'approve' },
      { from: 'review', to: 'draft', label: 'changes' },
      { from: 'review', to: 'hold', label: 'needs info' },
      { from: 'hold', to: 'review', label: 'info added' },
      { from: 'hold', to: 'archived', label: 'expired' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  const [draft, review, done, hold, archived] = ['draft', 'review', 'done', 'hold', 'archived'].map((id) => box(result.svg, id));
  assert.equal(draft.y, review.y);
  assert.equal(review.y, done.y);
  assert.ok(draft.x < review.x && review.x < done.x);
  assert.ok(hold.y > review.y + review.height, 'branch state sits below the main path');
  assert.ok(archived.y > hold.y + hold.height, 'a state reached from a branch sits one row deeper');
  const loop = points(result.svg, 'review', 'draft');
  assert.ok(Math.min(...loop.map(([, y]) => y)) < review.y, 'a return to an earlier phase arcs above the row');
  assert.match(result.svg, /data-lifecycle-initial-marker/);
  assert.equal((result.svg.match(/style="fill: none" stroke-width="1"/g) || []).length, 2, 'done and archived are final');
});

test('an exit shared by consecutive phases leaves one composite frame', () => {
  const result = render(base({
    mainPath: ['queued', 'starting', 'running', 'success'],
    states: [state('queued', 'start'), state('starting'), state('running'), state('success', 'success'), state('cancelled', 'failure')],
    transitions: [
      { from: 'queued', to: 'starting' },
      { from: 'starting', to: 'running' },
      { from: 'running', to: 'success' },
      { from: 'starting', to: 'cancelled', label: 'cancel' },
      { from: 'running', to: 'cancelled', label: 'cancel' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.equal((result.svg.match(/data-lifecycle-frame=""/g) || []).length, 1);
  assert.deepEqual(points(result.svg, 'starting', 'cancelled'), points(result.svg, 'running', 'cancelled'));
  assert.equal((result.svg.match(/>cancel<\/text>/g) || []).length, 1, 'one label for the shared exit');
});

test('an exit shared by non-consecutive phases uses a declared bus that passes the corridor gate', () => {
  const result = render(base({
    mainPath: ['a', 'b', 'c'],
    states: [state('a', 'start'), state('b'), state('c', 'success'), state('void', 'failure')],
    transitions: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'a', to: 'void', label: 'abort' },
      { from: 'c', to: 'void', label: 'abort' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.svg, /data-composition-junction="a\+c"/);
  assert.equal(result.check.composition.metrics.ambiguousCorridors, 0);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.equal((result.svg.match(/>abort<\/text>/g) || []).length, 1, 'one label for the shared exit');
});

// Two waits and a failure on one lower row give transitions between neighbours
// something to spread across.
const neighbourCase = (extra) => base({
  mainPath: ['a', 'b', 'c'],
  states: [state('a', 'start'), state('b'), state('c', 'success'), state('w', 'waiting'), state('f', 'failure')],
  transitions: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'c' },
    { from: 'b', to: 'w' },
    { from: 'b', to: 'f' },
    ...extra,
  ],
});

test('parallel transitions between two neighbours each get their own lane', () => {
  const two = render(neighbourCase([
    { from: 'w', to: 'f', label: 'retry' },
    { from: 'w', to: 'f', label: 'fail' },
  ]));
  assert.equal(two.code, 0, two.stderr);
  assert.equal(two.check.ok, true, JSON.stringify(two.check.composition.issues));
  const ys = allPoints(two.svg, 'w', 'f').map((route) => route[0][1]);
  assert.equal(ys.length, 2);
  assert.equal(new Set(ys).size, 2, 'parallel strokes need distinct y values');

  const three = render(neighbourCase([
    { from: 'w', to: 'f', label: 'retry' },
    { from: 'w', to: 'f', label: 'fail' },
    { from: 'w', to: 'f', label: 'skip' },
  ]));
  assert.equal(three.code, 0, three.stderr);
  assert.equal(three.check.ok, true, JSON.stringify(three.check.composition.issues));
  const ys3 = allPoints(three.svg, 'w', 'f').map((route) => route[0][1]);
  assert.equal(new Set(ys3).size, 3, 'three parallel strokes need three distinct y values');
});

test('a reciprocal pair still lands just above and below the shared edge', () => {
  const result = render(neighbourCase([
    { from: 'w', to: 'f', label: 'fail' },
    { from: 'f', to: 'w', label: 'recover' },
  ]));
  assert.equal(result.code, 0, result.stderr);
  const cy = box(result.svg, 'w').y + box(result.svg, 'w').height / 2;
  assert.deepEqual(points(result.svg, 'w', 'f').map((point) => point[1]), [cy - 10, cy - 10]);
  assert.deepEqual(points(result.svg, 'f', 'w').map((point) => point[1]), [cy + 10, cy + 10]);
});

test('more than five parallel transitions between neighbours are a typed error', () => {
  const result = render(neighbourCase(Array.from({ length: 6 }, (_, index) => ({ from: 'w', to: 'f', label: `way ${index}` }))));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /\[lifecycle\/crowded-side-transitions\]/);
  assert.match(result.stderr, /merge the triggers into one transition label/);
});

test('exits to one target with different labels or variants stay separate connectors', () => {
  const result = render(base({
    mainPath: ['a', 'b', 'c', 'd'],
    states: [state('a', 'start'), state('b'), state('c'), state('d', 'success'), state('x', 'failure', 'Cancelled')],
    transitions: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
      { from: 'b', to: 'x', label: 'user cancels', variant: 'dashed' },
      { from: 'c', to: 'x', label: 'timeout', note: 'after 24h', variant: 'security' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.notDeepEqual(points(result.svg, 'b', 'x'), points(result.svg, 'c', 'x'), 'different semantics draw separate routes');
  assert.doesNotMatch(result.svg, /data-composition-junction/);
  assert.doesNotMatch(result.svg, /data-edge-label="[^"]* \/ [^"]*"/, 'no merged edge label');
  assert.doesNotMatch(result.svg, />user cancels \/ timeout</);
  assert.match(result.svg, />user cancels<\/text>/);
  assert.match(result.svg, />timeout<\/text>/);
  assert.match(result.svg, />after 24h<\/text>/);
});

test('the artifact checker flags identical overlapping lifecycle routes', () => {
  const result = render(neighbourCase([
    { from: 'w', to: 'f', label: 'retry' },
    { from: 'w', to: 'f', label: 'fail' },
  ]));
  assert.equal(result.code, 0, result.stderr);
  const groups = [...result.html.matchAll(/<g data-graph-role="automatic-crossover"[^>]*>\s*<path data-graph-role="automatic-crossover-underlay" d="[^"]*"[^>]*\/>\s*<path [^>]*data-edge-from="w" data-edge-to="f"[^>]*\/>/g)];
  assert.equal(groups.length, 2, 'two w -> f route groups');
  const d = groups[0][0].match(/<path [^>]*data-edge-from="w"[^>]*\bd="([^"]+)"/)[1];
  const routePoints = groups[0][0].match(/data-composition-points="([^"]+)"/)[1];
  const duplicated = groups[1][0]
    .replace(/\bd="[^"]*"/g, `d="${d}"`)
    .replace(/data-composition-points="[^"]*"/, `data-composition-points="${routePoints}"`);
  const file = path.join(tmp, 'overlapping-routes.html');
  fs.writeFileSync(file, result.html.replace(groups[1][0], duplicated));
  const checked = spawnSync('node', [path.join(skillRoot, 'scripts/check-render-output.mjs'), file], { encoding: 'utf8' });
  const receipt = JSON.parse(checked.stdout);
  assert.ok(receipt.composition.issues.some((issue) => issue.code === 'composition/ambiguous-corridor'),
    JSON.stringify(receipt.composition.issues));
});

test('note-only transitions keep their text', () => {
  const result = render(base({
    mainPath: ['a', 'b'],
    states: [state('a', 'start'), state('b', 'success')],
    transitions: [{ from: 'a', to: 'b', note: '审批 <通过> & "复核"' }],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.svg, /data-detail="fine"[^>]*>审批 &lt;通过&gt; &amp; &quot;复核&quot;<\/text>/);
});

test('structure errors are typed diagnostics with fixes', () => {
  const gap = render(base({
    mainPath: ['a', 'b'],
    states: [state('a', 'start'), state('b')],
    transitions: [{ from: 'b', to: 'a' }],
  }));
  assert.notEqual(gap.code, 0);
  assert.match(gap.stderr, /\[lifecycle\/main-path-gap\] mainPath step "a" -> "b" has no transition/);
  const wide = render(base({
    mainPath: Array.from({ length: 10 }, (_, index) => `s${index}`),
    states: Array.from({ length: 10 }, (_, index) => state(`s${index}`, index ? 'active' : 'start', `Phase number ${index}`)),
    transitions: Array.from({ length: 9 }, (_, index) => ({ from: `s${index}`, to: `s${index + 1}`, label: 'continue' })),
  }));
  assert.notEqual(wide.code, 0);
  assert.match(wide.stderr, /\[lifecycle\/too-wide\]/);
});

test('only states a reader should notice get a default corner sigil', () => {
  const types = ['start', 'active', 'waiting', 'decision', 'success', 'failure', 'neutral', 'external'];
  const states = types.map((type) => ({ ...state(type, type), step: '01' }));
  states.push({ ...state('flagged', 'active'), icon: 'flag' }, state('parked', 'neutral'));
  const result = render(base({
    mainPath: ['start', 'active', 'decision', 'success'],
    states,
    transitions: [
      { from: 'start', to: 'active' }, { from: 'active', to: 'decision' }, { from: 'decision', to: 'success' },
      { from: 'active', to: 'waiting' }, { from: 'decision', to: 'failure' }, { from: 'active', to: 'neutral' },
      { from: 'waiting', to: 'external' }, { from: 'start', to: 'flagged' },
      { from: 'decision', to: 'parked' }, { from: 'parked', to: 'decision' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  const group = (id) => result.svg.match(new RegExp(`data-node-id="${id}"[\\s\\S]*?<text data-node-label`))[0];
  const sigilOf = (id) => group(id).match(/data-semantic-sigil="([^"]+)"/)?.[1] ?? null;
  // A final ordinary state is an outcome and gets the stop sigil.
  assert.deepEqual(Object.fromEntries([...types, 'flagged', 'parked'].map((id) => [id, sigilOf(id)])), {
    start: null, active: null, waiting: 'waiting', decision: 'decision', success: 'success',
    failure: 'failure', neutral: 'stop', external: 'external', flagged: 'flag', parked: null,
  });
});

test('nodeLabelLayout reserves the source badge footprint on the right rail', () => {
  const rows = [{ text: 'Offline mode', font: 10, y: 21 }];
  const without = nodeLabelLayout({ width: 144, height: 64, rows });
  assert.deepEqual([without.x, without.ys[0]], [72, 21]);
  const withSource = nodeLabelLayout({ width: 144, height: 64, rows, source: true });
  const labelRight = withSource.x + (rows[0].text.length * 10 * 0.6) / 2;
  assert.ok(withSource.ys[0] > rows[0].y || labelRight <= 144 - 4 - SOURCE_BADGE_FOOTPRINT);
  const both = nodeLabelLayout({ width: 120, height: 64, rows, brand: true, source: true });
  assert.ok(both.ys[0] >= 19 + 2);
});
