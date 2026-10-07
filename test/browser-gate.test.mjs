import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const repoRoot = path.dirname(skillRoot);
const runner = path.join(repoRoot, 'scripts/run-browser-tests.mjs');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsConcurrency = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 19);
const supportsNamePattern = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 11);

test('browser gate rejects an unavailable explicit browser instead of skipping', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-browser-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const chrome of ['', path.join(directory, 'missing-chrome')]) {
    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: chrome },
    });
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.match(result.stderr, /require an executable Chrome\/Chromium/);
    assert.doesNotMatch(result.stdout, /# SKIP/);
  }
});

// Observe the public runner's child invocation without starting real browsers
// in the ordinary Node matrix. The explicit browser gate supplies real coverage.
function interceptedRun(t, outcome, args = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-browser-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const preload = path.join(directory, 'capture-runner.cjs');
  fs.writeFileSync(preload, `
const childProcess = require('node:child_process');
childProcess.spawnSync = (command, args, options) => {
  console.log(JSON.stringify({ command, args, cwd: options.cwd, chrome: options.env.ARCHIFY_CHROME }));
  return ${JSON.stringify(outcome)};
};
require('node:module').syncBuiltinESMExports();
`);
  return spawnSync(process.execPath, ['--require', preload, runner, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: process.execPath },
  });
}

test('browser gate includes dedicated and mixed browser suites and enables them', (t) => {
  const result = interceptedRun(t, { status: 0, signal: null });
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout);
  assert.equal(call.command, process.execPath);
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(repoRoot));
  assert.equal(call.chrome, process.execPath);
  assert.ok(call.args.includes('--test'));
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 18 || (major === 18 && minor >= 19)) {
    assert.ok(call.args.includes('--test-concurrency=2'));
  }
  const files = call.args.filter((arg) => !arg.startsWith('--'));
  assert.equal(new Set(files).size, files.length);
  for (const file of files) assert.ok(fs.existsSync(path.join(repoRoot, file)), file);
  const required = [
    ...fs.readdirSync(path.join(skillRoot, '..', 'test')).filter((file) => file.endsWith('-browser.test.mjs')),
    'sequence-header-clearance.test.mjs', 'repository-evidence.test.mjs', 'i18n.test.mjs', 'semantic-radar.test.mjs', 'viewer-chrome-layout.test.mjs',
  ];
  for (const file of required) assert.ok(files.includes(path.join('test', file)), `${file} must run in the browser gate`);
});

test('browser gate focuses maintained mixed suites and supports explicit concurrency', (t) => {
  const files = ['test/i18n.test.mjs', 'test/desktop-reader-browser.test.mjs'];
  const result = interceptedRun(t, { status: 0 }, [files[0], path.join(repoRoot, files[1]),
    ...(supportsConcurrency ? ['--concurrency=1'] : [])]);
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout);
  assert.deepEqual(call.args, ['--test', ...(supportsConcurrency ? ['--test-concurrency=1'] : []), ...files]);
  assert.match(result.stderr, supportsConcurrency ? /2 files, concurrency 1/ : /2 files, concurrency Node default/);
});

test('browser gate forwards a validated test name pattern', (t) => {
  const result = interceptedRun(t, { status: 0 }, ['test/i18n.test.mjs', '--test-name-pattern=locale.*日本語']);
  if (!supportsNamePattern) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /requires Node 18\.11 or newer/);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, [
    '--test', ...(supportsConcurrency ? ['--test-concurrency=2'] : []),
    '--test-name-pattern=locale.*日本語', 'test/i18n.test.mjs',
  ]);
});

test('browser gate rejects files outside its inventory and invalid options before launch', (t) => {
  for (const args of [['test/geometry.test.mjs'], ['--concurrency=0'], ['--unknown'],
    ['--test-name-pattern='], ['--test-name-pattern=[']]) {
    const result = interceptedRun(t, { status: 0 }, args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
  }
});

test('browser inventory can be listed without Chrome or child execution', (t) => {
  const result = spawnSync(process.execPath, [runner, '--list'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const invocation = JSON.parse(interceptedRun(t, { status: 0 }).stdout);
  assert.deepEqual(result.stdout.trim().split('\n'), invocation.args.filter(arg => !arg.startsWith('--')));
  assert.equal(result.stderr, '');
});

test('selected browser execution still requires Chrome', () => {
  const result = spawnSync(process.execPath, [runner, 'test/i18n.test.mjs'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /require an executable Chrome\/Chromium/);
});

for (const outcome of [{ status: 7, signal: null }, { status: null, signal: 'SIGTERM' }]) {
  test(`browser gate propagates child failure (${outcome.signal || outcome.status})`, (t) => {
    const result = interceptedRun(t, outcome);
    assert.equal(result.status, outcome.status ?? 1);
    if (outcome.signal) assert.match(result.stderr, /terminated by SIGTERM/);
  });
}

test('CI and release use the same browser command and retain WebM decoding', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['test:browser'], 'node scripts/run-browser-tests.mjs');
  for (const workflow of ['ci.yml', 'release.yml']) {
    const source = fs.readFileSync(path.join(repoRoot, '.github/workflows', workflow), 'utf8');
    const gate = source.match(/ {6}- name: Run shared browser regression gate\n([\s\S]*?)(?=\n {6}- name:|\n {2}[\w-]+:|$)/)?.[1];
    assert.ok(gate, `${workflow} must invoke the shared gate`);
    assert.match(gate, /run: npm run test:browser\n/);
    assert.doesNotMatch(gate, /working-directory:/);
    assert.match(gate, /ARCHIFY_CHROME: \$\{\{ steps\.setup-chrome\.outputs\.chrome-path \}\}/);
    assert.match(source, /run: npm run test:webm/);
    assert.doesNotMatch(source, /run: node --test[^\n]*test\/.*browser/);
  }
});


test('website CI uses the maintained browser script including community security coverage', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'website/package.json'), 'utf8'));
  const source = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const gate = source.match(/ {6}- name: Verify built website navigation and language continuity\n([\s\S]*?)(?=\n {6}- |\n {2}[\w-]+:|$)/)?.[1];
  assert.ok(gate, 'website must run its browser regression gate');
  assert.match(gate, /run: npm run test:browser\n/);
  assert.match(gate, /working-directory: website/);
  assert.match(gate, /ARCHIFY_SITE_INTEGRATION: '1'/);
  assert.match(manifest.scripts['test:browser'], /site-language-continuity\.test\.mjs/);
  assert.match(manifest.scripts['test:browser'], /community-browser\.test\.mjs/);
});
