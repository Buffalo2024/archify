import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.resolve(__dirname, '..', 'archify', 'renderers', 'sequence', 'render-sequence.mjs');
// An unedited first draft with two abutting segments (140-300, 300-520). On
// dev the first label climbed behind the participant headers and the second
// climbed into the first segment, where it named the wrong phase.
const fixture = path.join(__dirname, 'fixtures', 'sequence-first-draft', 'scan-to-pay.sequence.json');
const PARTICIPANT_BOTTOM = 72 + 60;

function render(diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-segments-'));
  const input = path.join(directory, 'candidate.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], { cwd: directory, encoding: 'utf8' });
  return { ...result, html: result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

const labels = (html) => [...html.matchAll(/data-segment-id="(\d+)">\s*<rect x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)]
  .map((match) => ({ index: +match[1], y: +match[3], height: +match[5] }));

test('abutting segment labels stay in their own phase and clear of the participant headers', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const placed = labels(result.html);
  assert.equal(placed.length, diagram.segments.length);
  for (const label of placed) {
    const own = diagram.segments[label.index];
    assert.ok(label.y >= PARTICIPANT_BOTTOM, `segment ${label.index} label is behind the participant headers`);
    for (const [index, other] of diagram.segments.entries()) {
      if (index === label.index) continue;
      const inside = Math.min(label.y + label.height, other.to) - Math.max(label.y, other.from);
      assert.ok(inside <= label.height / 2, `segment ${label.index} label sits in segment ${index}`);
    }
    assert.ok(label.y + label.height > own.from - 24 && label.y < own.to, `segment ${label.index} label is detached from its frame`);
  }
});

test('a label that fits above a spaced frame keeps its place above it', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  diagram.segments = [{ from: 330, to: 520, label: 'pay' }];
  for (const message of diagram.messages) message.y += message.y >= 300 ? 40 : 0;
  diagram.segments[0].from = 340;
  diagram.segments[0].to = 560;
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [label] = labels(result.html);
  assert.ok(label.y + label.height <= 340, `label at ${label.y} should stay above the frame`);
});
