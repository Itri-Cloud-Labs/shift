import { ClientCore, ClientFailure, validFoundationResponse } from '../client-core/runtime.js';
import { parseRequest, parseResponse, type DesktopResponse } from '../shared/contracts.js';
import {
  DOCUMENTATION_URL,
  validExternalLink,
  validSender,
  type SenderContext,
} from './security.js';

export async function dispatch(
  core: ClientCore,
  sender: SenderContext,
  value: unknown,
  openExternal: (url: string) => Promise<void>,
): Promise<DesktopResponse> {
  if (!validSender(sender))
    return {
      kind: 'error',
      code: 'FORBIDDEN',
      message: 'This frame cannot use the desktop bridge.',
    };
  const request = parseRequest(value);
  if (!request)
    return { kind: 'error', code: 'INVALID_REQUEST', message: 'The desktop request is invalid.' };
  let response: DesktopResponse;
  try {
    switch (request.kind) {
      case 'shell.read':
        response = { kind: 'shell', state: core.shell() };
        break;
      case 'samples.set':
        response = { kind: 'shell', state: core.setSamples(request.enabled) };
        break;
      case 'server.query':
        response = {
          kind: 'server',
          operation: request.operation,
          value: await core.query(request.operation),
        };
        break;
      case 'desktop.openDocumentation':
        if (!validExternalLink(DOCUMENTATION_URL)) throw new Error('Invalid link');
        await openExternal(DOCUMENTATION_URL);
        response = { kind: 'opened' };
        break;
    }
    if (
      !parseResponse(response) ||
      (response.kind === 'server' && !validFoundationResponse(response.operation, response.value))
    ) {
      return {
        kind: 'error',
        code: 'INVALID_RESPONSE',
        message: 'The server response is invalid.',
      };
    }
    return response;
  } catch (error) {
    if (error instanceof ClientFailure)
      return {
        kind: 'error',
        code: error.code,
        message:
          error.code === 'DISCONNECTED'
            ? 'Connect to a server before querying it.'
            : 'The server response is invalid.',
      };
    return { kind: 'error', code: 'UNAVAILABLE', message: 'The desktop operation is unavailable.' };
  }
}
