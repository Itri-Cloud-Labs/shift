import type { Json } from '../harness/types.js';

// Human forms (specification 6.6 and client section 5.4) are a restricted JSON Schema 2020-12
// dialect that a client can render with typed widgets: text, numbers, booleans, choices and simple
// nested objects and arrays. Responses are validated against the frozen form as written.

const scalarKeywords: Record<string, readonly string[]> = {
  string: ['minLength', 'maxLength', 'pattern', 'format', 'enum'],
  number: ['minimum', 'maximum', 'enum'],
  integer: ['minimum', 'maximum', 'enum'],
  boolean: [],
  object: ['properties', 'required', 'additionalProperties'],
  array: ['items', 'minItems', 'maxItems'],
};
const common = ['type', 'title', 'description', 'default'];
const formats = new Set(['date', 'date-time', 'email', 'uri']);
const maxDepth = 4;

// The first problem with a form as a JSON pointer and message, or null when it can be rendered.
export function formProblem(form: Json): { at: string; message: string } | null {
  const visit = (node: Json, at: string, depth: number): { at: string; message: string } | null => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      return { at, message: 'A form field must be a schema object.' };
    }
    const type = node['type'];
    if (typeof type !== 'string' || !(type in scalarKeywords)) {
      return {
        at: `${at}/type`,
        message: 'Use string, number, integer, boolean, object or array.',
      };
    }
    const allowed = new Set([...common, ...scalarKeywords[type]!]);
    const extra = Object.keys(node).find((key) => !allowed.has(key));
    if (extra)
      return { at: `${at}/${extra}`, message: `Forms do not support ${extra} on ${type}.` };
    if (typeof node['format'] === 'string' && !formats.has(node['format'])) {
      return { at: `${at}/format`, message: 'Use date, date-time, email or uri.' };
    }
    if (type === 'object') {
      if (depth >= maxDepth) return { at, message: `Forms nest at most ${maxDepth} levels.` };
      if (node['additionalProperties'] !== undefined && node['additionalProperties'] !== false) {
        return {
          at: `${at}/additionalProperties`,
          message: 'Form objects accept only their fields.',
        };
      }
      const properties = node['properties'] ?? {};
      if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
        return { at: `${at}/properties`, message: 'properties must be an object.' };
      }
      for (const [name, child] of Object.entries(properties)) {
        const found = visit(child, `${at}/properties/${name}`, depth + 1);
        if (found) return found;
      }
    }
    if (type === 'array') {
      if (depth >= maxDepth) return { at, message: `Forms nest at most ${maxDepth} levels.` };
      if (node['items'] === undefined) return { at, message: 'An array field needs items.' };
      return visit(node['items'], `${at}/items`, depth + 1);
    }
    return null;
  };
  if ((form as { type?: unknown } | null)?.type !== 'object') {
    return { at: '', message: 'A form is an object schema.' };
  }
  return visit(form, '', 0);
}

// The form as frozen for an interaction: every object accepts only its declared fields.
export function freezeForm(form: Json): Json {
  if (typeof form !== 'object' || form === null || Array.isArray(form)) return form;
  const copy: { [key: string]: Json } = { ...form };
  if (copy['type'] === 'object') {
    copy['additionalProperties'] = false;
    const properties = (copy['properties'] ?? {}) as { [key: string]: Json };
    copy['properties'] = Object.fromEntries(
      Object.entries(properties).map(([name, child]) => [name, freezeForm(child)]),
    );
  }
  if (copy['type'] === 'array' && copy['items'] !== undefined) {
    copy['items'] = freezeForm(copy['items']);
  }
  return copy;
}

// Approval gives an optional comment unless the author configured other fields.
export const defaultApprovalForm: Json = {
  type: 'object',
  properties: { comment: { type: 'string', maxLength: 4000, title: 'Comment' } },
};
export const defaultOutcomes = ['approved', 'rejected'] as const;
