#!/usr/bin/env node
// Usage: node collect.mjs <round-root> [--bench <dir>] [--round <name>] [--no-bench] [--dump]
//
// Reads Devin CLI session history for subagents whose task pointed at
// <round-root>/<type>, then reports per type: tool calls, finalize runs and
// failures, diagnostic codes, and the elements and relationships the final
// candidate dropped from the first draft. The first draft of each type is
// added to the benchmark (repository evidence stripped) unless --no-bench.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DIAGRAM_TYPES, benchmarkDocument, contentLost } from './diagram-shape.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const root = path.resolve(args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--')) || '');
if (!args.length || !fs.existsSync(root)) {
  console.error('Usage: node collect.mjs <round-root> [--bench <dir>] [--round <name>] [--no-bench] [--dump]');
  process.exit(2);
}
const round = option('--round', path.basename(root));
const bench = path.resolve(option('--bench', process.env.ARCHIFY_TUNING_BENCH
  || path.join(os.homedir(), '.local/share/archify-tuning/bench')));
const database = path.join(os.homedir(), '.local/share/devin/cli/sessions.db');
const db = new DatabaseSync(database, { readOnly: true });

const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value ?? ''));
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Task text may name the macOS /private alias or the plain /tmp path.
const roots = [...new Set([root, root.replace(/^\/private\//, '/'), root.replace(/^\/tmp\//, '/private/tmp/')])];
const CODE = /\b((?:layout|composition|clean-flow|workflow|sequence|dataflow|lifecycle|erd|class|tree|timeline|waterfall|architecture|repository-evidence|schema|viewer|delivery)\/[a-z0-9]+(?:-[a-z0-9]+)*)\b/g;

// Agents often pipe finalize through jq, so the exit code is not evidence.
function finalizeStatus(result) {
  if (/"ok":\s*false|"status":\s*"fail"|"(?:validate|deliver|check|browser-check)":\s*"fail"/.test(result)) return 'fail';
  if (/"ok":\s*true|"status":\s*"pass"/.test(result)
    || /"validate":\s*"pass"[^}]*"browser-check":\s*"pass"/.test(result)) return 'pass';
  const exit = result.match(/Exit code: (\d+)/);
  return exit ? (exit[1] === '0' ? 'unknown' : 'fail') : 'unknown';
}

function chainsByType() {
  const like = roots.map(() => 'chat_message like ?').join(' or ');
  const hits = db.prepare(`select session_id, min(node_id) as first from message_nodes where ${like} group by session_id`)
    .all(...roots.map((candidate) => `%${candidate}/%`));
  const best = new Map();
  for (const { session_id: session, first } of hits) {
    const rows = db.prepare('select node_id, parent_node_id, chat_message from message_nodes where session_id = ? and node_id >= ?').all(session, first);
    const nodes = new Map(rows.map((row) => [row.node_id, { ...row, message: JSON.parse(row.chat_message) }]));
    const parents = new Set(rows.map((row) => row.parent_node_id));
    for (const node of nodes.values()) {
      if (parents.has(node.node_id)) continue;
      const chain = [];
      for (let current = node; current; current = nodes.get(current.parent_node_id)) chain.unshift(current);
      for (const type of DIAGRAM_TYPES) {
        const pattern = new RegExp(`(?:${roots.map(escape).join('|')})/${type}(?![\\w-])`);
        const start = chain.findIndex(({ message }) => message.role === 'user' && typeof message.content === 'string' && pattern.test(message.content));
        if (start === -1) continue;
        const own = chain.slice(start);
        if (!best.has(type) || best.get(type).length < own.length) best.set(type, own);
      }
    }
  }
  return best;
}

function latestCandidate(type) {
  const folder = path.join(root, type, '.archify');
  if (!fs.existsSync(folder)) return null;
  const files = fs.readdirSync(folder)
    .map((entry) => path.join(folder, entry, 'candidate.json'))
    .filter((file) => fs.existsSync(file))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return files[0] ? JSON.parse(fs.readFileSync(files[0], 'utf8')) : null;
}

const summary = {};
const index = fs.existsSync(path.join(bench, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(bench, 'index.json'), 'utf8')) : {};
for (const [type, chain] of [...chainsByType()].sort(([a], [b]) => DIAGRAM_TYPES.indexOf(a) - DIAGRAM_TYPES.indexOf(b))) {
  const results = new Map();
  for (const { message } of chain) if (message.role === 'tool') results.set(message.tool_call_id, text(message.content));
  const stats = { tools: 0, reads: 0, docReads: [], finalize: [], firstDraft: null, dump: [] };
  for (const { message } of chain) {
    if (message.role === 'assistant' && message.content) stats.dump.push(`ASSISTANT: ${text(message.content).slice(0, 2000)}`);
    for (const call of message.tool_calls || []) {
      stats.tools += 1;
      const input = call.arguments || {};
      const result = results.get(call.id) || '';
      stats.dump.push(`CALL ${call.name}: ${text(input).slice(0, 3000)}\nRESULT: ${result.slice(0, 4000)}`);
      if (call.name === 'read') {
        stats.reads += 1;
        if (/\/archify\/.*\.md$/.test(input.file_path || '')) stats.docReads.push(input.file_path.replace(/^.*\/archify\//, ''));
      }
      if (call.name === 'write' && !stats.firstDraft && /candidate[^/]*\.json$/.test(input.file_path || '')) {
        try { stats.firstDraft = JSON.parse(input.content); } catch { /* not JSON yet */ }
      }
      if (call.name === 'exec' && new RegExp(`archify\\.mjs\\s+finalize\\s+${type}\\s+\\S+\\.json`).test(input.command || '')) {
        stats.finalize.push({ status: finalizeStatus(result), codes: [...new Set([...result.matchAll(CODE)].map((match) => match[1]))] });
      }
    }
  }
  const final = latestCandidate(type);
  const lost = contentLost(type, stats.firstDraft, final);
  summary[type] = {
    tools: stats.tools,
    reads: stats.reads,
    finalizeRuns: stats.finalize.length,
    finalizeFailures: stats.finalize.filter(({ status }) => status === 'fail').length,
    finalizeUnknown: stats.finalize.filter(({ status }) => status === 'unknown').length,
    firstFinalize: stats.finalize[0]?.status ?? 'not-run',
    codes: [...new Set(stats.finalize.flatMap(({ codes }) => codes))],
    lost,
    docReads: stats.docReads,
  };
  if (args.includes('--dump')) fs.writeFileSync(path.join(root, `${type}.trace.txt`), stats.dump.join('\n\n'));
  if (stats.firstDraft && !args.includes('--no-bench')) {
    fs.mkdirSync(path.join(bench, type), { recursive: true });
    fs.writeFileSync(path.join(bench, type, `${round}.json`), `${JSON.stringify(benchmarkDocument(stats.firstDraft, round), null, 2)}\n`);
    index[`${type}/${round}`] = {
      round: root,
      project: stats.firstDraft.meta?.repository?.url ?? null,
      revision: stats.firstDraft.meta?.repository?.revision ?? null,
      firstFinalize: summary[type].firstFinalize,
    };
  }
}
if (!args.includes('--no-bench') && Object.keys(index).length) {
  fs.mkdirSync(bench, { recursive: true });
  fs.writeFileSync(path.join(bench, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
fs.writeFileSync(path.join(root, 'tuning-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const pad = (value, width) => String(value).padEnd(width);
console.log(`${pad('type', 13)}${pad('tools', 7)}${pad('finalize', 10)}${pad('failed', 8)}${pad('first', 9)}lost (elements/relations)  codes`);
for (const [type, entry] of Object.entries(summary)) {
  const lost = entry.lost ? `${entry.lost.elements.length}/${entry.lost.relations.length}${entry.lost.elements.length ? ` ${entry.lost.elements.join(',')}` : ''}` : 'n/a';
  const failed = `${entry.finalizeFailures}${entry.finalizeUnknown ? `+${entry.finalizeUnknown}?` : ''}`;
  console.log(`${pad(type, 13)}${pad(entry.tools, 7)}${pad(entry.finalizeRuns, 10)}${pad(failed, 8)}${pad(entry.firstFinalize, 9)}${pad(lost, 27)}${entry.codes.join(',')}`);
}
const entries = Object.values(summary);
console.log(`TOTAL tools ${entries.reduce((sum, entry) => sum + entry.tools, 0)}, finalize ${entries.reduce((sum, entry) => sum + entry.finalizeRuns, 0)}, failed ${entries.reduce((sum, entry) => sum + entry.finalizeFailures, 0)}, first-run passes ${entries.filter((entry) => entry.firstFinalize === 'pass').length}/${entries.length}`);
if (!args.includes('--no-bench')) console.log(`benchmark: ${bench}`);
