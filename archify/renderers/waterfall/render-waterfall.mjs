import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusEdgeAttrs,
  focusNodeAttrs,
  focusNodeTitle,
  loadDiagram,
  svgAccessibleText,
  svgRootAttrs,
  writeDiagram,
} from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { legendFootprint, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { nodeTextFit } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: wf, template, outPath, sourceEvidence } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'waterfall',
  defaultExample: 'checkout-request.waterfall.json',
  argv: cliArgs,
});
const locale = wf.meta.locale;
const unit = wf.meta.unit || 'ms';
const ADVANCE = nodeTextFit.widthFactor;

const layout = {
  margin: 28,
  top: 46,
  axisH: 34,
  rowH: 28,
  barH: 14,
  indent: 16,
  nameFont: 11.5,
  durationFont: 10,
  axisWidth: wf.layout?.width ?? 760,
  columnGap: 20,
  minTickPx: 72,
};

// ---- Timing checks -------------------------------------------------------------
// Bars are drawn from recorded timing only. A span states `end` or `duration`
// (not both unless they agree); only `status: "incomplete"` may state neither,
// and it is drawn as an open bar up to the last recorded instant instead of
// with an invented end. Parents must exist and must not form a cycle.
const problems = [];
const details = [];
function fail(code, message, subject, evidence, supportedFixes) {
  problems.push(message);
  details.push({ code, severity: 'error', message, subject: { diagramType: 'waterfall', ...subject }, evidence, supportedFixes });
}
const raw = asArray(wf.spans);
const byId = new Map();
for (const [index, span] of raw.entries()) {
  if (byId.has(span.id)) fail('waterfall/duplicate-id', `Span id "${span.id}" is declared twice.`, { path: `/spans/${index}/id` }, { id: span.id }, ['Give every span a unique id.']);
  byId.set(span.id, span);
  const hasEnd = Number.isFinite(span.end);
  const hasDuration = Number.isFinite(span.duration);
  const timing = (message, fixes) => fail('waterfall/invalid-timing', `Span "${span.id}" ${message}`, { path: `/spans/${index}`, nodeId: span.id },
    { start: span.start, end: span.end ?? null, duration: span.duration ?? null, status: span.status ?? 'ok' }, fixes);
  if (hasEnd && span.end < span.start) timing(`ends (${span.end}) before it starts (${span.start}).`, ['Correct start or end from the recorded timing.']);
  if (hasEnd && hasDuration && Math.abs(span.end - span.start - span.duration) > 1e-9) {
    timing(`states end ${span.end} and duration ${span.duration}, which disagree with start ${span.start}.`, ['Keep only one of end or duration.']);
  }
  if (!hasEnd && !hasDuration && span.status !== 'incomplete') {
    timing('has neither end nor duration. A span without a recorded end must be marked status "incomplete".', ['Add the recorded end or duration.', 'Set status to "incomplete" if the trace has no end for it.']);
  }
}
for (const [index, span] of raw.entries()) {
  if (span.parent !== undefined && !byId.has(span.parent)) {
    fail('waterfall/missing-parent', `Span "${span.id}" names parent "${span.parent}", which is not declared.`,
      { path: `/spans/${index}/parent`, nodeId: span.id }, { parent: span.parent }, ['Declare the parent span.', 'Remove parent to make this a root span.']);
  }
}
{
  const reported = new Set();
  for (const [index, span] of raw.entries()) {
    const chain = [];
    let current = span;
    while (current && current.parent !== undefined && !chain.includes(current.id)) {
      chain.push(current.id);
      current = byId.get(current.parent);
    }
    if (current && chain.includes(current.id)) {
      const cycle = chain.slice(chain.indexOf(current.id));
      const key = [...cycle].sort().join('|');
      if (reported.has(key)) continue;
      reported.add(key);
      fail('waterfall/cycle', `Parent links form a cycle: ${[...cycle, cycle[0]].map((id) => `"${id}"`).join(' -> ')}.`,
        { path: `/spans/${index}/parent`, nodeId: span.id }, { cycle }, ['Point one span in the cycle at a parent outside it.']);
    }
  }
}
if (problems.length) throwDiagnosticProblems('Waterfall validation failed', problems, { code: 'waterfall/input', subject: { diagramType: 'waterfall' }, diagnostics: details });

