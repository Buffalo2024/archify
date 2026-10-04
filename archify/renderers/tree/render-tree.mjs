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
import { nodeTextFit } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { asArray, roundedPath, routePointsValue } from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: tree, template, outPath, sourceEvidence } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'tree',
  defaultExample: 'payment-platform.tree.json',
  argv: cliArgs,
});
const locale = tree.meta.locale;
const direction = tree.layout?.direction === 'right' ? 'right' : 'down';

const layout = {
  margin: 32,
  top: 64,
  // Sibling gap and generation gap. A downward tree needs room under each
  // parent for its toggle and the elbow; a rightward one needs room beside it.
  gapX: tree.layout?.gapX ?? (direction === 'down' ? 28 : 48),
  gapY: tree.layout?.gapY ?? (direction === 'down' ? 64 : 18),
  nodeW: tree.layout?.nodeW ?? 140,
  nodeMaxW: tree.layout?.nodeMaxW ?? (direction === 'down' ? 220 : 200),
  padX: 14,
  padY: 11,
  labelFont: 12.5,
  labelLine: 16,
  sublabelFont: 10.5,
  sublabelLine: 13,
  rootLabelFont: 14,
  toggleR: 9,
};

// ---- Structure -----------------------------------------------------------------
// The hierarchy is exactly what the author declared: one root, and every other
// node names its parent. Nothing is inferred, so a missing parent, a cycle, or
// a second root is refused rather than silently attached somewhere.
function validateStructure() {
  const problems = [];
  const details = [];
  const fail = (code, message, subject, evidence, supportedFixes) => {
    problems.push(message);
    details.push({ code, severity: 'error', message, subject: { diagramType: 'tree', ...subject }, evidence, supportedFixes });
  };
  const nodes = asArray(tree.nodes);
  const byId = new Map();
  for (const [index, node] of nodes.entries()) {
    if (byId.has(node.id)) {
      fail('tree/duplicate-id', `Node id "${node.id}" is declared twice.`, { path: `/nodes/${index}/id` }, { id: node.id }, ['Give every node a unique id.']);
    }
    byId.set(node.id, node);
  }
  for (const [index, node] of nodes.entries()) {
    if (node.parent !== undefined && !byId.has(node.parent)) {
      fail('tree/missing-parent', `Node "${node.id}" names parent "${node.parent}", which is not declared.`,
        { path: `/nodes/${index}/parent`, nodeId: node.id }, { parent: node.parent },
        [`Declare a node with id "${node.parent}".`, 'Point parent at an existing node.', 'Remove parent to make this the root.']);
    }
  }
  const roots = nodes.filter((node) => node.parent === undefined);
  if (roots.length !== 1) {
    fail('tree/root-count', roots.length
      ? `A tree has one root, but ${roots.length} nodes have no parent: ${roots.map((node) => `"${node.id}"`).join(', ')}.`
      : 'A tree has one root, but every node names a parent.',
    { path: '/nodes' }, { roots: roots.map((node) => node.id) },
    roots.length ? ['Give all but one of these nodes a parent.', 'Add a single root that the top-level nodes name as parent.'] : ['Remove parent from the root node.']);
  }
  // Walk each node's parent chain. With one root and every parent declared,
  // the only way a node can fail to reach the root is a cycle in its chain,
  // which also accounts for every node hanging beneath that cycle.
  const reported = new Set();
  for (const [index, node] of nodes.entries()) {
    const chain = [];
    let current = node;
    while (current && current.parent !== undefined && !chain.includes(current.id)) {
      chain.push(current.id);
      current = byId.get(current.parent);
    }
    if (current && chain.includes(current.id)) {
      const cycle = chain.slice(chain.indexOf(current.id));
      const key = [...cycle].sort().join('|');
      if (!reported.has(key)) {
        reported.add(key);
        fail('tree/cycle', `Parent links form a cycle: ${[...cycle, cycle[0]].map((id) => `"${id}"`).join(' -> ')}.`,
          { path: `/nodes/${index}/parent`, nodeId: node.id }, { cycle },
          ['Point one node in the cycle at a parent outside it.']);
      }
    }
  }
  if (problems.length) {
    throwDiagnosticProblems('Tree structure validation failed', problems, { code: 'tree/structure', subject: { diagramType: 'tree' }, diagnostics: details });
  }
  return { byId, root: roots[0] };
}

