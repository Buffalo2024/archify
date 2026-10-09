import fs from 'node:fs';
import * as validators from './generated-validators.mjs';
import { throwDiagnosticError } from './diagnostics.mjs';

const SCHEMA_DIRECTORY = new URL('../../schemas/', import.meta.url);
const schemaCache = new Map();
function loadSchema(file) {
  if (!schemaCache.has(file)) {
    try {
      schemaCache.set(file, JSON.parse(fs.readFileSync(new URL(file, SCHEMA_DIRECTORY), 'utf8')));
    } catch {
      schemaCache.set(file, null);
    }
  }
  return schemaCache.get(file);
}

// Resolve the object schema whose additionalProperties rejected a property so
// the diagnostic can name the properties that are allowed there.
function parentObjectSchema(diagramType, schemaPath) {
  const [file, pointer = ''] = String(schemaPath || '').split('#');
  let node = loadSchema(file || `${diagramType}.schema.json`);
  const segments = pointer.split('/').slice(1, -1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
  for (const segment of segments) {
    if (node == null || typeof node !== 'object') return [];
    node = node[segment];
  }
  return node && typeof node === 'object' ? node : null;
}

function allowedPropertyNames(diagramType, schemaPath) {
  const node = parentObjectSchema(diagramType, schemaPath);
  return node && typeof node.properties === 'object' ? Object.keys(node.properties) : [];
}

// "number >= 160" or "one of ..." for a required property, when the schema
// states it inline; a $ref target is left to the schema read.
function describeProperty(diagramType, schemaPath, property) {
  const definition = parentObjectSchema(diagramType, schemaPath)?.properties?.[property];
  if (!definition || typeof definition !== 'object') return '';
  if (Array.isArray(definition.enum)) {
    return ` (one of ${definition.enum.map((value) => JSON.stringify(value)).join(', ')})`;
  }
  const parts = [];
  if (typeof definition.type === 'string') parts.push(definition.type);
  if (Number.isFinite(definition.minimum)) parts.push(`>= ${definition.minimum}`);
  if (Number.isFinite(definition.maximum)) parts.push(`<= ${definition.maximum}`);
  return parts.length ? ` (${parts.join(' ')})` : '';
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function closestName(word, options) {
  const folded = String(word).toLowerCase();
  let best = null;
  for (const option of options) {
    const distance = editDistance(folded, String(option).toLowerCase());
    if (distance <= Math.max(1, Math.floor(option.length / 3))
      && (!best || distance < best.distance)) best = { option, distance };
  }
  return best?.option ?? null;
}

// Properties agents commonly invent whose fact has a documented home; deleting
// them would drop meaning, so the fix names where the fact belongs instead.
const RELOCATED_PROPERTIES = {
  erd: {
    attribute: {
      match: /^\/entities\/\d+\/attributes\/\d+$/,
      properties: ['note', 'description', 'desc', 'remark'],
      fix: (property) => `rename ${JSON.stringify(property)} to "comment" (drawn after the type as "SQL_TYPE｜comment")`,
    },
  },
};

function relocationFix(diagramType, instancePath, property) {
  for (const rule of Object.values(RELOCATED_PROPERTIES[diagramType] || {})) {
    if (rule.match.test(instancePath) && rule.properties.includes(property)) return rule.fix(property);
  }
  return null;
}

function valueAt(instancePath, data) {
  let node = data;
  for (const segment of String(instancePath || '').split('/').slice(1)) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[/^\d+$/.test(segment) ? Number(segment) : segment];
  }
  return node;
}

function additionalPropertyFixes(diagramType, error) {
  const property = error.params?.additionalProperty;
  const relocated = relocationFix(diagramType, error.instancePath, property);
  if (relocated) return [relocated];
  const allowed = allowedPropertyNames(diagramType, error.schemaPath);
  const suggestion = closestName(property, allowed);
  if (suggestion) return [`rename ${JSON.stringify(property)} to ${JSON.stringify(suggestion)}`];
  return [`remove unsupported property ${JSON.stringify(property)}`];
}

// Words agents reach for that are not spelling slips of an allowed value, so
// edit distance cannot suggest them. Each maps to candidate values in
// preference order; only a candidate the failing enum actually allows is used.
const ENUM_SYNONYMS = new Map(Object.entries({
  // timeline event kinds
  incident: ['alert'], outage: ['alert'], error: ['alert'], failure: ['alert'], fail: ['alert'],
  failed: ['alert'], issue: ['alert'], alarm: ['alert'], page: ['alert'], warning: ['alert'],
  degraded: ['alert'], resolved: ['recovery'], resolve: ['recovery'], resolution: ['recovery'],
  fixed: ['recovery'], recovered: ['recovery'], restored: ['recovery'], restore: ['recovery'],
  mitigated: ['recovery'], deploy: ['change'], deployment: ['change'], release: ['change'],
  rollout: ['change'], rollback: ['change'], config: ['change'], migration: ['change'],
  mitigation: ['action'], mitigate: ['action'], investigation: ['action'], investigate: ['action'],
  escalation: ['action'], fix: ['action'], decision: ['action'],
  milestone: ['default'], info: ['default'], event: ['default', 'dashed'], note: ['default'],
  // sequence message variants
  async: ['dashed'], asynchronous: ['dashed'], callback: ['dashed'], webhook: ['dashed'],
  notify: ['dashed'], notification: ['dashed'], response: ['return', 'action'], reply: ['return'],
  ack: ['return'], result: ['return'], sync: ['default'], request: ['default'],
  critical: ['emphasis'], primary: ['emphasis'], highlight: ['emphasis'], important: ['emphasis'],
  auth: ['security'], secure: ['security'], tls: ['security'], encrypted: ['security'],
  // architecture boundary kinds
  vpc: ['region'], vnet: ['region'], network: ['region'], cloud: ['region'], account: ['region'],
  zone: ['region'], az: ['region'], datacenter: ['region'], cluster: ['region'], subnet: ['security-group'],
  firewall: ['security-group'], sg: ['security-group'], dmz: ['security-group'], 'trust-zone': ['security-group'],
}));

function synonymFor(word, options) {
  const folded = String(word).trim().toLowerCase().replace(/[\s_]+/g, '-');
  return (ENUM_SYNONYMS.get(folded) || []).find((option) => options.includes(option)) ?? null;
}

function enumFixes(error, data) {
  const allowed = error.params?.allowedValues || [];
  const actual = valueAt(error.instancePath, data);
  const options = allowed.filter((value) => typeof value === 'string');
  const suggestion = typeof actual === 'string'
    ? closestName(actual, options) ?? synonymFor(actual, options)
    : null;
  const list = allowed.map((value) => JSON.stringify(value)).join(', ');
  return [
    suggestion
      ? `use ${JSON.stringify(suggestion)} (allowed: ${list})`
      : `use one of ${list}`,
  ];
}

function schemaMessage(diagramType, error, data) {
  const base = `${annotatePath(error.instancePath, data)} ${error.message}`;
  if (error.keyword === 'enum') {
    const actual = valueAt(error.instancePath, data);
    return `${base}: got ${JSON.stringify(actual)}; allowed ${(error.params?.allowedValues || [])
      .map((value) => JSON.stringify(value)).join(', ')}`;
  }
  if (error.keyword === 'additionalProperties') {
    const allowed = allowedPropertyNames(diagramType, error.schemaPath);
    return `${base}: ${JSON.stringify(error.params?.additionalProperty)}${allowed.length
      ? `; allowed ${allowed.map((name) => JSON.stringify(name)).join(', ')}`
      : ''}`;
  }
  return base;
}

// "/nodes/3/label" reads much better as "/nodes/3 (id: "router") /label" for the
// LLM fixing the JSON; resolve the nearest enclosing element's id or label.
function annotatedPath(instancePath, data) {
  if (!instancePath) return { path: '/', identity: null };
  let node = data;
  let hint = null;
  for (const seg of instancePath.split('/').slice(1)) {
    if (node == null || typeof node !== 'object') break;
    node = node[/^\d+$/.test(seg) ? Number(seg) : seg];
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const tag = node.id ?? node.label;
      if (tag != null) hint = String(tag);
    }
  }
  return { path: instancePath, identity: hint };
}

