// Human request forms (client specification 5.4). A form is the server's restricted JSON Schema:
// strings, numbers, booleans, and nested objects and arrays. The editor keeps a draft in which
// numbers and dates are the text typed; `toResponse` turns it into the response and reports what
// is missing or malformed. The server still checks the response against the frozen form.

export type Schema = Record<string, unknown>;
export type Draft = string | boolean | Draft[] | { [name: string]: Draft };

export function asSchema(value: unknown): Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Schema)
    : {};
}

export function properties(schema: Schema): [string, Schema][] {
  return Object.entries(asSchema(schema['properties'])).map(([name, child]) => [
    name,
    asSchema(child),
  ]);
}

export function isRequired(schema: Schema, name: string): boolean {
  return Array.isArray(schema['required']) && schema['required'].includes(name);
}

// "release_notes" reads as "Release notes" where the form gives no title.
export function fieldLabel(name: string, schema: Schema): string {
  if (typeof schema['title'] === 'string' && schema['title']) return schema['title'];
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

// datetime-local shows local time without seconds or offset.
function localDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function initialDraft(schema: Schema): Draft {
  const fallback = schema['default'];
  switch (schema['type']) {
    case 'object':
      return Object.fromEntries(
        properties(schema).map(([name, child]) => {
          const given = asSchema(fallback)[name];
          return [name, initialDraft(given === undefined ? child : { ...child, default: given })];
        }),
      );
    case 'array': {
      const items = asSchema(schema['items']);
      const given = Array.isArray(fallback) ? fallback : [];
      const minimum = typeof schema['minItems'] === 'number' ? schema['minItems'] : 0;
      const drafts = given.map((item) => initialDraft({ ...items, default: item }));
      while (drafts.length < minimum) drafts.push(initialDraft(items));
      return drafts;
    }
    case 'boolean':
      return fallback === true;
    case 'number':
    case 'integer':
      return typeof fallback === 'number' ? String(fallback) : '';
    default:
      if (typeof fallback !== 'string') return '';
      return schema['format'] === 'date-time' ? localDateTime(fallback) : fallback;
  }
}

export interface Converted {
  value: Record<string, unknown>;
  // Problems by JSON pointer, such as "/reviewers/0/name".
  problems: Map<string, string>;
}

export function toResponse(form: Schema, draft: Draft): Converted {
  const problems = new Map<string, string>();
  const convert = (schema: Schema, value: Draft, at: string, required: boolean): unknown => {
    switch (schema['type']) {
      case 'object': {
        // An optional group left blank is left out, so its required fields do not apply. One that
        // shows defaults is an answer.
        if (
          !required &&
          !hasDefault(schema) &&
          JSON.stringify(value) === JSON.stringify(initialDraft(schema))
        )
          return undefined;
        const record = typeof value === 'object' && !Array.isArray(value) ? value : {};
        const result: Record<string, unknown> = {};
        for (const [name, inner] of properties(schema)) {
          // A default given by this object applies to its field, as when the draft was made.
          const given = asSchema(schema['default'])[name];
          const child = given === undefined ? inner : { ...inner, default: given };
          const converted = convert(
            child,
            record[name] ?? initialDraft(child),
            `${at}/${name}`,
            isRequired(schema, name),
          );
          if (converted !== undefined) result[name] = converted;
        }
        return result;
      }
      case 'array': {
        const items = asSchema(schema['items']);
        const list = Array.isArray(value) ? value : [];
        const given = Array.isArray(schema['default']) ? schema['default'] : [];
        return list.map((item, index) => {
          // An item the array's default filled in carries that default, as in the draft.
          const schemaOfItem =
            given[index] === undefined ? items : { ...items, default: given[index] };
          return convert(schemaOfItem, item, `${at}/${index}`, true) ?? null;
        });
      }
      case 'boolean':
        return value === true;
      case 'number':
      case 'integer': {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text === '') {
          if (required) problems.set(at, 'Enter a number.');
          return undefined;
        }
        const number = Number(text);
        if (!Number.isFinite(number)) problems.set(at, 'Enter a number.');
        else if (schema['type'] === 'integer' && !Number.isInteger(number))
          problems.set(at, 'Enter a whole number.');
        return number;
      }
      default: {
        const text = typeof value === 'string' ? value : '';
        if (text === '') {
          if (required) problems.set(at, 'Fill in this field.');
          return undefined;
        }
        if (schema['format'] === 'date-time') {
          const date = new Date(text);
          if (Number.isNaN(date.getTime())) {
            problems.set(at, 'Enter a date and time.');
            return undefined;
          }
          return date.toISOString();
        }
        return text;
      }
    }
  };
  const value = convert({ ...form, type: 'object' }, draft, '', true) as Record<string, unknown>;
  return { value, problems };
}

function hasDefault(schema: Schema): boolean {
  return (
    schema['default'] !== undefined ||
    properties(schema).some(([, child]) => hasDefault(child)) ||
    (schema['type'] === 'array' && hasDefault(asSchema(schema['items'])))
  );
}

// Changes one value in a draft by its path of names and indexes.
export function setAt(draft: Draft, path: (string | number)[], value: Draft): Draft {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(draft)) {
    const copy = [...draft];
    copy[head as number] = setAt(copy[head as number] ?? '', rest, value);
    return copy;
  }
  const record = typeof draft === 'object' ? draft : {};
  return { ...record, [head!]: setAt(record[head as string] ?? '', rest, value) };
}
