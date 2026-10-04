import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusNodeAttrs,
  focusNodeTitle,
  loadDiagram,
  svgAccessibleText,
  svgRootAttrs,
  writeDiagram,
} from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { legendFootprint, measureLegend, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { nodeTextFit } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray } from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: tl, template, outPath, sourceEvidence } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'timeline',
  defaultExample: 'payment-incident.timeline.json',
  argv: cliArgs,
});
const locale = tl.meta.locale;
const ADVANCE = nodeTextFit.widthFactor;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const layout = {
  margin: 28,
  top: 46,
  axisH: 44,
  laneLabelW: asArray(tl.lanes).length ? 112 : 0,
  axisWidth: tl.layout?.width ?? 960,
  edgePad: 64,
  breakW: 56,
  laneGap: 10,
  lanePadTop: 22,
  rowGap: 10,
  cardMaxW: 190,
  cardPadX: 9,
  titleFont: 11.5,
  titleLine: 14,
  timeFont: 10,
  minTickPx: 76,
};

// ---- Input checks --------------------------------------------------------------
// Time is the one fact this diagram draws, so every timestamp must parse and
// state its own offset (the schema requires Z or ±HH:MM); the display zone must
// be a real IANA zone, and every event must sit in a declared lane.
const timezone = tl.meta.timezone || 'UTC';
{
  const problems = [];
  const details = [];
  const fail = (code, message, subject, evidence, supportedFixes) => {
    problems.push(message);
    details.push({ code, severity: 'error', message, subject: { diagramType: 'timeline', ...subject }, evidence, supportedFixes });
  };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    fail('timeline/invalid-timezone', `meta.timezone "${timezone}" is not a recognised IANA time zone.`,
      { path: '/meta/timezone' }, { timezone }, ['Use an IANA zone such as "UTC", "Europe/Berlin", or "Asia/Shanghai".']);
  }
  const laneIds = new Set(asArray(tl.lanes).map((lane) => lane.id));
  const seen = new Set();
  for (const [index, event] of asArray(tl.events).entries()) {
    if (seen.has(event.id)) fail('timeline/duplicate-id', `Event id "${event.id}" is declared twice.`, { path: `/events/${index}/id` }, { id: event.id }, ['Give every event a unique id.']);
    seen.add(event.id);
    if (!Number.isFinite(Date.parse(event.at))) {
      fail('timeline/invalid-timestamp', `Event "${event.id}" timestamp "${event.at}" is not a valid date and time.`,
        { path: `/events/${index}/at`, nodeId: event.id }, { at: event.at }, ['Use ISO 8601 with an explicit offset, e.g. "2026-10-01T10:05:00+08:00".']);
    }
    if (laneIds.size && !laneIds.has(event.lane)) {
      fail('timeline/unknown-lane', event.lane === undefined
        ? `Event "${event.id}" has no lane, but the timeline declares lanes.`
        : `Event "${event.id}" names lane "${event.lane}", which is not declared.`,
      { path: `/events/${index}/lane`, nodeId: event.id }, { lane: event.lane ?? null, lanes: [...laneIds] },
      ['Set lane to one of the declared lane ids.', 'Declare the missing lane.']);
    }
  }
  if (problems.length) throwDiagnosticProblems('Timeline validation failed', problems, { code: 'timeline/input', subject: { diagramType: 'timeline' }, diagnostics: details });
}

