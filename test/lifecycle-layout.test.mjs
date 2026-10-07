// Lifecycle v3: geometry follows from mainPath and transitions alone. These
// checks render small public inputs and inspect the artifact, so they hold the
// layout contract (rows, arcs, shared exits) rather than exact coordinates.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
      { from: 'c', to: 'void', label: 'revoke' },
    ],
  }));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.svg, /data-composition-junction="a\+c"/);
  assert.equal(result.check.composition.metrics.ambiguousCorridors, 0);
  assert.equal(result.check.ok, true, JSON.stringify(result.check.composition.issues));
  assert.match(result.svg, />abort \/ revoke<\/text>/);
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