const { root: authoredRoot } = validateStructure();

const childrenOf = new Map(asArray(tree.nodes).map((node) => [node.id, []]));
for (const node of asArray(tree.nodes)) if (node.parent !== undefined) childrenOf.get(node.parent).push(node.id);

// ---- Measurement ---------------------------------------------------------------
// Labels wrap at word boundaries (CJK at any character) inside a bounded box,
// so a long name grows the node downward instead of overflowing or being cut.
const ADVANCE = nodeTextFit.widthFactor;

function wrapText(text, font, maxWidth) {
  const limit = Math.max(4, Math.floor(maxWidth / (font * ADVANCE)));
  if (textUnits(text) <= limit) return [text];
  const tokens = String(text).match(/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]+\s*|\s+/g) || [text];
  const lines = [];
  let current = '';
  for (const token of tokens) {
    if (textUnits((current + token).trimEnd()) <= limit) {
      current += token;
      continue;
    }
    if (current.trim()) lines.push(current.trimEnd());
    current = token.trimStart();
    while (textUnits(current.trimEnd()) > limit) {
      const chars = Array.from(current);
      let cut = 0;
      for (let units = 0; cut < chars.length && units + textUnits(chars[cut]) <= limit; cut += 1) units += textUnits(chars[cut]);
      lines.push(chars.slice(0, Math.max(1, cut)).join(''));
      current = chars.slice(Math.max(1, cut)).join('');
    }
  }
  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

const depthOf = new Map();
(function assignDepth(id, depth) {
  depthOf.set(id, depth);
  for (const child of childrenOf.get(id)) assignDepth(child, depth + 1);
}(authoredRoot.id, 0));

const measured = new Map(asArray(tree.nodes).map((node) => {
  const isRoot = node.id === authoredRoot.id;
  const labelFont = isRoot ? layout.rootLabelFont : layout.labelFont;
  const natural = Math.max(
    textUnits(node.label) * labelFont * ADVANCE * 1.06,
    node.sublabel ? textUnits(node.sublabel) * layout.sublabelFont * ADVANCE : 0,
  );
  // Text wraps between words, never inside one: the longest single word may
  // widen a node past nodeMaxW (up to half again), and only a word longer
  // than that is split.
  const longestWord = Math.max(...String(node.label).split(/\s+/).map((word) => textUnits(word) * labelFont * ADVANCE * 1.06));
  const width = Math.ceil(Math.min(layout.nodeMaxW * 1.5, Math.max(
    layout.nodeW,
    Math.min(layout.nodeMaxW, natural + layout.padX * 2),
    longestWord + layout.padX * 2 + 2,
  )));
  const textWidth = width - layout.padX * 2;
  const labelLines = wrapText(node.label, labelFont * 1.06, textWidth);
  const sublabelLines = node.sublabel ? wrapText(node.sublabel, layout.sublabelFont, textWidth) : [];
  const height = Math.ceil(layout.padY * 2 + labelLines.length * layout.labelLine
    + (sublabelLines.length ? 4 + sublabelLines.length * layout.sublabelLine : 0));
  return [node.id, { ...node, isRoot, labelFont, labelLines, sublabelLines, width, height, depth: depthOf.get(node.id) }];
}));

// ---- Layout --------------------------------------------------------------------
// Every generation shares one band (a row going down, a column going right),
// sized by its largest node, so siblings and cousins line up. Along the other
// axis each subtree owns a contiguous span: leaves are laid out in order and a
// parent is centred over its children. Positions never depend on collapse
// state, so expanding or collapsing a branch leaves every visible node where
// the reader last saw it.
const down = direction === 'down';
const breadthSize = (node) => (down ? node.width : node.height);
const depthSize = (node) => (down ? node.height : node.width);
const breadthGap = down ? layout.gapX : layout.gapY;
const depthGap = down ? layout.gapY : layout.gapX;

const bandSize = [];
for (const node of measured.values()) bandSize[node.depth] = Math.max(bandSize[node.depth] || 0, depthSize(node));
const bandStart = [];
bandSize.reduce((offset, size, depth) => {
  bandStart[depth] = offset;
  return offset + size + depthGap;
}, down ? layout.top : layout.margin);