// ---- Time zone formatting ------------------------------------------------------
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function wall(ms) {
  const parts = Object.fromEntries(partsFormat.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return { y: parts.year, mo: parts.month, d: parts.day, h: parts.hour, mi: parts.minute, s: parts.second };
}
// Offset of the display zone at an instant, in ms (local wall clock - UTC).
function zoneOffset(ms) {
  const w = wall(ms);
  return Date.UTC(+w.y, +w.mo - 1, +w.d, +w.h, +w.mi, +w.s) - Math.floor(ms / 1000) * 1000;
}
function offsetLabel(ms) {
  const minutes = Math.round(zoneOffset(ms) / MINUTE);
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// ---- Events in time order -------------------------------------------------------
const events = asArray(tl.events)
  .map((event, index) => ({ ...event, index, t: Date.parse(event.at) }))
  .sort((a, b) => a.t - b.t || a.index - b.index);
const times = [...new Set(events.map((event) => event.t))];
const first = times[0];
const last = times.at(-1);
const span = last - first;

const showSeconds = events.some((event) => new Date(event.t).getUTCSeconds() !== 0 || new Date(event.t).getUTCMilliseconds() !== 0);
const multiDay = (() => {
  const a = wall(first);
  const b = wall(last);
  return a.y !== b.y || a.mo !== b.mo || a.d !== b.d;
})();
function clockLabel(ms, { seconds = showSeconds, date = multiDay } = {}) {
  const w = wall(ms);
  return `${date ? `${w.mo}-${w.d} ` : ''}${w.h}:${w.mi}${seconds ? `:${w.s}` : ''}`;
}

function durationLabel(ms) {
  const units = [['d', DAY], ['h', HOUR], ['min', MINUTE], ['s', 1000]];
  const parts = [];
  let rest = ms;
  for (const [unit, size] of units) {
    const value = Math.floor(rest / size);
    if (value) parts.push(`${value} ${unit}`);
    rest -= value * size;
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0 s';
}

// ---- Axis segments and disclosed breaks ----------------------------------------
// A quiet period much longer than the timeline's ordinary rhythm would squeeze
// every other event into a sliver. With `layout.breaks: "auto"` (the default)
// such a gap is drawn as a fixed-width break that states the omitted duration,
// so the axis stays proportional inside each segment and never hides that it
// was compressed. A gap is a break when it is longer than eight times the
// median gap and longer than a tenth of the whole span; at most eight are
// drawn (the longest), so bursts of activity get readable room.
const gaps = times.slice(1).map((time, index) => ({ from: times[index], to: time, length: time - times[index] }));
const sortedGaps = gaps.map((gap) => gap.length).sort((a, b) => a - b);
const medianGap = sortedGaps.length ? sortedGaps[Math.floor((sortedGaps.length - 1) / 2)] : 0;
const breaks = tl.layout?.breaks === 'none' ? [] : gaps
  .filter((gap) => gap.length > 8 * medianGap && gap.length > 0.1 * span)
  .sort((a, b) => b.length - a.length)
  .slice(0, 8)
  .sort((a, b) => a.from - b.from);

const segments = [];
{
  let start = first;
  for (const gap of breaks) {
    segments.push({ start, end: gap.from });
    start = gap.to;
  }
  segments.push({ start, end: last });
}
const linearTime = segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0);
const axisX0 = layout.margin + layout.laneLabelW;
// A break is as wide as its duration label; every segment gets a small floor
// width so a lone event between two breaks never shares their x, and the rest
// of the axis is shared in proportion to time. Inside a segment the scale is
// one constant, so distances there are exact.
const SEGMENT_FLOOR = 28;
for (const gap of breaks) {
  gap.label = `≈ ${durationLabel(gap.length)}`;
  gap.width = Math.max(layout.breakW, Math.ceil(textUnits(gap.label) * 9.5 * ADVANCE + 16));
}
const drawable = layout.axisWidth - layout.edgePad * 2
  - breaks.reduce((sum, gap) => sum + gap.width, 0) - SEGMENT_FLOOR * segments.length;
const scale = linearTime > 0 ? Math.max(0, drawable) / linearTime : 0;
{
  let x = axisX0 + layout.edgePad;
  const share = linearTime > 0 ? 0 : Math.max(0, drawable) / segments.length;
  for (const [index, segment] of segments.entries()) {
    const inner = (segment.end - segment.start) * scale + share;
    segment.x0 = x + SEGMENT_FLOOR / 2 + (segment.end === segment.start ? inner / 2 : 0);
    segment.x1 = segment.end === segment.start ? segment.x0 : segment.x0 + inner;
    x += SEGMENT_FLOOR + inner;
    if (index < breaks.length) {
      breaks[index].x0 = x;
      breaks[index].x1 = x + breaks[index].width;
      x += breaks[index].width;
    }
  }
}
const axisX1 = axisX0 + layout.axisWidth;

function xOf(time) {
  const segment = segments.find((candidate) => time >= candidate.start && time <= candidate.end) ?? segments[0];
  return Math.round((segment.x0 + (time - segment.start) * scale) * 100) / 100;
}

// Ticks fall on the display zone's wall clock, so a +05:30 zone still ticks
// on its own whole hours.
const TICKS = [1000, 2000, 5000, 10_000, 15_000, 30_000, MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE,
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];
const ticks = [];
for (const segment of segments) {
  const length = segment.end - segment.start;
  if (length <= 0 || scale <= 0) {
    ticks.push({ t: segment.start, x: segment.x0 });
    continue;
  }
  const interval = TICKS.find((candidate) => candidate * scale >= layout.minTickPx) ?? TICKS.at(-1);
  const offset = zoneOffset(segment.start);
  let t = Math.ceil((segment.start + offset) / interval) * interval - offset;
  const before = ticks.length;
  for (; t <= segment.end; t += interval) ticks.push({ t, x: xOf(t), interval });
  // A segment too short for a regular tick still states where it starts.
  if (ticks.length === before) ticks.push({ t: segment.start, x: segment.x0, interval });
}
const tickSeconds = ticks.some((tick) => tick.interval < MINUTE);

// ---- Lanes and event cards ------------------------------------------------------
const lanes = asArray(tl.lanes).length ? tl.lanes : [{ id: '__all', label: '' }];
const laneOf = (event) => (asArray(tl.lanes).length ? event.lane : '__all');

function wrapTitle(text, maxWidth) {
  const limit = Math.max(6, Math.floor(maxWidth / (layout.titleFont * ADVANCE * 1.05)));
  const words = String(text).split(/(\s+)/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (textUnits((current + word).trim()) <= limit) { current += word; continue; }
    if (current.trim()) lines.push(current.trim());
    current = word.trimStart();
    while (textUnits(current) > limit) {
      const chars = Array.from(current);
      let cut = 0;
      for (let units = 0; cut < chars.length && units + textUnits(chars[cut]) <= limit; cut += 1) units += textUnits(chars[cut]);
      lines.push(chars.slice(0, Math.max(1, cut)).join(''));
      current = chars.slice(Math.max(1, cut)).join('');
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

const cards = events.map((event) => {
  const time = clockLabel(event.t);
  const natural = Math.max(textUnits(event.title) * layout.titleFont * ADVANCE * 1.05, textUnits(time) * layout.timeFont * ADVANCE);
  const width = Math.ceil(Math.min(layout.cardMaxW, natural + layout.cardPadX * 2));
  const lines = wrapTitle(event.title, width - layout.cardPadX * 2);
  const height = 8 + 12 + lines.length * layout.titleLine + 6;
  const x = xOf(event.t);
  // The card is centred on its instant but never leaves the axis area.
  const left = Math.min(Math.max(x - width / 2, axisX0 + 4), axisX1 - width - 4);
  return { ...event, time, width, height, lines, x, left };
});

// Within a lane, cards pack into rows: a card takes the first row where it
// does not touch the previous card, so simultaneous and close events stack
// instead of overprinting. The dot stays on the lane's time line.
const laneLayout = [];
{
  let y = layout.top + layout.axisH;
  for (const lane of lanes) {
    const members = cards.filter((card) => laneOf(card) === lane.id);
    const rowEnds = [];
    const rowHeights = [];
    for (const card of members) {
      let row = rowEnds.findIndex((end) => card.left >= end + 8);
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = card.left + card.width;
      rowHeights[row] = Math.max(rowHeights[row] || 0, card.height);
      card.row = row;
    }
    const lineY = y + layout.lanePadTop;
    const rowTop = [];
    rowHeights.reduce((top, height, row) => { rowTop[row] = top; return top + height + layout.rowGap; }, lineY + 14);
    for (const card of members) {
      card.lineY = lineY;
      card.top = rowTop[card.row];
    }
    const height = Math.max(64, (rowTop.length ? rowTop.at(-1) + rowHeights.at(-1) : lineY + 20) - y + 12);
    laneLayout.push({ ...lane, y, height, lineY });
    y += height + layout.laneGap;
  }
}

// ---- Legend ---------------------------------------------------------------------
const KIND_TONE = { default: 'external', change: 'frontend', alert: 'security', action: 'messagebus', recovery: 'backend' };
const kindOf = (event) => event.kind || 'default';
const legendEntries = resolveLegend(undefined,
  Object.keys(KIND_TONE).map((kind) => ({ kind, label: i18nText(locale, `legend.timeline.${kind}`), interactive: false })),
  new Set(events.map(kindOf)))
  .filter((entry, _, all) => all.length > 1);

const contentBottom = laneLayout.at(-1).y + laneLayout.at(-1).height;
const width = Math.ceil(axisX1 + layout.margin);
const footprint = legendFootprint(legendEntries, { width: width - layout.margin * 2 });
const height = Math.ceil(contentBottom + layout.margin + (legendEntries.length ? 34 + footprint.extraHeight : 0));
const viewBox = [width, height];

function legendLayout() {
  return { x: layout.margin, baselineY: height - 16, width: width - layout.margin * 2, fontSize: 10, minTitleY: contentBottom + 8, diagramType: 'timeline' };
}

// ---- Rendering ------------------------------------------------------------------
function renderAxis() {
  const top = layout.top;
  const bottom = contentBottom;
  const lineY = top + layout.axisH - 10;
  // Tick labels never overprint each other or a break's duration label.
  const taken = breaks.map((gap) => [gap.x0 - 4, gap.x1 + 4]);
  const shown = ticks.filter((tick) => {
    const half = textUnits(clockLabel(tick.t, { seconds: tickSeconds })) * 10 * ADVANCE / 2 + 4;
    const box = [tick.x - half, tick.x + half];
    if (taken.some(([a, b]) => box[0] < b && a < box[1])) return false;
    taken.push(box);
    return true;
  });
  const grid = shown.map((tick) => `          <line x1="${tick.x}" y1="${lineY}" x2="${tick.x}" y2="${bottom}" class="tl-grid" stroke-width="1"/>
          <text x="${tick.x}" y="${lineY - 8}" class="t-muted tl-tick" font-size="10" text-anchor="middle">${esc(clockLabel(tick.t, { seconds: tickSeconds }))}</text>`).join('\n');
  const segmentLines = segments.map((segment, index) => {
    const from = index ? breaks[index - 1].x1 : axisX0 + 8;
    const to = index < breaks.length ? breaks[index].x0 : axisX1 - 8;
    return `          <line x1="${from}" y1="${lineY}" x2="${to}" y2="${lineY}" class="tl-axis" stroke-width="1.5"/>`;
  }).join('\n');
  const breakMarks = breaks.map((gap) => {
    const mid = (gap.x0 + gap.x1) / 2;
    const zig = (x) => `M ${x - 3} ${lineY - 7} L ${x + 3} ${lineY - 2} L ${x - 3} ${lineY + 2} L ${x + 3} ${lineY + 7}`;
    const omitted = i18nText(locale, 'timeline.break', { duration: durationLabel(gap.length) });
    return `          <g data-timeline-break="" data-break-ms="${gap.length}" aria-label="${esc(omitted)}" role="img">
            <rect x="${gap.x0 + 6}" y="${lineY}" width="${gap.width - 12}" height="${bottom - lineY}" class="tl-break-band"/>
            <path d="${zig(gap.x0 + 8)} ${zig(gap.x1 - 8)}" class="tl-break-zig" stroke-width="1.4" fill="none"/>
            <text x="${mid}" y="${lineY - 8}" class="t-primary" font-size="9.5" font-weight="700" text-anchor="middle">${esc(gap.label)}</text>
          </g>`;
  }).join('\n');
  return `${grid}\n${segmentLines}\n${breakMarks}`;
}

function renderHeader() {
  const evidence = i18nText(locale, `timeline.evidence.${tl.meta.evidence}`);
  const evidenceW = Math.ceil(textUnits(evidence) * 10 * ADVANCE + 22);
  const date = multiDay ? '' : ` · ${wall(first).y}-${wall(first).mo}-${wall(first).d}`;
  const zone = `${timezone === 'UTC' ? 'UTC' : `${timezone} (${offsetLabel(first)})`}${date}`;
  const disclosure = breaks.length ? ` · ${i18nText(locale, 'timeline.compressed', { count: breaks.length })}` : '';
  const caption = `${i18nText(locale, 'timeline.axis')}: ${zone}${disclosure}`;
  const tone = tl.meta.evidence === 'observed' ? 'backend' : 'messagebus';
  return `        <g data-timeline-evidence="${esc(tl.meta.evidence)}">
          <rect x="${layout.margin}" y="12" width="${evidenceW}" height="20" rx="10" class="c-${tone}" stroke-width="1.2"/>
          <text x="${layout.margin + evidenceW / 2}" y="26" class="t-${tone}" font-size="10" font-weight="700" text-anchor="middle">${esc(evidence)}</text>
        </g>
        <text data-timeline-axis-caption="" x="${layout.margin + evidenceW + 12}" y="26" class="t-muted" font-size="10.5">${esc(caption)}</text>`;
}

function renderLanes() {
  return laneLayout.map((lane, index) => `        <g data-timeline-lane="${esc(lane.id)}">
          <rect x="${axisX0}" y="${lane.y}" width="${layout.axisWidth}" height="${lane.height}" rx="8" class="tl-lane${index % 2 ? ' tl-lane-alt' : ''}"/>
          <line x1="${axisX0 + 8}" y1="${lane.lineY}" x2="${axisX1 - 8}" y2="${lane.lineY}" class="tl-lane-line" stroke-width="1"/>
          ${lane.label ? `<text x="${layout.margin}" y="${lane.lineY + 4}" class="t-primary" font-size="12" font-weight="700">${esc(lane.label)}</text>` : ''}
        </g>`).join('\n');
}

function renderEvent(card, order) {
  const tone = KIND_TONE[kindOf(card)];
  const lane = laneLayout.find((entry) => entry.id === laneOf(card));
  // The Node index groups by the context before " › ", so the lane leads.
  const context = [lane?.label, `${clockLabel(card.t, { seconds: true, date: true })} ${offsetLabel(card.t)}`].filter(Boolean).join(' \u203a ');
  const passport = { kind: tone, sublabel: card.detail, context };
  let y = card.top + 8 + 10;
  const time = `<text x="${card.left + layout.cardPadX}" y="${y}" class="t-muted tl-time" font-size="${layout.timeFont}" font-weight="600">${esc(card.time)}</text>`;
  const title = card.lines.map((line) => {
    y += layout.titleLine;
    return `<tspan x="${card.left + layout.cardPadX}" y="${y}">${esc(line)}</tspan>`;
  }).join('');
  return `        <g ${focusNodeAttrs(card.id, card.title, passport, locale)} data-timeline-at="${esc(card.at)}" data-timeline-ms="${card.t}" data-timeline-x="${card.x}">
          ${focusNodeTitle(card.title, passport)}
          <rect x="${card.left}" y="${card.top}" width="${card.width}" height="${card.height}" rx="6" class="c-mask"/>
          <rect x="${card.left}" y="${card.top}" width="${card.width}" height="${card.height}" rx="6" class="c-${tone}"${animateAttr(tl.meta, 'node', order)} stroke-width="1.3"/>
          ${time}
          <text data-node-label="" class="t-primary" font-size="${layout.titleFont}" font-weight="650">${title}</text>
          <circle cx="${card.x}" cy="${card.lineY}" r="5.5" class="c-${tone} tl-dot" stroke-width="2"/>
        </g>`;
}

function legendSwatch(entry) {
  return `<circle cx="${entry.x + 6}" cy="${entry.baseline - 4}" r="5" class="c-${KIND_TONE[entry.kind]}" stroke-width="2"/>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(tl.meta)} data-timeline-ui="" data-reader-fit="intrinsic-height" data-reader-min-text="7.5">
${svgAccessibleText(tl.meta, 'timeline')}
${renderDefinitions()}
        <style>
          svg[data-timeline-ui] .tl-grid { stroke: var(--lane-stroke); stroke-dasharray: 3 5; opacity: .8; }
          svg[data-timeline-ui] .tl-axis { stroke: var(--text-muted); }
          svg[data-timeline-ui] .tl-lane { fill: var(--lane-fill); stroke: none; opacity: .55; }
          svg[data-timeline-ui] .tl-lane-alt { opacity: .3; }
          svg[data-timeline-ui] .tl-lane-line { stroke: var(--lane-stroke); }
          svg[data-timeline-ui] .tl-stem { stroke: var(--text-muted); opacity: .7; }
          svg[data-timeline-ui] .tl-break-band { fill: var(--mask); opacity: .85; }
          svg[data-timeline-ui] .tl-break-zig { stroke: var(--text-muted); }
          svg[data-timeline-ui] .tl-tick, svg[data-timeline-ui] .tl-time { font-variant-numeric: tabular-nums; }
        </style>

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

${renderHeader()}

        <!-- Lanes -->
${renderLanes()}

        <!-- Time axis (proportional within each segment; breaks are disclosed) -->
${renderAxis()}

        <!-- Stems sit behind every card, so a stacked card is never crossed by
             another event's connector -->
${cards.map((card) => `        <line data-detail="context" data-timeline-stem="${esc(card.id)}" x1="${card.x}" y1="${card.lineY}" x2="${card.x}" y2="${card.top}" class="tl-stem" stroke-width="1"/>`).join('\n')}

        <!-- Events in time order -->
${cards.map(renderEvent).join('\n')}

        <!-- Legend -->
${legendEntries.length ? renderResolvedLegend({ entries: legendEntries, locale, layout: legendLayout(), renderSwatch: legendSwatch }) : ''}
      </svg>`;
}

function buildLayoutReport() {
  return {
    diagram_type: 'timeline',
    viewBox,
    timezone,
    scalePxPerMinute: Math.round(scale * MINUTE * 1000) / 1000,
    segments: segments.map(({ start, end, x0, x1 }) => ({ start, end, x0, x1 })),
    breaks: breaks.map(({ from, to, length, x0, x1 }) => ({ from, to, length, x0, x1 })),
    ticks: ticks.map(({ t, x }) => ({ t, x })),
    lanes: laneLayout.map(({ id, y, height, lineY }) => ({ id, y, height, lineY })),
    events: cards.map((card) => ({ id: card.id, t: card.t, lane: laneOf(card), x: card.x, left: card.left, top: card.top, width: card.width, height: card.height, row: card.row })),
  };
}

if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'timeline',
  meta: tl.meta,
  svg: renderSvg(),
  cards: tl.cards,
  sourceEvidence,
});