// ---- Timing model --------------------------------------------------------------
const recordedEnd = (span) => (Number.isFinite(span.end) ? span.end : Number.isFinite(span.duration) ? span.start + span.duration : null);
const t0 = Math.min(...raw.map((span) => span.start));
const t1 = Math.max(...raw.map((span) => recordedEnd(span) ?? span.start));
const wall = t1 - t0;

const spans = raw.map((span, index) => {
  const end = recordedEnd(span);
  const open = end === null;
  // An incomplete span with no end is drawn to the last recorded instant of
  // the trace and labelled as a lower bound, never as a measured duration.
  return { ...span, index, status: span.status || 'ok', open, end: open ? t1 : end, duration: (open ? t1 : end) - span.start };
});
const children = new Map(spans.map((span) => [span.id, []]));
for (const span of spans) if (span.parent !== undefined) children.get(span.parent).push(span);
const byStart = (a, b) => a.start - b.start || a.index - b.index;
const rows = [];
(function visit(list, depth) {
  for (const span of [...list].sort(byStart)) {
    rows.push({ ...span, depth });
    visit(children.get(span.id), depth + 1);
  }
}(spans.filter((span) => span.parent === undefined), 0));

function number(value) {
  const rounded = Math.round(value * 100) / 100;
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
const formatDuration = (value) => `${number(value)} ${unit}`;
function percent(value) {
  if (!wall) return '100%';
  const share = (value / wall) * 100;
  return `${share >= 10 ? Math.round(share) : Math.round(share * 10) / 10}%`;
}

// ---- Geometry ------------------------------------------------------------------
const nameWidth = (row) => row.depth * layout.indent + 14 + textUnits(row.name) * layout.nameFont * ADVANCE * 1.04;
const labelW = Math.ceil(Math.max(140, ...rows.map(nameWidth)));
const axisX0 = layout.margin + labelW + layout.columnGap;
const axisX1 = axisX0 + layout.axisWidth;
const scale = wall > 0 ? layout.axisWidth / wall : 0;
const xOf = (t) => Math.round((axisX0 + (t - t0) * scale) * 100) / 100;
const rowsTop = layout.top + layout.axisH;

const NICE = [1, 2, 2.5, 5];
const tickStep = (() => {
  if (!wall) return 1;
  const target = (layout.minTickPx / layout.axisWidth) * wall;
  let magnitude = 10 ** Math.floor(Math.log10(target));
  for (;;) {
    for (const factor of NICE) if (factor * magnitude >= target) return factor * magnitude;
    magnitude *= 10;
  }
})();
const ticks = [];
for (let t = Math.ceil(t0 / tickStep) * tickStep; t <= t1 + 1e-9; t += tickStep) ticks.push({ t, x: xOf(t) });

const placed = rows.map((row, index) => {
  const y = rowsTop + index * layout.rowH;
  const x0 = xOf(row.start);
  const x1 = xOf(row.end);
  const width = Math.max(1.5, x1 - x0);
  const label = row.open ? i18nText(locale, 'waterfall.incomplete', { duration: formatDuration(row.duration) }) : formatDuration(row.duration);
  const labelWidth = textUnits(label) * layout.durationFont * ADVANCE + 6;
  // A duration that fits stays inside its bar; otherwise it sits beside the
  // bar on whichever side has room, so a short operation is never unlabeled.
  const placement = labelWidth + 10 <= width ? 'inside' : x1 + 6 + labelWidth <= axisX1 + 60 ? 'after' : 'before';
  return { ...row, y, x0, x1, width, label, labelWidth, placement };
});

// ---- Legend & canvas -----------------------------------------------------------
const STATUS_TONE = { ok: 'backend', error: 'security', cancelled: 'external', incomplete: 'messagebus' };
const presentStatuses = new Set(placed.map((row) => row.status));
const legendEntries = presentStatuses.size > 1 || !presentStatuses.has('ok')
  ? resolveLegend(undefined, Object.keys(STATUS_TONE).map((kind) => ({ kind, label: i18nText(locale, `legend.waterfall.${kind}`), interactive: false })), presentStatuses)
  : [];
const contentBottom = rowsTop + placed.length * layout.rowH + 8;
const width = Math.ceil(axisX1 + 60 + layout.margin);
const footprint = legendFootprint(legendEntries, { width: width - layout.margin * 2 });
const height = Math.ceil(contentBottom + layout.margin + (legendEntries.length ? 34 + footprint.extraHeight : 0));
const viewBox = [width, height];

// ---- Rendering -----------------------------------------------------------------
function renderHeader() {
  const evidence = i18nText(locale, `waterfall.evidence.${wf.meta.evidence}`);
  const evidenceW = Math.ceil(textUnits(evidence) * 10 * ADVANCE + 22);
  const tone = wf.meta.evidence === 'measured' ? 'backend' : 'messagebus';
  const total = `${i18nText(locale, 'waterfall.wall', { duration: formatDuration(wall) })} (${number(t0)} → ${number(t1)} ${unit})`;
  return `        <g data-waterfall-evidence="${esc(wf.meta.evidence)}">
          <rect x="${layout.margin}" y="12" width="${evidenceW}" height="20" rx="10" class="c-${tone}" stroke-width="1.2"/>
          <text x="${layout.margin + evidenceW / 2}" y="26" class="t-${tone}" font-size="10" font-weight="700" text-anchor="middle">${esc(evidence)}</text>
        </g>
        <text data-waterfall-total="${wall}" x="${layout.margin + evidenceW + 12}" y="26" class="t-primary" font-size="11" font-weight="650">${esc(total)}</text>`;
}

function renderAxis() {
  const lineY = rowsTop - 8;
  return [
    `        <text x="${layout.margin}" y="${lineY - 8}" class="t-muted" font-size="10" font-weight="650">${esc(i18nText(locale, 'waterfall.operation'))}</text>`,
    `        <line x1="${axisX0}" y1="${lineY}" x2="${axisX1}" y2="${lineY}" class="wf-axis" stroke-width="1.2"/>`,
    ...ticks.map((tick) => `        <line x1="${tick.x}" y1="${lineY}" x2="${tick.x}" y2="${contentBottom}" class="wf-grid" stroke-width="1"/>
        <text x="${tick.x}" y="${lineY - 8}" class="t-muted wf-num" font-size="10" text-anchor="middle">${esc(number(tick.t))} ${esc(unit)}</text>`),
  ].join('\n');
}

// Tree guides in the name column state the parent/child structure; the bars
// themselves only ever state time.
function renderGuides() {
  const rowIndex = new Map(placed.map((row, index) => [row.id, index]));
  return placed.filter((row) => row.parent !== undefined).map((row) => {
    const parentY = placed[rowIndex.get(row.parent)].y + layout.rowH / 2 + 7;
    const y = row.y + layout.rowH / 2;
    const x = layout.margin + (row.depth - 1) * layout.indent + 5;
    return `        <path ${focusEdgeAttrs(row.parent, row.id, undefined, row.index)} d="M ${x} ${parentY} V ${y} H ${x + layout.indent - 6}" class="wf-guide" stroke-width="1" fill="none"/>`;
  }).join('\n');
}

function renderRow(row, order) {
  const tone = STATUS_TONE[row.status];
  const parent = row.parent !== undefined ? placed.find((candidate) => candidate.id === row.parent) : null;
  const timing = `${number(row.start)}–${row.open ? '…' : number(row.end)} ${unit} · ${row.label} · ${i18nText(locale, 'waterfall.share', { percent: percent(row.duration), total: formatDuration(wall) })}`;
  const passport = { kind: tone, sublabel: [timing, row.detail].filter(Boolean).join(' — '), context: [row.service, parent?.name].filter(Boolean).join(' \u203a ') || undefined };
  const nameX = layout.margin + row.depth * layout.indent + (row.depth ? 12 : 0);
  const midY = row.y + layout.rowH / 2;
  const barY = midY - layout.barH / 2;
  const labelX = row.placement === 'inside' ? row.x0 + row.width / 2 : row.placement === 'after' ? row.x1 + 6 : row.x0 - 6;
  const anchor = row.placement === 'inside' ? 'middle' : row.placement === 'after' ? 'start' : 'end';
  const openTail = row.open ? `<path d="M ${row.x1 - 10} ${barY} L ${row.x1} ${midY} L ${row.x1 - 10} ${barY + layout.barH}" class="wf-open-edge" stroke-width="1.6" fill="none"/>` : '';
  return `        <g ${focusNodeAttrs(row.id, row.name, passport, locale)} data-waterfall-start="${row.start}" data-waterfall-end="${row.open ? '' : row.end}" data-waterfall-duration="${row.duration}" data-waterfall-depth="${row.depth}" data-waterfall-status="${row.status}">
          ${focusNodeTitle(row.name, passport)}
          <rect x="${layout.margin - 6}" y="${row.y + 1}" width="${axisX1 + 60 - layout.margin + 6}" height="${layout.rowH - 2}" rx="5" class="wf-row${order % 2 ? ' wf-row-alt' : ''}"/>
          <text data-node-label="" x="${nameX}" y="${midY + 4}" class="t-primary" font-size="${layout.nameFont}" font-weight="${row.depth ? 550 : 700}">${esc(row.name)}</text>
          <rect x="${row.x0}" y="${barY}" width="${row.width}" height="${layout.barH}" rx="3" class="c-${tone}${row.open ? ' wf-open' : ''}${row.parent === undefined ? ' wf-root' : ''}"${animateAttr(wf.meta, 'node', order)} stroke-width="1.3"/>
          ${openTail}
          <text x="${labelX}" y="${midY + 3.5}" class="t-primary wf-num" font-size="${layout.durationFont}" font-weight="650" text-anchor="${anchor}">${esc(row.label)}</text>
        </g>`;
}

function legendSwatch(entry) {
  return `<rect x="${entry.x}" y="${entry.baseline - 10}" width="14" height="10" rx="2" class="c-${STATUS_TONE[entry.kind]}${entry.kind === 'incomplete' ? ' wf-open' : ''}" stroke-width="1.2"/>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(wf.meta)} data-waterfall-ui="" data-waterfall-unit="${esc(unit)}" data-reader-fit="intrinsic-height" data-reader-min-text="7.5">
${svgAccessibleText(wf.meta, 'waterfall')}
${renderDefinitions()}
        <style>
          svg[data-waterfall-ui] .wf-axis { stroke: var(--text-muted); }
          svg[data-waterfall-ui] .wf-grid { stroke: var(--lane-stroke); stroke-dasharray: 3 5; opacity: .8; }
          svg[data-waterfall-ui] .wf-row { fill: transparent; }
          svg[data-waterfall-ui] .wf-row-alt { fill: var(--lane-fill); opacity: .45; }
          svg[data-waterfall-ui] .wf-guide { stroke: var(--lane-stroke); }
          svg[data-waterfall-ui] .wf-root { stroke-dasharray: 5 3; }
          svg[data-waterfall-ui] .wf-open { stroke-dasharray: 2 3; fill-opacity: .55; }
          svg[data-waterfall-ui] .wf-open-edge { stroke: var(--messagebus-stroke); }
          svg[data-waterfall-ui] .wf-num { font-variant-numeric: tabular-nums; }
        </style>

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

${renderHeader()}

        <!-- Time axis (bar position and length come only from recorded timing) -->
${renderAxis()}

        <!-- Parent / child guides -->
${renderGuides()}

        <!-- Spans, depth-first by start time -->
${placed.map(renderRow).join('\n')}

        <!-- Legend -->
${legendEntries.length ? renderResolvedLegend({ entries: legendEntries, locale, layout: { x: layout.margin, baselineY: height - 16, width: width - layout.margin * 2, fontSize: 10, minTitleY: contentBottom + 8, diagramType: 'waterfall' }, renderSwatch: legendSwatch }) : ''}
      </svg>`;
}

function buildLayoutReport() {
  return {
    diagram_type: 'waterfall',
    unit,
    viewBox,
    origin: t0,
    wall,
    pxPerUnit: scale,
    axis: { x0: axisX0, x1: axisX1 },
    ticks,
    rows: placed.map((row) => ({ id: row.id, parent: row.parent ?? null, depth: row.depth, start: row.start, end: row.end, open: row.open, x0: row.x0, x1: row.x1, y: row.y, label: row.label, placement: row.placement })),
  };
}

if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'waterfall',
  meta: wf.meta,
  svg: renderSvg(),
  cards: wf.cards,
  sourceEvidence,
});
