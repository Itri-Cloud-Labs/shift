import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  addField,
  blankComparison,
  convertValue,
  emptyToUndefined,
  freeName,
  operators,
  parsePath,
  parseValue,
  pathEditable,
  pathText,
  readDataValue,
  readFields,
  readRule,
  removeField,
  renameField,
  renameKey,
  setField,
  setRequired,
  validName,
  valueKind,
  valueText,
  withKind,
  withOperator,
  writeRule,
  type Comparison,
  type FieldKind,
  type Operand,
  type ValueKind,
} from './config.js';
import { TextField } from './Fields.js';
import type { DocumentNode, GraphDocument } from './graph.js';

// Widgets for what a node reads and decides, so a workflow needs no hand-written JSON. A shape they
// cannot show is said to be kept, and an edit elsewhere leaves it as it came.

type Raw = Record<string, unknown>;

function Choice({
  id,
  label,
  value,
  options,
  change,
}: {
  id: string;
  label: string;
  value: string;
  options: [string, string][];
  change: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => change(event.target.value)}>
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function Remove({ label, remove }: { label: string; remove: () => void }) {
  return (
    <button type="button" className="button quiet icon" aria-label={label} onClick={remove}>
      <Trash2 />
    </button>
  );
}

function Add({ label, add }: { label: string; add: () => void }) {
  return (
    <button type="button" className="button quiet" onClick={add}>
      <Plus aria-hidden="true" />
      {label}
    </button>
  );
}

const valueKinds: [ValueKind, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['boolean', 'Yes or no'],
  ['list', 'List'],
];

// A fixed value, with its type chosen rather than guessed from what is typed.
function ValueField({
  id,
  label,
  value,
  change,
}: {
  id: string;
  label: string;
  value: unknown;
  change: (value: unknown) => void;
}) {
  const kind = valueKind(value);
  if (kind === 'kept') return <p className="note">This value is nested. It is kept as it is.</p>;
  return (
    <div className="builder-pair">
      <Choice
        id={`${id}-kind`}
        label="Type"
        value={kind}
        options={valueKinds}
        change={(next) => change(convertValue(value, next as ValueKind))}
      />
      {kind === 'boolean' ? (
        <Choice
          id={id}
          label={label}
          value={String(value)}
          options={[
            ['true', 'Yes'],
            ['false', 'No'],
          ]}
          change={(next) => change(next === 'true')}
        />
      ) : (
        <TextField
          id={id}
          label={label}
          value={valueText(value)}
          numeric={kind === 'number'}
          {...(kind === 'list' ? { note: 'Separated by commas.' } : {})}
          commit={(text) => {
            const parsed = parseValue(kind, text);
            if (parsed !== undefined) change(parsed);
          }}
        />
      )}
    </div>
  );
}

// ---------- Values a node reads ----------

const sourceKinds: [string, string][] = [
  ['input', 'What came in'],
  ['trigger', 'The run’s input'],
  ['node', 'An earlier node'],
  ['project', 'Project settings'],
  ['literal', 'A fixed value'],
];

const startingSource = (kind: string, document: GraphDocument, nodeId: string): Raw => {
  if (kind === 'literal') return { kind, value: '' };
  if (kind === 'node')
    return {
      kind,
      nodeId: document.nodes.find((node) => node.id !== nodeId)?.id ?? '',
      execution: 'latest',
      path: [],
    };
  return { kind, path: [] };
};

export interface BindingEditing {
  set: (name: string, source: unknown) => void;
  rename: (from: string, to: string) => string | null;
}

export function BindingsBuilder({
  document,
  node,
  editing,
}: {
  document: GraphDocument;
  node: DocumentNode;
  editing: BindingEditing;
}) {
  const [problem, setProblem] = useState<{ name: string; text: string } | null>(null);
  const entries = Object.entries(node.bindings) as [string, Raw][];
  return (
    <fieldset className="field-group">
      <legend>Values it reads</legend>
      {entries.length === 0 && (
        <p className="note">
          It gets what the node before it produced. Name a value here to use it by name.
        </p>
      )}
      {entries.map(([name, source], index) => {
        const id = `${node.id}-binding-${index}`;
        const known = sourceKinds.some(([kind]) => kind === source['kind']);
        return (
          <div className="builder-row" key={index}>
            <div className="builder-row-head">
              <TextField
                id={`${id}-name`}
                label="Name"
                value={name}
                problem={problem?.name === name ? problem.text : undefined}
                commit={(next) => {
                  const text = editing.rename(name, next);
                  setProblem(text ? { name, text } : null);
                }}
              />
              <Remove label={`Remove value ${name}`} remove={() => editing.set(name, undefined)} />
            </div>
            {known ? (
              <Choice
                id={`${id}-kind`}
                label="Comes from"
                value={String(source['kind'])}
                options={sourceKinds}
                change={(kind) => editing.set(name, startingSource(kind, document, node.id))}
              />
            ) : (
              <p className="note">This source is kept as it is.</p>
            )}
            {source['kind'] === 'node' && (
              <Choice
                id={`${id}-node`}
                label="Node"
                value={String(source['nodeId'])}
                options={[
                  ...document.nodes.map((item): [string, string] => [item.id, item.id]),
                  ...(document.nodes.some((item) => item.id === source['nodeId'])
                    ? []
                    : ([[String(source['nodeId']), `${String(source['nodeId'])} (missing)`]] as [
                        string,
                        string,
                      ][])),
                ]}
                change={(nodeId) => editing.set(name, { ...source, nodeId })}
              />
            )}
            {source['kind'] === 'literal' && (
              <ValueField
                id={`${id}-value`}
                label="Value"
                value={source['value']}
                change={(value) => editing.set(name, { ...source, value })}
              />
            )}
            {known &&
              source['kind'] !== 'literal' &&
              (pathEditable(source['path']) ? (
                <TextField
                  id={`${id}-path`}
                  label="Field (optional)"
                  value={pathText(source['path'])}
                  placeholder="data.files"
                  note="Dots step inside. Empty reads the whole value."
                  commit={(text) => editing.set(name, { ...source, path: parsePath(text) })}
                />
              ) : (
                <p className="note">This field’s path is kept as it is.</p>
              ))}
          </div>
        );
      })}
      <Add
        label="Add a value"
        add={() =>
          editing.set(
            freeName('value', Object.keys(node.bindings)),
            startingSource('input', document, node.id),
          )
        }
      />
    </fieldset>
  );
}

// ---------- Rules ----------

function OperandField({
  id,
  label,
  operand,
  bindings,
  list,
  change,
}: {
  id: string;
  label: string;
  operand: Operand;
  bindings: string[];
  list: boolean;
  change: (operand: Operand) => void;
}) {
  const fixed = 'value' in operand;
  const names =
    !fixed && !bindings.includes(operand.binding) ? [...bindings, operand.binding] : bindings;
  return (
    <>
      <Choice
        id={`${id}-source`}
        label={label}
        value={fixed ? '' : `=${operand.binding}`}
        options={[
          ...names.map((name): [string, string] => [
            `=${name}`,
            bindings.includes(name) ? name : `${name} (not declared)`,
          ]),
          ['', 'A fixed value'],
        ]}
        change={(next) => change(next ? { binding: next.slice(1) } : { value: list ? [] : '' })}
      />
      {fixed && (
        <ValueField
          id={`${id}-value`}
          label="Value"
          value={operand.value}
          change={(value) => change({ value })}
        />
      )}
    </>
  );
}

function ComparisonRow({
  id,
  comparison,
  bindings,
  change,
  remove,
}: {
  id: string;
  comparison: Comparison;
  bindings: string[];
  change: (comparison: Comparison) => void;
  remove: (() => void) | null;
}) {
  return (
    <div className="builder-row">
      <OperandField
        id={`${id}-left`}
        label="Compare"
        operand={comparison.left}
        bindings={bindings}
        list={false}
        change={(left) => change({ ...comparison, left })}
      />
      <Choice
        id={`${id}-op`}
        label="Test"
        value={comparison.op}
        options={operators}
        change={(op) => change(withOperator(comparison, op))}
      />
      {comparison.right && (
        <OperandField
          id={`${id}-right`}
          label="With"
          operand={comparison.right}
          bindings={bindings}
          list={comparison.op === 'in'}
          change={(right) => change({ ...comparison, right })}
        />
      )}
      {remove && (
        <button type="button" className="button quiet" onClick={remove}>
          <Trash2 aria-hidden="true" />
          Remove this test
        </button>
      )}
    </div>
  );
}

export function RuleBuilder({
  id,
  rule,
  bindings,
  problem,
  change,
}: {
  id: string;
  rule: unknown;
  bindings: string[];
  problem?: string | undefined;
  change: (rule: unknown) => void;
}) {
  if (rule === undefined)
    return (
      <div className="field">
        <Add label="Add a test" add={() => change(blankComparison(bindings))} />
        {problem && <p className="field-error">{problem}</p>}
      </div>
    );
  const shape = readRule(rule);
  if (!shape)
    return <p className="note">This rule nests groups. It is kept as it is and still runs.</p>;
  const write = (items: Comparison[]) => change(writeRule({ ...shape, items }));
  return (
    <div className="builder-rule">
      {shape.items.length > 1 && (
        <Choice
          id={`${id}-group`}
          label="Holds when"
          value={shape.group}
          options={[
            ['all', 'All of these hold'],
            ['any', 'Any of these holds'],
          ]}
          change={(group) => change({ [group]: shape.items })}
        />
      )}
      {shape.items.map((comparison, index) => (
        <ComparisonRow
          key={index}
          id={`${id}-${index}`}
          comparison={comparison}
          bindings={bindings}
          change={(next) => write(shape.items.map((item, at) => (at === index ? next : item)))}
          remove={
            shape.items.length > 1 ? () => write(shape.items.filter((_, at) => at !== index)) : null
          }
        />
      ))}
      <Add label="Add a test" add={() => write([...shape.items, blankComparison(bindings)])} />
    </div>
  );
}

export function CasesBuilder({
  node,
  set,
  rename,
}: {
  node: DocumentNode;
  set: (cases: unknown) => void;
  rename: (index: number, next: string) => string | null;
}) {
  const [problem, setProblem] = useState<{ index: number; text: string } | null>(null);
  const cases = (Array.isArray(node.config['cases']) ? node.config['cases'] : []) as Raw[];
  const bindings = Object.keys(node.bindings);
  const move = (index: number, by: number) => {
    const next = [...cases];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    set(next);
  };
  return (
    <fieldset className="field-group">
      <legend>Cases, first match wins</legend>
      {cases.map((item, index) => {
        const port = String(item['port'] ?? '');
        return (
          <div className="builder-row" key={index}>
            <div className="builder-row-head">
              <TextField
                id={`${node.id}-case-${index}`}
                label="Port"
                value={port}
                problem={problem?.index === index ? problem.text : undefined}
                commit={(next) => {
                  const text = rename(index, next);
                  setProblem(text ? { index, text } : null);
                }}
              />
              <button
                type="button"
                className="button quiet icon"
                aria-label={`Move case ${port} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </button>
              <button
                type="button"
                className="button quiet icon"
                aria-label={`Move case ${port} down`}
                disabled={index === cases.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </button>
              <Remove
                label={`Remove case ${port}`}
                remove={() => set(cases.filter((_, at) => at !== index))}
              />
            </div>
            <RuleBuilder
              id={`${node.id}-case-${index}-rule`}
              rule={item['when']}
              bindings={bindings}
              change={(when) =>
                set(cases.map((other, at) => (at === index ? { ...other, when } : other)))
              }
            />
          </div>
        );
      })}
      <p className="note">When no case matches, the run takes the default port.</p>
      <Add
        label="Add a case"
        add={() =>
          set([
            ...cases,
            {
              port: freeName(
                'case',
                cases.map((item) => String(item['port'])),
              ),
              when: blankComparison(bindings),
            },
          ])
        }
      />
    </fieldset>
  );
}

// ---------- A Transform's data ----------

export function DataBuilder({
  node,
  problem,
  set,
}: {
  node: DocumentNode;
  problem?: string | undefined;
  set: (data: unknown) => void;
}) {
  const given = node.config['data'];
  const [nameProblem, setNameProblem] = useState<{ key: string; text: string } | null>(null);
  if (given !== undefined && (typeof given !== 'object' || given === null || Array.isArray(given)))
    return <p className="note">This node builds a single value. It is kept as it is.</p>;
  const data = (given ?? {}) as Raw;
  const bindings = Object.keys(node.bindings);
  return (
    <fieldset className="field-group">
      <legend>Data it builds</legend>
      {Object.keys(data).length === 0 && <p className="note">No fields yet.</p>}
      {Object.entries(data).map(([key, value], index) => {
        const id = `${node.id}-data-${index}`;
        const read = readDataValue(value);
        const put = (next: unknown) => set({ ...data, [key]: next });
        return (
          <div className="builder-row" key={index}>
            <div className="builder-row-head">
              <TextField
                id={`${id}-key`}
                label="Field"
                value={key}
                problem={nameProblem?.key === key ? nameProblem.text : undefined}
                commit={(next) => {
                  if (!next || (next !== key && next in data))
                    setNameProblem({ key, text: 'Use a name no other field has.' });
                  else {
                    setNameProblem(null);
                    set(renameKey(data, key, next));
                  }
                }}
              />
              <Remove
                label={`Remove field ${key}`}
                remove={() => {
                  const { [key]: _gone, ...rest } = data;
                  set(rest);
                }}
              />
            </div>
            {read.kind === 'kept' ? (
              <p className="note">This field is nested. It is kept as it is.</p>
            ) : (
              <OperandField
                id={`${id}-value`}
                label="Value"
                operand={read.kind === 'binding' ? { binding: read.name } : { value: read.value }}
                bindings={bindings}
                list={false}
                change={(operand) =>
                  put('binding' in operand ? { $binding: operand.binding } : operand.value)
                }
              />
            )}
          </div>
        );
      })}
      {problem && <p className="field-error">{problem}</p>}
      <Add
        label="Add a field"
        add={() => set({ ...data, [freeName('field', Object.keys(data))]: '' })}
      />
    </fieldset>
  );
}

// ---------- Forms and schemas ----------

const fieldKinds: [FieldKind, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['integer', 'Whole number'],
  ['boolean', 'Yes or no'],
  ['choice', 'Choice'],
];

export function SchemaBuilder({
  id,
  legend,
  empty,
  schema,
  keepEmpty,
  problem,
  set,
}: {
  id: string;
  legend: string;
  empty: string;
  schema: unknown;
  // Where the node requires a schema even without fields.
  keepEmpty?: boolean;
  problem?: string | undefined;
  set: (schema: unknown) => void;
}) {
  const [nameProblem, setNameProblem] = useState<{ name: string; text: string } | null>(null);
  const fields = readFields(schema);
  if (!fields)
    return (
      <fieldset className="field-group">
        <legend>{legend}</legend>
        <p className="note">This schema has no plain form. It is kept as it is.</p>
      </fieldset>
    );
  const write = (next: Raw) => set(keepEmpty ? next : emptyToUndefined(next));
  return (
    <fieldset className="field-group">
      <legend>{legend}</legend>
      {fields.length === 0 && <p className="note">{empty}</p>}
      {fields.map((field, index) => {
        const at = `${id}-${index}`;
        return (
          <div className="builder-row" key={index}>
            <div className="builder-row-head">
              <TextField
                id={`${at}-name`}
                label="Name"
                value={field.name}
                problem={nameProblem?.name === field.name ? nameProblem.text : undefined}
                commit={(next) => {
                  if (
                    !validName(next) ||
                    (next !== field.name && fields.some((other) => other.name === next))
                  )
                    setNameProblem({
                      name: field.name,
                      text: 'Use a letter first and a name no other field has.',
                    });
                  else {
                    setNameProblem(null);
                    write(renameField(schema, field.name, next));
                  }
                }}
              />
              <Remove
                label={`Remove field ${field.name}`}
                remove={() => write(removeField(schema, field.name))}
              />
            </div>
            {field.kind ? (
              <>
                <TextField
                  id={`${at}-title`}
                  label="Label (optional)"
                  value={typeof field.schema['title'] === 'string' ? field.schema['title'] : ''}
                  commit={(title) => {
                    const { title: _old, ...rest } = field.schema;
                    write(setField(schema, field.name, title ? { ...rest, title } : rest));
                  }}
                />
                <Choice
                  id={`${at}-type`}
                  label="Type"
                  value={field.kind}
                  options={fieldKinds}
                  change={(kind) =>
                    write(setField(schema, field.name, withKind(field.schema, kind as FieldKind)))
                  }
                />
                {field.kind === 'choice' && (
                  <TextField
                    id={`${at}-options`}
                    label="Options"
                    value={valueText(field.schema['enum'])}
                    note="Separated by commas."
                    commit={(text) =>
                      write(
                        setField(schema, field.name, {
                          ...field.schema,
                          enum: [...new Set(parseValue('list', text) as string[])],
                        }),
                      )
                    }
                  />
                )}
              </>
            ) : (
              <p className="note">This field is nested. It is kept as it is.</p>
            )}
            <div className="field">
              <label className="field-check">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(event) => write(setRequired(schema, field.name, event.target.checked))}
                />
                Required
              </label>
            </div>
          </div>
        );
      })}
      {problem && <p className="field-error">{problem}</p>}
      <Add label="Add a field" add={() => write(addField(schema))} />
    </fieldset>
  );
}
