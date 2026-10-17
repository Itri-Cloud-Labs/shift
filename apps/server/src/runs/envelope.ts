import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';

export type ResultEnvelope =
  | { status: 'completed'; data: Json }
  | { status: 'blocked'; blocker: { code: string; message: string; details?: Json } }
  | { status: 'failed'; error: { code: string; message: string; details?: Json } };

// Author schemas are ordinary JSON Schema 2020-12: strict-mode lints (union types, unknown
// keywords) would reject valid documents. Every schema is still checked against the meta-schema.
function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    strict: false,
    validateSchema: true,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
  });
  // ajv-formats is CommonJS; its `default` export is the plugin itself under NodeNext typing.
  addFormats.default(ajv);
  return ajv;
}

const problem = {
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 200 },
    message: { type: 'string', minLength: 1, maxLength: 4000 },
    details: {},
  },
  additionalProperties: false,
};

// The fixed Shift terminal envelope (specification 6.5). Completed `data` is validated separately
// against the author's schema, compiled at its own root so its `$ref`s resolve as written.
const envelopeAjv = createAjv();
const validateShape = envelopeAjv.compile({
  oneOf: [
    {
      type: 'object',
      required: ['status', 'data'],
      properties: { status: { const: 'completed' }, data: {} },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['status', 'blocker'],
      properties: { status: { const: 'blocked' }, blocker: problem },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['status', 'error'],
      properties: { status: { const: 'failed' }, error: problem },
      additionalProperties: false,
    },
  ],
});

const compiled = new Map<string, { ajv: Ajv2020; validate: ValidateFunction }>();

// Each business schema gets its own Ajv instance, so `$id`s of different runs cannot collide.
function businessValidator(businessSchema: Json): { ajv: Ajv2020; validate: ValidateFunction } {
  const key = JSON.stringify(businessSchema);
  let entry = compiled.get(key);
  if (!entry) {
    const ajv = createAjv();
    try {
      entry = { ajv, validate: ajv.compile(businessSchema as object | boolean) };
    } catch {
      throw new ShiftError(
        'INVALID_RESULT_SCHEMA',
        'The result schema is not a valid JSON Schema 2020-12 document.',
        422,
      );
    }
    compiled.set(key, entry);
  }
  return entry;
}

// Throws `INVALID_RESULT_SCHEMA` for a schema that cannot be compiled.
export function assertResultSchema(businessSchema: Json): void {
  businessValidator(businessSchema);
}

export function checkEnvelope(
  businessSchema: Json,
  input: unknown,
): { valid: true; envelope: ResultEnvelope } | { valid: false; reason: string } {
  if (!validateShape(input)) {
    const status = (input as { status?: unknown } | null)?.status;
    // A oneOf failure reports every branch; report the branch the agent chose when it chose one.
    const branch = ['completed', 'blocked', 'failed'].indexOf(status as string);
    const errors = (validateShape.errors ?? []).filter(
      (error) => branch < 0 || error.schemaPath.startsWith(`#/oneOf/${branch}/`),
    );
    const reason = envelopeAjv.errorsText(errors.length ? errors : validateShape.errors, {
      dataVar: 'result',
    });
    return { valid: false, reason: reason.slice(0, 1000) };
  }
  const envelope = input as ResultEnvelope;
  if (envelope.status === 'completed') {
    const { ajv, validate } = businessValidator(businessSchema);
    if (!validate(envelope.data)) {
      const reason = ajv.errorsText(validate.errors, { dataVar: 'result/data' });
      return { valid: false, reason: reason.slice(0, 1000) };
    }
  }
  return { valid: true, envelope };
}
