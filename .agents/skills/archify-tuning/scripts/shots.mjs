#!/usr/bin/env node
// Usage: node shots.mjs [<replay-dir>] [--all] [--type <type>] [--height <px>]
//
// Screenshots base and head renders from a replay (the latest one by default)
// at a 1440px desktop width and writes shots/index.html, which shows each
// pair side by side. Without --all only FIXED, REGRESSED and changed entries
// are captured: those are the ones a reviewer must look at.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome } from '../../../../archify/bin/visual-check.mjs';
import { tuningHome } from './lib.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const replays = path.join(tuningHome(), 'replays');
const target = args[0] && !args[0].startsWith('--') ? path.resolve(args[0])
  : fs.existsSync(replays) ? path.join(replays, fs.readdirSync(replays).sort().at(-1) || '') : '';
const chrome = findChrome();
if (!target || !fs.existsSync(path.join(target, 'replay.json')) || !chrome) {
  console.error(chrome ? 'Usage: node shots.mjs [<replay-dir>] [--all] [--type <type>] [--height <px>]' : 'Chrome or Chromium is unavailable; set ARCHIFY_CHROME.');
  process.exit(2);
}
const height = Number(option('--height', 1100));
if (!Number.isInteger(height) || height < 1) { console.error('--height must be a positive integer'); process.exit(2); }
const { results } = JSON.parse(fs.readFileSync(path.join(target, 'replay.json'), 'utf8'));
const picked = results.filter((result) => (args.includes('--all') || result.note) && (!option('--type') || result.type === option('--type')));
const shots = path.join(target, 'shots');
fs.mkdirSync(shots, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-shots-'));
const staging = fs.mkdtempSync(path.join(shots, '.pending-'));

const captures = [];
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
function capture(side, result) {
  const html = path.join(target, side, result.type, `${result.name}.html`);
  const png = path.join(shots, `${result.type}-${result.name}-${side}.png`);
  // A failed retry must never display evidence left by an earlier invocation.
  fs.rmSync(png, { force: true });
  if (!fs.existsSync(html)) {
    const expected = result[side]?.ok === false;
    const entry = { type: result.type, name: result.name, side, status: expected ? 'not-rendered' : 'fail', reason: 'render-missing' };
    captures.push(entry);
    return entry;
  }
  const pending = path.join(staging, `${result.type}-${result.name}-${side}.png`);
  const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`,
    `--window-size=1440,${height}`, `--screenshot=${pending}`, pathToFileURL(html).href], { encoding: 'utf8', timeout: 60_000 });
  let reason = run.error?.message || (run.status !== 0 ? `Chrome exited ${run.status ?? run.signal}` : '');
  if (!reason) {
    const bytes = fs.existsSync(pending) ? fs.readFileSync(pending) : Buffer.alloc(0);
    const valid = bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
      && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND';
    if (!valid) reason = 'Chrome did not produce a PNG screenshot';
  }
  const entry = { type: result.type, name: result.name, side, status: reason ? 'fail' : 'pass',
    ...(reason ? { reason, exitCode: run.status, stderr: (run.stderr || '').slice(-2000) } : { file: path.basename(png) }) };
  if (!reason) fs.renameSync(pending, png);
  captures.push(entry);
  return entry;
}

let rows;
try {
  rows = picked.map((result) => {
    const [base, head] = [capture('base', result), capture('head', result)];
    const cell = (entry) => entry.status === 'pass' ? `<img src="${escape(entry.file)}" alt="${entry.side}">`
      : `<p>${entry.side}: ${escape(entry.status)} (${escape(entry.reason)})</p>`;
    return `<h2>${escape(result.type)}/${escape(result.name)} ${escape(result.note || '')}</h2><div class="pair">${cell(base)}${cell(head)}</div>`;
  });
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(staging, { recursive: true, force: true });
}
const failed = captures.filter((entry) => entry.status === 'fail');
const passed = captures.filter((entry) => entry.status === 'pass');
fs.writeFileSync(path.join(shots, 'capture.json'), `${JSON.stringify({ schemaVersion: 1, replay: path.join(target, 'replay.json'), viewport: { width: 1440, height }, captures }, null, 2)}\n`);
fs.writeFileSync(path.join(shots, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Replay shots</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;border:1px solid #333}</style>
<p>Left: base. Right: head. ${picked.length} entries, ${passed.length} screenshots captured, ${failed.length} capture failures, from ${escape(target)}</p>${rows.join('\n')}\n`);
console.log(`${picked.length} entries; ${passed.length} screenshots captured; ${failed.length} capture failures: ${path.join(shots, 'index.html')}`);
process.exitCode = failed.length ? 1 : 0;
