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
const ajv = new Ajv2020({
  strict: false,
  validateSchema: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
});
// ajv-formats is CommonJS; its `default` export is the plugin itself under NodeNext typing.
addFormats.default(ajv);

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

// The fixed Shift terminal envelope around an author's business schema (specification 6.5).
// Only `completed` data must satisfy the business schema; a blocker never invents success fields.
export function envelopeSchema(businessSchema: Json): Json {
  return {
    oneOf: [
      {
        type: 'object',
        required: ['status', 'data'],
        properties: { status: { const: 'completed' }, data: businessSchema },
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
  } as Json;
}

const compiled = new Map<string, ValidateFunction>();

export function envelopeValidator(businessSchema: Json): ValidateFunction {
  const key = JSON.stringify(businessSchema);
  let validate = compiled.get(key);
  if (!validate) {
    try {
      validate = ajv.compile(envelopeSchema(businessSchema) as object);
    } catch {
      throw new ShiftError(
        'INVALID_RESULT_SCHEMA',
        'The result schema is not a valid JSON Schema 2020-12 document.',
        422,
      );
    }
    compiled.set(key, validate);
  }
  return validate;
}

export function checkEnvelope(
  businessSchema: Json,
  input: unknown,
): { valid: true; envelope: ResultEnvelope } | { valid: false; reason: string } {
  const validate = envelopeValidator(businessSchema);
  if (validate(input)) return { valid: true, envelope: input as ResultEnvelope };
  const status = (input as { status?: unknown } | null)?.status;
  // A oneOf failure reports every branch; report the branch the agent chose when it chose one.
  const branch = ['completed', 'blocked', 'failed'].indexOf(status as string);
  const errors = (validate.errors ?? []).filter(
    (error) => branch < 0 || error.schemaPath.startsWith(`#/oneOf/${branch}/`),
  );
  const reason = ajv.errorsText(errors.length ? errors : validate.errors, { dataVar: 'result' });
  return { valid: false, reason: reason.slice(0, 1000) };
}