const span = new Map();
(function measureSpan(id) {
  const children = childrenOf.get(id);
  children.forEach(measureSpan);
  const childSpan = children.reduce((sum, child, index) => sum + span.get(child) + (index ? breadthGap : 0), 0);
  span.set(id, Math.max(breadthSize(measured.get(id)), childSpan));
}(authoredRoot.id));

const placed = new Map();
(function place(id, start) {
  const node = measured.get(id);
  const children = childrenOf.get(id);
  const childSpan = children.reduce((sum, child, index) => sum + span.get(child) + (index ? breadthGap : 0), 0);
  let cursor = start + (span.get(id) - childSpan) / 2;
  for (const child of children) {
    place(child, cursor);
    cursor += span.get(child) + breadthGap;
  }
  // Going down, a parent is centred over its first and last child. Going
  // right, it lines up with its first child, like a file explorer: the root
  // stays at the top-left of a tall canvas instead of in its middle, where a
  // reader who starts at the top would never see it.
  const center = !children.length ? start + span.get(id) / 2
    : down ? (centerOf(children[0]) + centerOf(children.at(-1))) / 2
      : centerOf(children[0]);
  const breadth = center - breadthSize(node) / 2;
  // A row going down centres each node in its band; a column going right
  // left-aligns them so every link into the column has the same stub.
  const depth = bandStart[node.depth] + (down ? (bandSize[node.depth] - depthSize(node)) / 2 : 0);
  const [x, y] = down ? [breadth, depth] : [depth, breadth];
  placed.set(id, { ...node, x: Math.round(x), y: Math.round(y) });
}(authoredRoot.id, down ? layout.margin : layout.top));

function centerOf(id) {
  const node = placed.get(id);
  return down ? node.x + node.width / 2 : node.y + node.height / 2;
}

const all = [...placed.values()];
const viewBox = Array.isArray(tree.meta?.viewBox) ? tree.meta.viewBox : [
  Math.max(320, Math.ceil(Math.max(...all.map((node) => node.x + node.width)) + layout.margin + (down ? 0 : layout.toggleR + 4))),
  Math.max(240, Math.ceil(Math.max(...all.map((node) => node.y + node.height)) + layout.margin + (down ? layout.toggleR + 4 : 0))),
];

// ---- Edges ---------------------------------------------------------------------
// One elbow per parent-child link: out of the parent's toggle side, across at
// the midpoint of the generation gap, and into the child. Siblings share the
// stem and the crossbar, which is how a containment tree is read.
function edgePoints(parent, child) {
  if (down) {
    const start = [parent.x + parent.width / 2, parent.y + parent.height];
    const end = [child.x + child.width / 2, child.y];
    const midY = bandStart[child.depth] - depthGap / 2;
    return Math.abs(start[0] - end[0]) < 0.5 ? [start, end] : [start, [start[0], midY], [end[0], midY], end];
  }
  const start = [parent.x + parent.width, parent.y + parent.height / 2];
  const end = [child.x, child.y + child.height / 2];
  const midX = bandStart[child.depth] - depthGap / 2;
  return Math.abs(start[1] - end[1]) < 0.5 ? [start, end] : [start, [midX, start[1]], [midX, end[1]], end];
}

const edges = all.filter((node) => node.parent !== undefined).map((node, index) => ({
  from: node.parent,
  to: node.id,
  index,
  points: edgePoints(placed.get(node.parent), node),
}));

function ancestorsOf(id) {
  const chain = [];
  for (let current = placed.get(id); current?.parent !== undefined; current = placed.get(current.parent)) chain.push(current.parent);
  return chain;
}

function descendantCount(id) {
  return childrenOf.get(id).reduce((sum, child) => sum + 1 + descendantCount(child), 0);
}

// ---- Canvas checks -------------------------------------------------------------
{
  const problems = [];
  if (Array.isArray(tree.meta?.viewBox)) {
    for (const node of all) {
      if (node.x + node.width + layout.margin / 2 > viewBox[0] || node.y + node.height + layout.margin / 2 > viewBox[1]) {
        problems.push(`Node "${node.id}" lies outside the authored meta.viewBox ${viewBox.join('x')} — remove meta.viewBox or enlarge it.`);
      }
    }
  }
  if (problems.length) throwDiagnosticProblems('Tree layout validation failed', problems, { code: 'layout/constraint', subject: { diagramType: 'tree' } });
}