function annotatePath(instancePath, data) {
  const annotated = annotatedPath(instancePath, data);
  return annotated.identity != null
    ? `${annotated.path} (id/label: ${JSON.stringify(annotated.identity)})`
    : annotated.path;
}

function formatErrors(errors, data) {
  return errors.map((e) => {
    const where = annotatePath(e.instancePath, data);
    const detail = e.params && Object.keys(e.params).length
      ? ' ' + JSON.stringify(e.params)
      : '';
    return `  ${where} ${e.message}${detail}`;
  }).join('\n');
}

export function validateSchema(diagramType, data) {
  const validate = validators[diagramType];
  if (!validate) {
    throw new Error(`validateSchema: unknown diagram type "${diagramType}"`);
  }
  if (!validate(data)) {
    const diagnostics = validate.errors.map((error) => {
      const annotated = annotatedPath(error.instancePath, data);
      const subject = {
        diagramType,
        path: annotated.path,
        ...(annotated.identity != null ? { identity: String(annotated.identity) } : {}),
      };
      const evidence = {
        keyword: error.keyword,
        expected: error.schema,
        ...error.params,
      };
      const supportedFixes = {
        additionalProperties: additionalPropertyFixes(diagramType, error),
        required: [`add required property ${JSON.stringify(error.params?.missingProperty)}${describeProperty(diagramType, error.schemaPath, error.params?.missingProperty)}`],
        type: [`use ${JSON.stringify(error.params?.type)} at ${annotated.path}`],
        enum: enumFixes(error, data),
        pattern: [`match the required pattern ${JSON.stringify(error.params?.pattern)}`],
        minimum: [`use a value ${error.params?.comparison || '>='} ${error.params?.limit}`],
        maximum: [`use a value ${error.params?.comparison || '<='} ${error.params?.limit}`],
        minItems: [`provide at least ${error.params?.limit} item(s)`],
        maxItems: [`provide at most ${error.params?.limit} item(s)`],
        minLength: [`provide at least ${error.params?.limit} character(s)`],
        maxLength: [`provide at most ${error.params?.limit} character(s)`],
      }[error.keyword] || [];
      return {
        code: `schema/${error.keyword}`,
        severity: 'error',
        message: schemaMessage(diagramType, error, data),
        subject,
        evidence,
        supportedFixes,
      };
    });
    throwDiagnosticError(
      `${diagramType} schema validation failed:\n${formatErrors(validate.errors, data)}`,
      diagnostics,
    );
  }
}
