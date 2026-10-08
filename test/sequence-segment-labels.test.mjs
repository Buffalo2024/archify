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

// A three-phase upload whose middle phase is packed with messages: its title
// cannot sit on its own top border, and the next phase's title owns the strip
// above that phase's border.
const upload = path.join(__dirname, 'fixtures', 'sequence-first-draft', 'resumable-upload.sequence.json');

test('a title pushed inside its packed frame keeps clear of the next segment title', () => {
  const diagram = JSON.parse(fs.readFileSync(upload, 'utf8'));
  // The first draft's spacing, where the middle title used to land on "Finalize".
  const ys = { PATCH: 300, UploadPart: 320, HEAD: 332, Complete: 364, scan: 404, clean: 436, insert: 468, 204: 500 };
  for (const message of diagram.messages) {
    const key = Object.keys(ys).find((prefix) => message.label.startsWith(prefix));
    if (key) message.y = ys[key];
  }
  diagram.segments = [{ from: 140, to: 280, label: 'Create' }, { from: 286, to: 384, label: 'Transfer + resume' }, { from: 390, to: 540, label: 'Finalize' }];
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const placed = labels(result.html);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const overlap = Math.min(placed[i].y + placed[i].height, placed[j].y + placed[j].height) - Math.max(placed[i].y, placed[j].y);
      assert.ok(overlap <= 0, `segment titles ${placed[i].index} and ${placed[j].index} overlap by ${overlap}px`);
    }
  }
});

test('a segment edge running along a message arrow is reported with the move that clears it', () => {
  const diagram = JSON.parse(fs.readFileSync(upload, 'utf8'));
  diagram.segments[0].to = 298;
  diagram.segments[1].from = 302;
  const result = render(diagram);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /Segment "Create" bottom edge at y 298 runs along message "PATCH chunk 1\.\.n" \(arrow at y 300\) — move the edge to at least 304/);
});