function buildLayoutReport() {
  return {
    diagram_type: 'tree',
    direction,
    viewBox,
    nodes: all.map((node) => ({ id: node.id, parent: node.parent ?? null, depth: node.depth, x: node.x, y: node.y, width: node.width, height: node.height, lines: node.labelLines.length })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, points: edge.points })),
  };
}

// ---- Rendering -----------------------------------------------------------------
function treeAttrs(id) {
  const ancestors = ancestorsOf(id);
  return ancestors.length ? ` data-tree-ancestors="${esc(ancestors.join(' '))}"` : '';
}

function renderNode(node) {
  const tone = node.isRoot ? 'frontend' : childrenOf.get(node.id).length ? 'backend' : 'external';
  const context = i18nText(locale, node.isRoot ? 'node.context.tree.root' : childrenOf.get(node.id).length ? 'node.context.tree.branch' : 'node.context.tree.leaf');
  const passport = { kind: tone, sublabel: node.sublabel, context };
  const cx = node.x + node.width / 2;
  let y = node.y + layout.padY;
  const label = node.labelLines.map((line) => {
    y += layout.labelLine;
    return `<tspan x="${cx}" y="${y - 4}">${esc(line)}</tspan>`;
  }).join('');
  y += node.sublabelLines.length ? 4 : 0;
  const sublabel = node.sublabelLines.map((line) => {
    y += layout.sublabelLine;
    return `<tspan x="${cx}" y="${y - 3}">${esc(line)}</tspan>`;
  }).join('');
  // A collapsed branch shows a stacked card behind it, so the hidden subtree
  // stays visible as "there is more here" even before the badge is read.
  const stack = childrenOf.get(node.id).length
    ? `<rect data-tree-stack="" x="${node.x + 5}" y="${node.y + 5}" width="${node.width}" height="${node.height}" rx="7" class="c-${tone}" stroke-width="1.2"/>`
    : '';
  return `        <g ${focusNodeAttrs(node.id, node.label, passport, locale)} data-tree-depth="${node.depth}"${treeAttrs(node.id)}>
          ${focusNodeTitle(node.label, passport)}
          ${stack}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="7" class="c-mask"/>
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="7" class="c-${tone}"${animateAttr(tree.meta, 'node', node.depth)} stroke-width="${node.isRoot ? 2 : 1.5}"/>
          <text data-node-label="" x="${cx}" class="t-primary" font-size="${node.labelFont}" font-weight="${node.isRoot ? 750 : 650}" text-anchor="middle">${label}</text>
          ${sublabel ? `<text data-detail="context" x="${cx}" class="t-muted" font-size="${layout.sublabelFont}" text-anchor="middle">${sublabel}</text>` : ''}
        </g>`;
}

// The toggle is a separate control after its node, not nested inside it, so a
// keyboard reader meets "node, then its branch control" and each has one role.
function renderToggle(node) {
  const children = childrenOf.get(node.id);
  if (!children.length) return '';
  const [cx, cy] = down ? [node.x + node.width / 2, node.y + node.height] : [node.x + node.width, node.y + node.height / 2];
  const hidden = descendantCount(node.id);
  const collapse = i18nText(locale, 'tree.toggle.collapse', { label: node.label, count: hidden });
  const expand = i18nText(locale, 'tree.toggle.expand', { label: node.label, count: hidden });
  const r = layout.toggleR;
  return `        <g data-tree-toggle="${esc(node.id)}" data-tree-count="${hidden}"${treeAttrs(node.id)}${node.collapsed ? ' data-tree-initially-collapsed=""' : ''} data-tree-label-collapse="${esc(collapse)}" data-tree-label-expand="${esc(expand)}" role="button" tabindex="0" aria-expanded="true" aria-label="${esc(collapse)}">
          <circle cx="${cx}" cy="${cy}" r="${r + 6}" class="tree-toggle-hit"/>
          <circle cx="${cx}" cy="${cy}" r="${r}" class="tree-toggle-disc" stroke-width="1.4"/>
          <path class="tree-toggle-glyph" d="M ${cx - 4} ${cy} H ${cx + 4}" stroke-width="1.6" stroke-linecap="round"/>
          <path class="tree-toggle-glyph tree-toggle-plus" d="M ${cx} ${cy - 4} V ${cy + 4}" stroke-width="1.6" stroke-linecap="round"/>
          <text class="tree-toggle-count t-muted" x="${down ? cx + r + 5 : cx + r + 4}" y="${down ? cy + 3.5 : cy - r - 3}" font-size="9.5" font-weight="650">${hidden}</text>
        </g>`;
}

