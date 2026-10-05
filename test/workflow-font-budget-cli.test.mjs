import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'archify/bin/archify.mjs');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/workflow-font-budget.json')));
function withScene(change, inspect) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-font-budget-'));
  try {
    const source = structuredClone(fixture);
    change(source);
    const input = path.join(tmp, 'candidate.json');
    fs.writeFileSync(input, JSON.stringify(source));
    const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: tmp, encoding: 'utf8' });
    const result = run(['validate', 'workflow', input, '--quality', 'showcase', '--json']);
    inspect({ source, input, result, receipt: JSON.parse(result.stdout), run, tmp });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
function issue(receipt) { return receipt.diagnostics?.find(d => d.code === 'composition/desktop-readability'); }

test('workflow budget: 170/171 fail, measured 172 preserves complete scene and passes', () => {
  for (const width of [168, 170, 171, 172]) {
    withScene(d => { d.nodes[1].width = width; }, ({ source, input, result, receipt }) => {
      assert.equal(result.status, width === 172 ? 0 : 1, result.stdout + result.stderr);
      assert.deepEqual(JSON.parse(fs.readFileSync(input)), source);
      const normalized = structuredClone(source);
      normalized.nodes[1].width = 168;
      assert.deepEqual(normalized, fixture, 'all semantic text, conditions, edges and mainPath preserved');
      if (width === 172) return;
      const budget = issue(receipt)?.evidence.nodeTextBudget;
      assert.ok(budget, result.stdout);
      assert.equal(budget.minimumWidthPx, 172);
      assert.equal(budget.targetSourceFontPx, 8);
      assert.equal(budget.widthPath, '/nodes/1/width');
      assert.equal(budget.verification, 'unverified');
      assert.equal(budget.conditionalMaximumViewBoxWidth, 1240);
      assert.match(issue(receipt).supportedFixes.join(' '), /rerun complete finalize/);
      assert.equal(issue(receipt).evidence.verifiedRepairs, undefined);
    });
  }
});

test('workflow budget: CJK and fractional authored widths use canonical fitting', () => {
  withScene(d => { d.nodes[1].sublabel = '条件'.repeat(8) + 'ok'; d.nodes[1].width = 171.2; }, ({ result, receipt }) => {
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(issue(receipt), undefined);
  });
  withScene(d => { d.nodes[1].sublabel = '条件'.repeat(8) + 'ok'; d.nodes[1].width = 170.9; }, ({ result, receipt }) => {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(issue(receipt).evidence.nodeTextBudget.minimumWidthPx, 172);
    assert.equal(issue(receipt).evidence.nodeTextBudget.textUnits, 34);
  });
});

test('workflow budget: preferred font cap prevents an impossible width suggestion', () => {
  withScene(d => { d.meta.viewBox = [2000, 300]; }, ({ result, receipt }) => {
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const budget = issue(receipt).evidence.nodeTextBudget;
    assert.equal(budget.status, 'preferred-font-insufficient');
    assert.equal(budget.minimumWidthPx, undefined);
    assert.match(issue(receipt).supportedFixes.join(' '), /width alone cannot/);
  });
});

test('workflow budget: ambiguous text roles and source-free standalone check do not invent node-width advice', () => {
  withScene(d => { d.nodes[1].tag = d.nodes[1].sublabel; d.nodes[1].height = 80; }, ({ receipt }) => {
    assert.ok(issue(receipt));
    assert.equal(issue(receipt).evidence.nodeTextBudget, undefined);
  });
  withScene(() => {}, ({ input, run, tmp }) => {
    const out = path.join(tmp, 'raw.html');
    // Raw renderer is used solely to inspect the unchanged failing artifact.
    const render = spawnSync(process.execPath, [path.join(root, 'archify/renderers/workflow/render-workflow.mjs'), input, out], { cwd: tmp, encoding: 'utf8' });
    assert.equal(render.status, 0, render.stdout + render.stderr);
    const checked = run(['check', out, '--json']);
    assert.equal(checked.status, 1);
    assert.doesNotMatch(checked.stdout, /nodeTextBudget|Conditional, unverified/);
  });
});

test('workflow budget: deliver preserves the prior artifact and reports the same contextual candidate as validate', () => {
  withScene(() => {}, ({ input, receipt, run, tmp }) => {
    const output = path.join(tmp, 'delivery.html');
    const previous = '<!doctype html><title>previous artifact</title>';
    fs.writeFileSync(output, previous);
    const delivered = run(['deliver', 'workflow', input, output, '--quality', 'showcase', '--json']);
    assert.equal(delivered.status, 1, delivered.stdout + delivered.stderr);
    const deliveryReceipt = JSON.parse(delivered.stdout);
    assert.equal(deliveryReceipt.stage, 'check');
    assert.deepEqual(issue(deliveryReceipt).evidence.nodeTextBudget, issue(receipt).evidence.nodeTextBudget);
    assert.deepEqual(issue(deliveryReceipt).supportedFixes, issue(receipt).supportedFixes);
    assert.equal(fs.readFileSync(output, 'utf8'), previous);
  });
});
