// Primary elements and relationships per diagram type, shared by the
// collector (content kept from first draft to final) and the benchmark.
export const DIAGRAM_TYPES = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall'];

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

const list = (value) => (Array.isArray(value) ? value : []);
const relationKey = (relation) => relation.id || `${relation.from}>${relation.to}>${relation.label || ''}`;

// Elements and relationships of `first` missing from `final`, by id.
export function contentLost(type, first, final) {
  const shape = SHAPE[type];
  if (!shape || !first || !final) return null;
  const finalElements = new Set(list(final[shape.elements]).map((element) => element.id));
  const finalRelations = new Set(list(final[shape.relations]).map(relationKey));
  const elements = list(first[shape.elements]).map((element) => element.id).filter((id) => !finalElements.has(id));
  const relations = shape.relations
    ? list(first[shape.relations]).map(relationKey).filter((key) => !finalRelations.has(key))
    : [];
  return {
    elements,
    relations,
    firstCounts: [list(first[shape.elements]).length, list(first[shape.relations]).length],
    finalCounts: [list(final[shape.elements]).length, list(final[shape.relations]).length],
  };
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
