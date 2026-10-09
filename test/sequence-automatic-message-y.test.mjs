import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

// Fresh first drafts list messages in order without coordinates; requiring y
// failed every such draft at schema validation before any layout ran.
for (const quality of ['standard', 'showcase']) {
  test(`sequence ${quality} spaces messages that omit y in authored order`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-auto-y-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const input = path.join(dir, 'input.json');
    const output = path.join(dir, 'auto-y.html');
    const doc = {
      schema_version: 1, diagram_type: 'sequence',
      meta: { title: 'QR login', output: 'auto-y.html', quality_profile: quality },
      participants: [
        { id: 'app', type: 'frontend', label: 'Phone app' },
        { id: 'web', type: 'frontend', label: 'Browser' },
        { id: 'api', type: 'backend', label: 'Auth API' },
      ],
      messages: [
        { id: 'qr', from: 'web', to: 'api', label: 'request QR code' },
        { id: 'scan', from: 'app', to: 'api', label: 'scan and confirm', note: 'user taps approve' },
        { id: 'token', from: 'api', to: 'web', label: 'session token', variant: 'return' },
        { id: 'late', from: 'web', to: 'api', y: 400, label: 'load profile' },
        { id: 'after', from: 'api', to: 'web', label: 'profile', variant: 'return' },
      ],
    };
    const source = JSON.stringify(doc);
    fs.writeFileSync(input, source);
    const result = spawnSync(process.execPath, [cli, 'render', 'sequence', input, output, '--quality', quality], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.readFileSync(input, 'utf8'), source, 'automatic y must not rewrite authored input');
    const html = fs.readFileSync(output, 'utf8');
    const yOf = (id) => {
      const match = html.match(new RegExp(`data-composition-edge-id="${id}"[^>]*data-composition-points="[^,]+,([^;]+);`));
      assert.ok(match, `missing message ${id}`);
      return Number(match[1]);
    };
    assert.deepEqual(['qr', 'scan', 'token', 'late', 'after'].map(yOf), [160, 194, 252, 400, 434]);
  });
}
