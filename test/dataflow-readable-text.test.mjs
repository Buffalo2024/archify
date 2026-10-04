import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../archify');
function fixture(width = 1160) {
  return {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Public data pipeline', output: 'diagram.html', viewBox: [width, 720], quality_profile: 'showcase' },
    stages: Array.from({ length: 5 }, (_, i) => ({ label: `Stage ${i + 1}` })),
    nodes: Array.from({ length: 5 }, (_, i) => ({ id: `node_${i}`, type: 'backend', label: `Node ${i + 1}`, sublabel: 'context with all facts intact', stage: i, row: 2, width: i ? 180 : 152 })),
    flows: Array.from({ length: 4 }, (_, i) => ({ id: `flow_${i}`, from: `node_${i}`, to: `node_${i + 1}`, label: 'facts', route: 'straight', fromSide: 'right', toSide: 'left', labelAt: [207.5 + i * 215, 337] })),
  };
}
function validate(input, repoRoot) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-text-'));
  try {
    fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(input));
    const result = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'validate', 'dataflow', 'input.json', '--json', ...(repoRoot ? ['--repo-root', repoRoot] : [])], { cwd: directory, encoding: 'utf8' });
    const receipt = JSON.parse(result.stdout);
    const rendered = spawnSync(process.execPath, [path.join(root, 'renderers/dataflow/render-dataflow.mjs'), 'input.json', 'diagram.html'], { cwd: directory, encoding: 'utf8', env: { ...process.env, ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}) } });
    const html = rendered.status === 0 ? fs.readFileSync(path.join(directory, 'diagram.html'), 'utf8') : null;
    return { ...result, receipt, html };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
function contextFont(html, text) {
  const textTag = [...html.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].find((m) => m[2] === text);
  assert.ok(textTag, 'semantic text remains in the artifact');
  return Number(textTag[1].match(/font-size="([\d.]+)"/)[1]);
}
test('Dataflow public validate raises only unreadable implicit sublabels without moving pinned geometry', () => {
  const input = fixture();
  const result = validate(input);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.receipt.ok, true);
  assert.match(result.html, /viewBox="0 0 1160 720"/);
  assert.equal(contextFont(result.html, input.nodes[0].sublabel), 7.5);
  assert.ok(contextFont(result.html, input.nodes[0].sublabel) * 930 / 1160 >= 6);
  for (const flow of input.flows) assert.ok(result.html.includes(`x="${flow.labelAt[0]}" y="${flow.labelAt[1]}"`));
  assert.match(result.html, /x="24" y="356" width="152" height="58"/);
  assert.match(result.html, /data-reader-fit="authored-height"/);
});
test('Dataflow already-readable implicit sublabels retain their original font', () => {
  const input = fixture(1080);
  const result = validate(input);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(contextFont(result.html, input.nodes[0].sublabel), 7);
});
test('Dataflow cannot claim readable text when the larger font does not fit the authored box', () => {
  const input = fixture();
  input.nodes[0].sublabel = 'x'.repeat(34); // fits old 7px, cannot fit the 7.5px projection target
  const result = validate(input);
  assert.equal(result.status, 1);
  assert.equal(result.receipt.ok, false);
  assert.ok(result.receipt.diagnostics.some((d) => d.code === 'composition/desktop-readability'));
  assert.equal(contextFont(result.html, input.nodes[0].sublabel), 7);
  assert.match(result.html, /x="24" y="356" width="152" height="58"/);
});
test('Dataflow extremely long semantic sublabels remain rejected without truncation', () => {
  const input = fixture();
  input.nodes[0].sublabel = 'x'.repeat(200);
  const result = validate(input);
  assert.equal(result.status, 1);
  assert.equal(result.receipt.ok, false);
  assert.equal(result.html, null);
  assert.ok(result.receipt.diagnostics.some((d) => d.message.includes(input.nodes[0].sublabel)));
});


function shortFixture(height, tag = false) {
  return {
    schema_version: 1, diagram_type: 'dataflow',
    meta: { title: 'Anonymous transfer', viewBox: [1550, 720], quality_profile: 'showcase', output: 'diagram.html' },
    stages: [{ label: 'Input' }, { label: 'Output' }],
    nodes: [{ id: 'n', type: 'backend', label: 'Node', sublabel: 'gggg', stage: 0, row: 0, width: 152, height, ...(tag ? { tag: 'tag' } : {}) },
      { id: 'sink', type: 'database', label: 'Sink', stage: 1, row: 0 }],
    flows: [],
  };
}
for (const [height, tag] of [[39.2, false], [44, true]]) {
  test(`Dataflow rejects font growth that cannot fit vertical rows (height ${height}, tag ${tag})`, () => {
    const result = validate(shortFixture(height, tag));
    assert.equal(result.status, 1);
    assert.ok(result.receipt.diagnostics.some((d) => d.code === 'composition/desktop-readability'));
    assert.equal(contextFont(result.html, 'gggg'), 7);
    assert.ok(result.html.includes(`height="${height}"`));
  });
}
test('Dataflow permits font growth when a tagged node has room for every row', () => {
  const input = shortFixture(64, true);
  input.meta.viewBox[0] = 1500;
  const result = validate(input);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(contextFont(result.html, 'gggg'), 9.7);
});
test('Dataflow source and brand rails participate in the candidate vertical budget', () => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-anonymous-source-'));
  try {
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '--quiet');
    git('remote', 'add', 'origin', 'https://github.com/example/public-model');
    fs.writeFileSync(path.join(repository, 'model.js'), 'export const record = {};\n');
    git('add', 'model.js');
    git('-c', 'user.name=Anonymous Test', '-c', 'user.email=anonymous@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Anonymous source');
    const input = shortFixture(55, true);
    input.meta.repository = { url: 'https://github.com/example/public-model', revision: git('rev-parse', 'HEAD') };
    Object.assign(input.nodes[0], { label: 'Long primary label', stage: 1, width: 180, brand: 'github', sources: [{ path: 'model.js', line: 1, end_line: 1, label: 'Input' }] });
    input.nodes[1].stage = 0;
    const result = validate(input, repository);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.receipt.diagnostics.some((d) => d.code === 'composition/desktop-readability'));
    assert.equal(contextFont(result.html, 'gggg'), 7);
    assert.match(result.html, /data-brand-mark="github"/);
    assert.match(result.html, /model\.js/);
  } finally { fs.rmSync(repository, { recursive: true, force: true }); }
});


for (const [canvasWidth, height] of [[1160, 39.25], [1460, 39.85], [1520, 39.97]]) {
  test(`Dataflow exact fractional height ${height} retains the half-pixel inset before font growth`, () => {
    const input = shortFixture(height);
    input.meta.viewBox[0] = canvasWidth;
    const result = validate(input);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.receipt.diagnostics.some((d) => d.code === 'composition/desktop-readability'));
    assert.equal(contextFont(result.html, 'gggg'), 7);
    assert.ok(result.html.includes(`height="${height}"`));
    assert.ok(result.html.includes(`viewBox="0 0 ${canvasWidth} 720"`));
  });
}
