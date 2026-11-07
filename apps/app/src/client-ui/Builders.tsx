import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  addField,
  blankComparison,
  convertValue,
  emptyToUndefined,
  formDepth,
  formFormats,
  freeName,
  kindOf,
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
  ruleDepth,
  setField,
  setRequired,
  validName,
  valueKind,
  valueText,
  withKind,
  withOperator,
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
type Option = [value: string, label: string, disabled?: boolean];

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
  options: Option[];
  change: (value: string) => void;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => change(event.target.value)}>
        {options.map(([option, text, disabled]) => (
          <option key={option} value={option} disabled={disabled}>
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

function Check({
  label,
  checked,
  change,
}: {
  label: string;
  checked: boolean;
  change: (checked: boolean) => void;
}) {
  return (
    <div className="field">
      <label className="field-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => change(event.target.checked)}
        />
        {label}
      </label>
    </div>
  );
}

const valueKinds: Option[] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['boolean', 'Yes or no'],
  ['list', 'List'],
  ['null', 'Empty'],
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
      {kind === 'null' ? (
        <p className="note builder-pair-note">No value.</p>
      ) : kind === 'boolean' ? (
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

// Run variables, session and artifact metadata are not on the server yet: offered, never
// selectable, so nothing claims they run.
const sourceKinds: Option[] = [
  ['input', 'What came in'],
  ['trigger', 'The run’s input'],
  ['node', 'An earlier node'],
  ['project', 'Project settings'],
  ['literal', 'A fixed value'],
  ['variable', 'A run variable (not on this server yet)', true],
  ['session', 'Agent session details (not on this server yet)', true],
  ['artifact', 'An artifact (not on this server yet)', true],
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

// Nodes a run can pass before reaching `nodeId`: only their results can be read.
function before(document: GraphDocument, nodeId: string): Set<string> {
  const found = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.pop()!;
    for (const connection of document.connections)
      if (connection.toNodeId === current && !found.has(connection.fromNodeId)) {
        found.add(connection.fromNodeId);
        queue.push(connection.fromNodeId);
      }
  }
  return found;
}

const selectors: Option[] = [
  ['latest', 'Its latest result'],
  ['first', 'Its first result'],
  ['sequence', 'A numbered execution'],
];

function NodeSource({
  id,
  source,
  document,
  nodeId,
  set,
}: {
  id: string;
  source: Raw;
  document: GraphDocument;
  nodeId: string;
  set: (source: Raw) => void;
}) {
  const earlier = before(document, nodeId);
  const target = String(source['nodeId']);
  const execution = source['execution'];
  const selector =
    execution === 'latest' || execution === 'first'
      ? execution
      : typeof (execution as Raw | null)?.['sequence'] === 'number'
        ? 'sequence'
        : 'kept';
  const optional = source['optional'] === true;
  return (
    <>
      <Choice
        id={`${id}-node`}
        label="Node"
        value={target}
        options={[
          ...document.nodes
            .filter((item) => item.id !== nodeId || earlier.has(nodeId))
            .map((item): Option => [
              item.id,
              earlier.has(item.id) ? item.id : `${item.id} (no path from it to here)`,
            ]),
          ...(document.nodes.some((item) => item.id === target)
            ? []
            : ([[target, `${target} (missing)`]] as Option[])),
        ]}
        change={(next) => set({ ...source, nodeId: next })}
      />
      {selector === 'kept' ? (
        <p className="note">It reads one exact execution, kept as it is.</p>
      ) : (
        <div className="builder-pair">
          <Choice
            id={`${id}-execution`}
            label="Which result"
            value={selector}
            options={selectors}
            change={(next) =>
              set({ ...source, execution: next === 'sequence' ? { sequence: 1 } : next })
            }
          />
          {selector === 'sequence' && (
            <TextField
              id={`${id}-sequence`}
              label="Execution number"
              numeric
              value={String((execution as Raw)['sequence'])}
              note="As numbered in the run's history."
              commit={(text) => {
                const sequence = Number(text);
                if (Number.isInteger(sequence) && sequence >= 1)
                  set({ ...source, execution: { sequence } });
              }}
            />
          )}
        </div>
      )}
      <Check
        label="Optional: use a fallback when it has no value"
        checked={optional}
        change={(checked) => {
          const { optional: _optional, fallback: _fallback, ...rest } = source;
          set(checked ? { ...rest, optional: true, fallback: source['fallback'] ?? null } : rest);
        }}
      />
      {optional && (
        <ValueField
          id={`${id}-fallback`}
          label="Fallback"
          value={source['fallback']}
          change={(fallback) => set({ ...source, fallback })}
        />
      )}
    </>
  );
}

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
        const known = sourceKinds.some(
          ([kind, , disabled]) => kind === source['kind'] && !disabled,
        );
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
              <NodeSource
                id={id}
                source={source}
                document={document}
                nodeId={node.id}
                set={(next) => editing.set(name, next)}
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
          ...names.map((name): Option => [
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
}: {
  id: string;
  comparison: Comparison;
  bindings: string[];
  change: (comparison: Comparison) => void;
}) {
  return (
    <>
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
    </>
  );
}

// One test or a group of rules, each of which may be a group again, up to the server's depth.
export function RuleBuilder({
  id,
  rule,
  bindings,
  problem,
  depth = 0,
  change,
  remove,
}: {
  id: string;
  rule: unknown;
  bindings: string[];
  problem?: string | undefined;
  depth?: number;
  change: (rule: unknown) => void;
  remove?: (() => void) | null;
}) {
  if (rule === undefined)
    return (
      <div className="field">
        <Add label="Add a test" add={() => change(blankComparison(bindings))} />
        {problem && <p className="field-error">{problem}</p>}
      </div>
    );
  const view = readRule(rule);
  const removeButton = remove && (
    <button type="button" className="button quiet" onClick={remove}>
      <Trash2 aria-hidden="true" />
      {view.kind === 'group' ? 'Remove this group' : 'Remove this test'}
    </button>
  );
  if (view.kind === 'kept')
    return (
      <div className="builder-row">
        <p className="note">This rule has no form here. It is kept as it is and still runs.</p>
        {removeButton}
      </div>
    );
  if (view.kind === 'test')
    return (
      <div className={depth === 0 ? 'builder-rule' : 'builder-row'}>
        <ComparisonRow id={id} comparison={view.comparison} bindings={bindings} change={change} />
        {removeButton}
        {depth === 0 && (
          <Add label="Add a test" add={() => change({ all: [rule, blankComparison(bindings)] })} />
        )}
      </div>
    );
  const { group, items } = view;
  const write = (next: unknown[]) => change({ [group]: next });
  return (
    <div className={depth === 0 ? 'builder-rule' : 'builder-group'}>
      <Choice
        id={`${id}-group`}
        label="Holds when"
        value={group}
        options={[
          ['all', 'All of these hold'],
          ['any', 'Any of these holds'],
        ]}
        change={(next) => change({ [next]: items })}
      />
      {items.map((item, index) => (
        <RuleBuilder
          key={index}
          id={`${id}-${index}`}
          rule={item}
          bindings={bindings}
          depth={depth + 1}
          change={(next) => write(items.map((other, at) => (at === index ? next : other)))}
          remove={
            items.length > 1 ? () => write(items.filter((_, at) => at !== index)) : (remove ?? null)
          }
        />
      ))}
      <div className="actions builder-actions">
        <Add label="Add a test" add={() => write([...items, blankComparison(bindings)])} />
        {depth + 1 < ruleDepth && (
          <Add
            label="Add a group"
            add={() =>
              write([...items, { [group === 'all' ? 'any' : 'all']: [blankComparison(bindings)] }])
            }
          />
        )}
      </div>
      {depth > 0 && removeButton}
      {problem && <p className="field-error">{problem}</p>}
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

// The fields of one object in the data, each a value, a binding or a group of fields again.
function DataFields({
  id,
  data,
  bindings,
  set,
}: {
  id: string;
  data: Raw;
  bindings: string[];
  set: (data: Raw) => void;
}) {
  const [nameProblem, setNameProblem] = useState<{ key: string; text: string } | null>(null);
  return (
    <>
      {Object.keys(data).length === 0 && <p className="note">No fields yet.</p>}
      {Object.entries(data).map(([key, value], index) => {
        const at = `${id}-${index}`;
        const read = readDataValue(value);
        const put = (next: unknown) => set({ ...data, [key]: next });
        return (
          <div className="builder-row" key={index}>
            <div className="builder-row-head">
              <TextField
                id={`${at}-key`}
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
              <p className="note">This field has no form here. It is kept as it is.</p>
            ) : read.kind === 'object' ? (
              <div className="builder-group">
                <DataFields id={at} data={value as Raw} bindings={bindings} set={put} />
                <div className="actions builder-actions">
                  <Add
                    label="Add a field inside"
                    add={() =>
                      put({ ...(value as Raw), [freeName('field', Object.keys(value as Raw))]: '' })
                    }
                  />
                  <button type="button" className="button quiet" onClick={() => put('')}>
                    Make it a single value
                  </button>
                </div>
              </div>
            ) : (
              <>
                <OperandField
                  id={`${at}-value`}
                  label="Value"
                  operand={read.kind === 'binding' ? { binding: read.name } : { value: read.value }}
                  bindings={bindings}
                  list={false}
                  change={(operand) =>
                    put('binding' in operand ? { $binding: operand.binding } : operand.value)
                  }
                />
                <button type="button" className="button quiet" onClick={() => put({ field: '' })}>
                  Make it a group of fields
                </button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

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
  if (given !== undefined && (typeof given !== 'object' || given === null || Array.isArray(given)))
    return <p className="note">This node builds a single value. It is kept as it is.</p>;
  const data = (given ?? {}) as Raw;
  return (
    <fieldset className="field-group">
      <legend>Data it builds</legend>
      <DataFields
        id={`${node.id}-data`}
        data={data}
        bindings={Object.keys(node.bindings)}
        set={set}
      />
      {problem && <p className="field-error">{problem}</p>}
      <Add
        label="Add a field"
        add={() => set({ ...data, [freeName('field', Object.keys(data))]: '' })}
      />
    </fieldset>
  );
}

// ---------- Forms and schemas ----------

const allKinds: [FieldKind, string][] = [
  ['text', 'Text'],
  ['number', 'Number'],
  ['integer', 'Whole number'],
  ['boolean', 'Yes or no'],
  ['choice', 'Choice'],
  ['object', 'Group of fields'],
  ['array', 'List'],
];

// A keyword holding a number, removed when left empty.
function NumberKeyword({
  id,
  label,
  schema,
  name,
  set,
}: {
  id: string;
  label: string;
  schema: Raw;
  name: string;
  set: (schema: Raw) => void;
}) {
  const value = schema[name];
  return (
    <TextField
      id={id}
      label={label}
      numeric
      value={typeof value === 'number' ? String(value) : ''}
      commit={(text) => {
        const { [name]: _old, ...rest } = schema;
        const number = Number(text);
        if (text.trim() === '') set(rest);
        else if (Number.isFinite(number)) set({ ...rest, [name]: number });
      }}
    />
  );
}

interface Depth {
  // How deep this field is, and how deep groups and lists may go.
  level: number;
  limit: number;
}

// What a field is, apart from its name: its label, type and the settings of that type. Used for
// named fields and for the items of a list.
function FieldBody({
  id,
  schema,
  depth,
  set,
}: {
  id: string;
  schema: Raw;
  depth: Depth;
  set: (schema: Raw) => void;
}) {
  const kind = kindOf(schema);
  const nests = depth.level + 1 < depth.limit;
  const text = (name: string, label: string, multiline = false) => (
    <TextField
      id={`${id}-${name}`}
      label={label}
      multiline={multiline}
      value={typeof schema[name] === 'string' ? (schema[name] as string) : ''}
      commit={(value) => {
        const { [name]: _old, ...rest } = schema;
        set(value ? { ...rest, [name]: value } : rest);
      }}
    />
  );
  if (!kind) return <p className="note">This field has no form here. It is kept as it is.</p>;
  return (
    <>
      {text('title', 'Label (optional)')}
      {text('description', 'Help text (optional)')}
      <Choice
        id={`${id}-type`}
        label="Type"
        value={kind}
        options={allKinds.map(([value, label]): Option => [
          value,
          label,
          (value === 'object' || value === 'array') && !nests && kind !== value,
        ])}
        change={(next) => set(withKind(schema, next as FieldKind))}
      />
      {kind === 'choice' && (
        <TextField
          id={`${id}-options`}
          label="Options"
          value={valueText(schema['enum'])}
          note="Separated by commas."
          commit={(value) =>
            set({ ...schema, enum: [...new Set(parseValue('list', value) as string[])] })
          }
        />
      )}
      {kind === 'text' && (
        <>
          <div className="builder-pair">
            <NumberKeyword
              id={`${id}-min-length`}
              label="Shortest"
              schema={schema}
              name="minLength"
              set={set}
            />
            <NumberKeyword
              id={`${id}-max-length`}
              label="Longest"
              schema={schema}
              name="maxLength"
              set={set}
            />
          </div>
          <Choice
            id={`${id}-format`}
            label="Format"
            value={typeof schema['format'] === 'string' ? schema['format'] : ''}
            options={[
              ['', 'Any text'],
              ...formFormats.map((format): Option => [format, format]),
              ...(typeof schema['format'] === 'string' && !formFormats.includes(schema['format'])
                ? ([[schema['format'], schema['format']]] as Option[])
                : []),
            ]}
            change={(format) => {
              const { format: _old, ...rest } = schema;
              set(format ? { ...rest, format } : rest);
            }}
          />
        </>
      )}
      {(kind === 'number' || kind === 'integer') && (
        <div className="builder-pair">
          <NumberKeyword
            id={`${id}-minimum`}
            label="At least"
            schema={schema}
            name="minimum"
            set={set}
          />
          <NumberKeyword
            id={`${id}-maximum`}
            label="At most"
            schema={schema}
            name="maximum"
            set={set}
          />
        </div>
      )}
      {kind === 'object' && (
        <div className="builder-group">
          <SchemaFields
            id={`${id}-fields`}
            schema={schema}
            depth={{ ...depth, level: depth.level + 1 }}
            set={set}
            empty="No fields inside yet."
          />
        </div>
      )}
      {kind === 'array' && (
        <>
          <div className="builder-pair">
            <NumberKeyword
              id={`${id}-min-items`}
              label="Fewest items"
              schema={schema}
              name="minItems"
              set={set}
            />
            <NumberKeyword
              id={`${id}-max-items`}
              label="Most items"
              schema={schema}
              name="maxItems"
              set={set}
            />
          </div>
          <fieldset className="field-group builder-group">
            <legend>Each item</legend>
            <FieldBody
              id={`${id}-items`}
              schema={(schema['items'] ?? {}) as Raw}
              depth={{ ...depth, level: depth.level + 1 }}
              set={(items) => set({ ...schema, items })}
            />
          </fieldset>
        </>
      )}
    </>
  );
}

function SchemaFields({
  id,
  schema,
  depth,
  empty,
  set,
}: {
  id: string;
  schema: unknown;
  depth: Depth;
  empty: string;
  set: (schema: Raw) => void;
}) {
  const [nameProblem, setNameProblem] = useState<{ name: string; text: string } | null>(null);
  const fields = readFields(schema);
  if (!fields) return <p className="note">This schema has no form here. It is kept as it is.</p>;
  return (
    <>
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
                    set(renameField(schema, field.name, next));
                  }
                }}
              />
              <Remove
                label={`Remove field ${field.name}`}
                remove={() => set(removeField(schema, field.name))}
              />
            </div>
            <FieldBody
              id={at}
              schema={field.schema}
              depth={depth}
              set={(next) => set(setField(schema, field.name, next))}
            />
            <Check
              label="Required"
              checked={field.required}
              change={(required) => set(setRequired(schema, field.name, required))}
            />
          </div>
        );
      })}
      <Add label="Add a field" add={() => set(addField(schema))} />
    </>
  );
}

export function SchemaBuilder({
  id,
  legend,
  empty,
  schema,
  form,
  keepEmpty,
  problem,
  set,
}: {
  id: string;
  legend: string;
  empty: string;
  schema: unknown;
  // A human form follows the server's form dialect, which nests at most four levels.
  form?: boolean;
  // Where the node requires a schema even without fields.
  keepEmpty?: boolean;
  problem?: string | undefined;
  set: (schema: unknown) => void;
}) {
  return (
    <fieldset className="field-group">
      <legend>{legend}</legend>
      <SchemaFields
        id={id}
        schema={schema}
        depth={{ level: 0, limit: form ? formDepth : 8 }}
        empty={empty}
        set={(next) => set(keepEmpty ? next : emptyToUndefined(next))}
      />
      {problem && <p className="field-error">{problem}</p>}
    </fieldset>
  );
}
