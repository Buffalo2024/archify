import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimumNodeTextWidth } from '../archify/renderers/shared/text-fit.mjs';

// Sequence message notes wrap inside one gap between neighbouring lifelines and
// keep every character (#676).
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const LONG_NOTE = 'this note explains the whole retry and backoff policy in a lot of detail so it is very long';
const URL_NOTE = 'see https://api.example.com/v2/users/profile/settings/notifications/email-preferences';

function sequence({ messages, participants = ['client', 'api', 'db'], quality = 'showcase', activations } = {}) {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Note wrap', output: 'note.html', quality_profile: quality, column_fit: 'spread' },
    participants: participants.map((id) => ({ id, type: 'backend', label: id.toUpperCase() })),
    messages,
    ...(activations ? { activations } : {}),
  };
}

function run(t, command, spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-sequence-note-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'candidate.json');
  const output = path.join(dir, 'note.html');
  fs.writeFileSync(input, JSON.stringify(spec));
  const args = command === 'render'
    ? [cli, 'render', 'sequence', input, output]
    : [cli, 'validate', 'sequence', input, '--json'];
  const result = spawnSync(process.execPath, args, { cwd: skillRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { result, html: command === 'render' && result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

function render(t, spec) {
  const { result, html } = run(t, 'render', spec);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return html;
}

function lifelines(html) {
  return [...html.matchAll(/<path d="M ([\d.]+) 142 L \1 [\d.]+" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"\/>/g)]
    .map((match) => Number(match[1]));
}

function notes(html) {
  return [...html.matchAll(/<text data-detail="fine" x="([\d.]+)" y="([\d.]+)" class="t-dim" font-size="7">([\s\S]*?)<\/text>/g)]
    .map((match) => {
      const tspans = [...match[3].matchAll(/<tspan x="([\d.]+)" dy="([\d.]+)">([^<]*)<\/tspan>/g)];
      return {
        x: Number(match[1]),
        y: Number(match[2]),
        raw: match[3],
        lines: tspans.length ? tspans.map((line) => line[3]) : [match[3]],
        tspanX: tspans.map((line) => Number(line[1])),
        dy: tspans.map((line) => Number(line[2])),
      };
    });
}

function decode(text) {
  return text.replaceAll('&amp;', '&');
}

test('the reported long note wraps inside its own lane and keeps every word', (t) => {
  const html = render(t, sequence({
    messages: [
      { id: 'request', from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { id: 'reply', from: 'api', to: 'client', y: 380, label: 'reply', variant: 'return' },
    ],
    activations: [{ participant: 'api', from: 190, to: 390 }],
  }));
  const [client, api] = lifelines(html);
  const [note] = notes(html);
  assert.ok(note.lines.length > 1, 'the long note wraps');
  assert.equal(note.lines.join(' '), LONG_NOTE, 'no word is dropped or shortened');
  assert.equal(note.x, client + 19, 'the first line keeps its original position');
  assert.deepEqual(note.dy, note.lines.map((_, index) => (index ? 11 : 0)));
  for (const line of note.lines) {
    assert.ok(note.x + minimumNodeTextWidth(line, 7) <= api - 11, `"${line}" stays clear of the API activation bar`);
  }
});

test('long unbroken text breaks after URL punctuation and keeps every character', (t) => {
  const html = render(t, sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue'],
    messages: [{ id: 'link', from: 'client', to: 'api', y: 200, label: 'docs', note: URL_NOTE }],
  }));
  const [client, api] = lifelines(html);
  const [note] = notes(html);
  assert.ok(note.lines.length > 2, 'the address spans several lines');
  assert.equal(note.lines[0], 'see');
  assert.equal(note.lines.slice(1).join(''), URL_NOTE.slice('see '.length), 'every character of the address is kept');
  for (const line of note.lines.slice(1, -1)) {
    assert.match(line, /[/.\-?&=#_]$/, `"${line}" breaks after punctuation`);
  }
  for (const line of note.lines) {
    assert.ok(client + 19 + minimumNodeTextWidth(line, 7) <= api - 11, `"${line}" fits its lane`);
  }
});

test('text without any punctuation breaks at a character boundary', (t) => {
  const token = 'x'.repeat(160);
  const html = render(t, sequence({ messages: [{ from: 'client', to: 'api', y: 200, label: 'token', note: token }] }));
  const [note] = notes(html);
  assert.ok(note.lines.length > 1);
  assert.equal(note.lines.join(''), token);
});

test('a short note keeps its original single-line markup', (t) => {
  const html = render(t, sequence({ messages: [{ from: 'api', to: 'client', y: 200, label: 'reply', note: 'cached for 5 minutes' }] }));
  const [client] = lifelines(html);
  assert.match(html, new RegExp(`<text data-detail="fine" x="${client + 19}" y="218" class="t-dim" font-size="7">cached for 5 minutes</text>`));
  assert.doesNotMatch(html, /<tspan/);
});

test('a note on a message that skips participants uses the gap beside the sender', (t) => {
  const forward = render(t, sequence({ messages: [{ from: 'client', to: 'db', y: 200, label: 'lookup', note: LONG_NOTE }] }));
  const [client, api, db] = lifelines(forward);
  const [forwardNote] = notes(forward);
  assert.equal(forwardNote.x, client + 19);
  for (const line of forwardNote.lines) assert.ok(forwardNote.x + minimumNodeTextWidth(line, 7) <= api - 11, 'clear of the skipped API lifeline');

  const backward = render(t, sequence({ messages: [{ from: 'db', to: 'client', y: 200, label: 'result', note: LONG_NOTE }] }));
  const [backwardNote] = notes(backward);
  assert.equal(backwardNote.x, api + 19, 'the gap between API and DB sits beside the sender');
  for (const line of backwardNote.lines) assert.ok(backwardNote.x + minimumNodeTextWidth(line, 7) <= db - 11);
});

test('a wrapped note that reaches the next message names the message and the y it needs', (t) => {
  const crowded = (replyY) => sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue'],
    messages: [
      { id: 'request', from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { id: 'reply', from: 'api', to: 'client', y: replyY, label: 'reply', variant: 'return' },
    ],
  });
  const failed = run(t, 'validate', crowded(230)).result;
  assert.notEqual(failed.status, 0);
  const receipt = JSON.parse(failed.stdout);
  const message = receipt.diagnostics.map((entry) => entry.message).join('\n');
  assert.match(message, /Note on message "request" wraps to \d+ lines/);
  const requiredY = Number(message.match(/move "reply" and later messages down so it sits at y=(\d+) or below/)?.[1]);
  assert.ok(requiredY > 230, message);

  const repaired = run(t, 'validate', crowded(requiredY)).result;
  assert.equal(repaired.status, 0, repaired.stdout);
  const html = render(t, crowded(requiredY));
  assert.equal(decode(notes(html)[0].lines.join(' ')), LONG_NOTE);
});

test('standard keeps accepting a crowded note', (t) => {
  const spec = sequence({
    quality: 'standard',
    messages: [
      { from: 'client', to: 'api', y: 200, label: 'request', note: LONG_NOTE },
      { from: 'api', to: 'client', y: 230, label: 'reply', variant: 'return' },
    ],
  });
  assert.equal(run(t, 'validate', spec).result.status, 0);
});

test('an automatic canvas grows to hold a wrapped note on the last message', (t) => {
  const html = render(t, sequence({
    participants: ['client', 'api', 'db', 'cache', 'queue'],
    messages: [{ from: 'client', to: 'api', y: 700, label: 'late', note: LONG_NOTE.repeat(2) }],
  }));
  const height = Number(html.match(/<svg viewBox="0 0 920 (\d+)"/)[1]);
  const [note] = notes(html);
  const lastBaseline = note.y + (note.lines.length - 1) * 11;
  const legendTitle = Number(html.match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>Legend<\/text>/)[1]);
  assert.ok(lastBaseline + 2 < legendTitle - 12, `last note line ${lastBaseline} stays above the legend title ${legendTitle}`);
  assert.ok(height > 760);
});
