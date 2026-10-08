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
const { results } = JSON.parse(fs.readFileSync(path.join(target, 'replay.json'), 'utf8'));
const picked = results.filter((result) => (args.includes('--all') || result.note) && (!option('--type') || result.type === option('--type')));
const shots = path.join(target, 'shots');
fs.mkdirSync(shots, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-shots-'));

function capture(side, result) {
  const html = path.join(target, side, result.type, `${result.name}.html`);
  if (!fs.existsSync(html)) return null;
  const png = path.join(shots, `${result.type}-${result.name}-${side}.png`);
  spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${profile}`,
    `--window-size=1440,${height}`, `--screenshot=${png}`, pathToFileURL(html).href], { stdio: 'ignore', timeout: 60_000 });
  return fs.existsSync(png) ? path.basename(png) : null;
}

const rows = picked.map((result) => {
  const [base, head] = [capture('base', result), capture('head', result)];
  const cell = (file, side) => (file ? `<img src="${file}" alt="${side}">` : `<p>${side}: no render (${result[side].first || 'failed'})</p>`);
  return `<h2>${result.type}/${result.name} ${result.note || ''}</h2><div class="pair">${cell(base, 'base')}${cell(head, 'head')}</div>`;
});
fs.rmSync(profile, { recursive: true, force: true });
fs.writeFileSync(path.join(shots, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Replay shots</title>
<style>body{font:14px system-ui;margin:16px;background:#111;color:#ddd}.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;border:1px solid #333}</style>
<p>Left: base. Right: head. ${picked.length} entries from ${target}</p>${rows.join('\n')}\n`);
console.log(`${picked.length} pairs: ${path.join(shots, 'index.html')}`);