function renderEdge(edge) {
  return `        <path ${focusEdgeAttrs(edge.from, edge.to, undefined, edge.index)}${treeAttrs(edge.to)} data-composition-points="${routePointsValue(edge.points)}" d="${roundedPath(edge.points, 6)}" class="a-default tree-edge"${animateAttr(tree.meta, 'edge', placed.get(edge.to).depth)} stroke-width="1.5"/>`;
}

function renderSvg() {
  const readerFit = tree.meta?.viewBox ? '' : ' data-reader-fit="intrinsic-height" data-reader-min-text="7.5"';
  const expandAll = esc(i18nText(locale, 'tree.expandAll'));
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(tree.meta)} data-tree-ui="" data-tree-direction="${direction}"${readerFit}>
${svgAccessibleText(tree.meta, 'tree')}
${renderDefinitions()}
        <style>
          svg[data-tree-ui] .tree-edge { stroke-linejoin: round; }
          svg[data-tree-ui] [data-tree-stack] { display: none; fill: var(--mask); }
          svg[data-tree-ui] [data-tree-collapsed] [data-tree-stack] { display: inline; }
          svg[data-tree-ui] [data-tree-hidden] { display: none; }
          svg[data-tree-ui] .tree-toggle-hit { fill: transparent; }
          svg[data-tree-ui] .tree-toggle-disc { fill: var(--mask); stroke: var(--arrow); }
          svg[data-tree-ui] .tree-toggle-glyph { stroke: var(--text); fill: none; }
          svg[data-tree-ui] .tree-toggle-count { display: none; }
          svg[data-tree-ui] [data-tree-toggle] { cursor: pointer; outline: none; }
          svg[data-tree-ui] [data-tree-toggle][aria-expanded="true"] .tree-toggle-plus { display: none; }
          svg[data-tree-ui] [data-tree-toggle][aria-expanded="false"] .tree-toggle-count { display: inline; }
          svg[data-tree-ui] [data-tree-toggle]:hover .tree-toggle-disc,
          svg[data-tree-ui] [data-tree-toggle]:focus-visible .tree-toggle-disc { stroke: var(--arrow-emphasis); stroke-width: 2.4; }
          svg[data-tree-ui] [data-tree-expand-all] { cursor: pointer; outline: none; }
          svg[data-tree-ui] [data-tree-expand-all] rect { fill: var(--mask); stroke: var(--lane-stroke); }
          svg[data-tree-ui] [data-tree-expand-all]:is(:hover, :focus-visible) rect { stroke: var(--arrow-emphasis); stroke-width: 2; }
          svg[data-tree-ui]:not([data-tree-any-collapsed]) [data-tree-expand-all] { display: none; }
        </style>

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Containment links -->
${edges.map(renderEdge).join('\n')}

        <!-- Nodes -->
${all.map(renderNode).join('\n')}

        <!-- Branch toggles -->
${all.map(renderToggle).filter(Boolean).join('\n')}

        <!-- Expand all (shown only while a branch is collapsed) -->
        <g data-tree-expand-all="" role="button" tabindex="0" aria-label="${expandAll}">
          <rect x="${layout.margin}" y="18" width="${Math.ceil(textUnits(expandAll) * 10.5 * ADVANCE + 24)}" height="24" rx="12" stroke-width="1.2"/>
          <text x="${layout.margin + 12}" y="34" class="t-primary" font-size="10.5" font-weight="650">${expandAll}</text>
        </g>
      </svg>`;
}

if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'tree',
  meta: tree.meta,
  svg: renderSvg(),
  cards: tree.cards,
  sourceEvidence,
});
