export class ShiftError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
    readonly retryable = false,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ShiftError';
  }
}

// Raw exception messages can contain credentials, paths or command arguments.
export function publicError(error: unknown): ShiftError {
  return error instanceof ShiftError
    ? error
    : new ShiftError('INTERNAL_ERROR', 'The operation could not be completed.');
}
