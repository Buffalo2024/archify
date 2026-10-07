import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDiagramWithBrandMarks, writeDiagram } from '../shared/cli.mjs';
import { esc } from '../shared/utils.mjs';
import { rendererFailure } from '../shared/diagnostics.mjs';
import { compileArchitectureGraph } from './architecture-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: arch, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'architecture',
  defaultExample: 'web-app.architecture.json',
  argv: cliArgs,
});

let compiled;
try { compiled = compileArchitectureGraph(arch, { sourceEvidence, tolerateInvalid: layoutJsonMode }); }
catch (error) {
  if (!layoutJsonMode) throw error;
  compiled = { layoutReport: { ...rendererFailure(error), contract: 'archify-architecture-layout-v1' } };
}

// Snapshot the parent's diagnostics before any child compilation can record
// another failure in the renderer's process-wide diagnostic boundary.
const parentDiagnostics = [...(compiled.layoutReport.diagnostics || [])];
const childLayouts = [];

const inheritedMeta = Object.fromEntries([
  'locale',
  'animation',
  'visual_preset',
  'quality_profile',
  'engineering_profile',
].flatMap((key) => arch.meta?.[key] === undefined ? [] : [[key, arch.meta[key]]]));
const subarchitectureTemplates = (arch.components || []).flatMap((parent, parentIndex) => {
  const local = parent.subarchitecture;
  if (!local) return [];
  const localGraph = {
    meta: { title: local.title },
    components: local.components,
    boundaries: local.boundaries || [],
    connections: local.connections || [],
    ...(local.layout ? { layout: local.layout } : {}),
  };
  const scopedEvidence = sourceEvidence?.subgraphs?.[parent.id] || null;
  const scope = {
    graphScope: 'subarchitecture',
    parentId: parent.id,
    subjectBase: `/components/${parentIndex}/subarchitecture`,
  };
  let localCompiled;
  try {
    localCompiled = compileArchitectureGraph(localGraph, {
      identityPrefix: `sub-${parent.id}-`,
      ...scope,
      inheritedMeta,
      sourceEvidence: scopedEvidence,
    });
  } catch (error) {
    if (!layoutJsonMode) throw error;
    const failure = rendererFailure(error);
    // Attached diagnostics belong to this compilation. The process-wide
    // recording may also contain failures from earlier sibling graphs.
    const diagnostics = Array.isArray(error.archifyDiagnostics) && error.archifyDiagnostics.length
      ? error.archifyDiagnostics : failure.diagnostics;
    childLayouts.push({
      ...scope,
      ...failure,
      diagnostics: diagnostics.map((diagnostic) => ({
        ...diagnostic,
        subject: { ...diagnostic.subject, ...scope },
      })),
    });
    return [];
  }
  if (layoutJsonMode) {
    childLayouts.push({ ...scope, ...localCompiled.layoutReport });
    return [];
  }
  return [`    <template data-subarchitecture-parent="${esc(parent.id)}" data-subarchitecture-title="${esc(local.title)}">
${localCompiled.svg}
    </template>`];
}).join('\n');

if (layoutJsonMode) {
  const failedChildren = childLayouts.filter((child) => child.ok === false);
  const failed = compiled.layoutReport.ok === false || failedChildren.length > 0;
  const report = childLayouts.length ? {
    ...compiled.layoutReport,
    ok: !failed,
    subarchitectures: childLayouts,
    ...(failed ? {
      schemaVersion: 1,
      source: 'renderer',
      contract: 'archify-architecture-layout-v1',
      error: [
        ...(compiled.layoutReport.ok === false ? [compiled.layoutReport.error] : []),
        ...failedChildren.map((child) => `Subarchitecture of "${child.parentId}": ${child.error}`),
      ].join('\n'),
      diagnostics: [...parentDiagnostics, ...failedChildren.flatMap((child) => child.diagnostics)],
    } : {}),
  } : compiled.layoutReport;
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok === false ? 1 : 0);
}

writeDiagram({
  outPath,
  template,
  diagramType: 'architecture',
  meta: arch.meta,
  svg: compiled.svg,
  cards: arch.cards,
  sourceEvidence,
  subarchitectureTemplates,
});
