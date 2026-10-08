// Shared by the tuning scripts: diagram shapes, benchmark preparation and the
// tuning home that keeps rounds and the benchmark outside the repository.
import os from 'node:os';
import path from 'node:path';

export const DIAGRAM_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall'];

// Prompt names per type, as a user would ask for the diagram.
export const TYPE_NAMES_ZH = {
  architecture: '架构图', workflow: '工作流图', sequence: '时序图', dataflow: '数据流图', lifecycle: '生命周期图',
  erd: 'ER 图', class: '类图', tree: '树图', timeline: '时间线图', waterfall: '瀑布图',
};

export function tuningHome(env = process.env) {
  return path.resolve(env.ARCHIFY_TUNING_HOME || path.join(os.homedir(), '.local/share/archify-tuning'));
}

const SHAPE = {
  architecture: { elements: 'components', relations: 'connections' },
  workflow: { elements: 'nodes', relations: 'edges' },
  sequence: { elements: 'participants', relations: 'messages' },
  dataflow: { elements: 'nodes', relations: 'flows' },
  lifecycle: { elements: 'states', relations: 'transitions' },
  erd: { elements: 'entities', relations: 'relationships' },
  class: { elements: 'types', relations: 'relationships' },
  tree: { elements: 'nodes' },
  timeline: { elements: 'events' },
  waterfall: { elements: 'spans' },
};

// Fields by which an author overrides automatic routing or label placement.
const ROUTE_CONTROLS = ['via', 'route', 'fromSide', 'toSide', 'channelX', 'channelY', 'bias', 'labelAt', 'labelDx', 'labelDy', 'labelSegment'];

const list = (value) => (Array.isArray(value) ? value : []);
const relationKey = (relation) => relation.id || `${relation.from}>${relation.to}>${relation.label || ''}`;

// Elements and relationships of `first` missing from `final`, by id. A renamed
// id also counts, so treat the result as a prompt to compare, not a verdict.
export function contentLost(type, first, final) {
  const shape = SHAPE[type];
  if (!shape || !first || !final) return null;
  const finalElements = new Set(list(final[shape.elements]).map((element) => element.id));
  const finalRelations = new Set(list(final[shape.relations]).map(relationKey));
  return {
    elements: list(first[shape.elements]).map((element) => element.id).filter((id) => !finalElements.has(id)),
    relations: shape.relations ? list(first[shape.relations]).map(relationKey).filter((key) => !finalRelations.has(key)) : [],
    firstCounts: [list(first[shape.elements]).length, list(first[shape.relations]).length],
    finalCounts: [list(final[shape.elements]).length, list(final[shape.relations]).length],
  };
}

// Count of authored routing controls, per field. Zero means the draft is
// fully automatic, so a composition failure on it is the renderer's.
export function authoredControls(type, document) {
  const relations = SHAPE[type]?.relations;
  const counts = {};
  for (const relation of list(document?.[relations])) {
    for (const field of ROUTE_CONTROLS) {
      if (relation[field] !== undefined && relation[field] !== 'auto') counts[field] = (counts[field] || 0) + 1;
    }
  }
  return counts;
}

// A benchmark entry must render without the source checkout: drop repository
// evidence and give it a stable output name.
export function benchmarkDocument(document, name) {
  const copy = JSON.parse(JSON.stringify(document));
  const strip = (value) => {
    if (Array.isArray(value)) value.forEach(strip);
    else if (value && typeof value === 'object') {
      delete value.sources;
      Object.values(value).forEach(strip);
    }
  };
  strip(copy);
  if (copy.meta) {
    delete copy.meta.repository;
    copy.meta.output = `${name}.html`;
  }
  return copy;
}

// Agents often pipe finalize through jq, so the exit code is not evidence.
export function finalizeStatus(result) {
  if (/"ok":\s*false|"status":\s*"fail"|"(?:validate|deliver|check|browser-check)":\s*"fail"/.test(result)) return 'fail';
  if (/"ok":\s*true|"status":\s*"pass"/.test(result)
    || /"validate":\s*"pass"[^}]*"browser-check":\s*"pass"/.test(result)) return 'pass';
  const exit = result.match(/Exit code: (\d+)/);
  return exit ? (exit[1] === '0' ? 'unknown' : 'fail') : 'unknown';
}
