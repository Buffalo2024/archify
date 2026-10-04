import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { textUnits } from '../renderers/shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers', 'class', 'render-class.mjs');
const checker = path.join(skillRoot, 'scripts', 'check-render-output.mjs');
const small = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'payments.class.json'), 'utf8'));
const large = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'payment-processors.class.json'), 'utf8'));

const clone = (value) => JSON.parse(JSON.stringify(value));

function render(diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-class-'));
  const input = path.join(directory, 'candidate.class.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], { cwd: directory, encoding: 'utf8' });
  const html = result.status === 0 ? fs.readFileSync(output, 'utf8') : '';
  return { ...result, output, html, svg: html.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0] ?? '' };
}

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function relationshipPaths(svg) {
  return [...svg.matchAll(/<path [^>]*data-class-relationship="[^"]+"[^>]*\/>/g)]
    .map((match) => attrs(match[0]))
    .filter((attributes) => attributes['data-edge-from']);
}

function typeBoxes(svg) {
  const boxes = new Map();
  for (const match of svg.matchAll(/data-node-id="([a-z_]+)"[\s\S]{0,600}?<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="6" class="c-[a-z]+ cl-type"/g)) {
    boxes.set(match[1], { x: +match[2], y: +match[3], width: +match[4], height: +match[5] });
  }
  return boxes;
}

for (const [name, diagram] of [['small', small], ['large', large]]) {
  test(`class: ${name} example renders and passes the showcase artifact checks`, () => {
    const result = render(diagram);
    assert.equal(result.status, 0, result.stderr);
    const check = spawnSync(process.execPath, [checker, result.output], { encoding: 'utf8' });
    const receipt = JSON.parse(check.stdout);
    assert.equal(receipt.ok, true, JSON.stringify(receipt.checks.filter((entry) => !entry.ok)));
    assert.equal(receipt.composition.summary.errors, 0);
    assert.equal(receipt.composition.summary.warnings, 0);
  });
}

test('class: each relationship kind draws its own line and marker', () => {
  const { svg, status, stderr } = render(large);
  assert.equal(status, 0, stderr);
  const byKind = {};
  for (const path of relationshipPaths(svg)) (byKind[path['data-class-relationship']] ||= []).push(path);
  const one = (kind) => byKind[kind][0];
  assert.match(one('dependency').class, /\bcl-dashed\b/);
  assert.equal(one('dependency')['marker-end'], 'url(#cl-open)');
  assert.doesNotMatch(one('association').class, /\bcl-dashed\b/);
  assert.equal(one('association')['marker-end'], 'url(#cl-open)');
  assert.equal(one('composition')['marker-start'], 'url(#cl-diamond-filled)');
  assert.equal(one('aggregation')['marker-start'], 'url(#cl-diamond-hollow)');
  // Realization is dashed with a triangle; inheritance is solid with a triangle.
  for (const path of byKind.realization) {
    assert.match(path.class, /\bcl-dashed\b/);
    assert.match(path['marker-end'] || path['marker-start'], /cl-triangle/);
  }
  for (const path of byKind.inheritance) {
    assert.doesNotMatch(path.class, /\bcl-dashed\b/);
    assert.match(path['marker-end'] || path['marker-start'], /cl-triangle/);
  }
});

test('class: implementations of one supertype share a hierarchy bus and a single triangle point', () => {
  const { svg } = render(small);
  const boxes = typeBoxes(svg);
  const gateway = boxes.get('payment_gateway');
  const realizations = relationshipPaths(svg).filter((path) => path['data-class-relationship'] === 'realization');
  assert.equal(realizations.length, 2);
  const tips = new Set(realizations.map((path) => path['data-composition-points'].split(';').at(-1)));
  assert.deepEqual([...tips], [`${gateway.x + gateway.width / 2},${gateway.y + gateway.height}`]);
  for (const path of realizations) {
    assert.equal(path['data-class-bus'], 'payment_gateway');
    // Drawn from the supertype so the shared dashed trunk keeps one phase.
    assert.match(path.d, new RegExp(`^M ${gateway.x + gateway.width / 2} ${gateway.y + gateway.height} `));
    assert.equal(path['marker-start'], 'url(#cl-triangle-start)');
  }
  assert.match(svg, /<marker id="cl-triangle-start"[^>]*orient="auto-start-reverse"/);
});

test('class: long members wrap inside the box instead of being truncated', () => {
  const { svg, status, stderr } = render(large);
  assert.equal(status, 0, stderr);
  const boxes = typeBoxes(svg);
  const processor = boxes.get('payment_processor');
  const block = svg.slice(svg.indexOf('data-node-id="payment_processor"'), svg.indexOf('data-node-id="order"'));
  const lines = [...block.matchAll(/<text data-detail="context" data-class-member="methods"[^>]* x="([\d.]+)"[^>]*>([^<]+)<\/text>/g)];
  assert.ok(lines.some((line) => /data-class-continuation/.test(line[0])), 'expected a wrapped continuation line');
  const joined = lines.map((line) => line[2]).join('').replace(/&gt;/g, '>').replace(/&lt;/g, '<');
  for (const method of large.types.find((type) => type.id === 'payment_processor').methods) {
    assert.ok(joined.replace(/\s+/g, '').includes(`${method.name}(${method.parameters}):${method.returns}`.replace(/\s+/g, '')), method.name);
  }
  for (const line of lines) {
    const right = Number(line[1]) + textUnits(line[2]) * 10.5 * 0.6;
    assert.ok(right <= processor.x + processor.width - 11, `"${line[2]}" overruns its box`);
  }
});

function failure(mutate) {
  const diagram = clone(small);
  mutate(diagram);
  const result = render(diagram);
  assert.notEqual(result.status, 0, 'renderer accepted an invalid diagram');
  return result.stderr;
}

test('class: realization must run from a non-interface to an interface', () => {
  const stderr = failure((d) => { d.relationships.find((r) => r.id === 'card_implements').to = 'order'; });
  assert.match(stderr, /class\/realization-target/);
});

test('class: inheritance across the interface boundary is rejected', () => {
  const stderr = failure((d) => { d.relationships.find((r) => r.id === 'card_implements').kind = 'inheritance'; });
  assert.match(stderr, /class\/inheritance-kind/);
});

test('class: an inheritance cycle is rejected', () => {
  const stderr = failure((d) => {
    d.relationships.push(
      { from: 'card_gateway', to: 'wallet_gateway', kind: 'inheritance' },
      { from: 'wallet_gateway', to: 'card_gateway', kind: 'inheritance', fromSide: 'top', toSide: 'top' },
    );
  });
  assert.match(stderr, /class\/inheritance-cycle/);
});

test('class: an interface cannot hold instance state', () => {
  const stderr = failure((d) => { d.types.find((t) => t.id === 'payment_gateway').attributes = [{ name: 'apiKey', type: 'String' }]; });
  assert.match(stderr, /class\/interface-state/);
});

test('class: an authored width too narrow for the title is reported, not clipped', () => {
  const stderr = failure((d) => { d.types.find((t) => t.id === 'payment_gateway').width = 120; });
  assert.match(stderr, /class\/title-text-capacity/);
});

test('class: unknown endpoints and self-relationships are rejected', () => {
  assert.match(failure((d) => { d.relationships[0].to = 'missing'; }), /unknown type "missing"/);
  assert.match(failure((d) => { d.relationships[0].to = d.relationships[0].from; }), /to itself/);
});
