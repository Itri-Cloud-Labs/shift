import { ShiftError } from '../domain/errors.js';
import type { Json } from '../harness/types.js';
import type { CommandReceipts, CommandResponse } from '../persistence/receipts.js';
import { validatePairRequest } from '../protocol/index.js';
import type { Device, DeviceRegistry, Issuer } from './registry.js';

const commandId = /^[A-Za-z0-9_-]{8,100}$/;

// Device commands for the administrative socket and for paired devices. Pairing keeps its own
// encrypted delivery copy instead of a command receipt, so a bearer token never enters receipts.
export class DeviceService {
  constructor(
    readonly registry: DeviceRegistry,
    private readonly receipts: CommandReceipts,
  ) {}

  pair(input: unknown, address: string): { device: Device; token: string } {
    if (!validatePairRequest(input)) {
      throw new ShiftError(
        'INVALID_REQUEST',
        'Invalid pairing request.',
        422,
        false,
        (validatePairRequest.errors ?? []).map((error) => error.instancePath || '/'),
      );
    }
    return this.registry.pair(input, address);
  }

  issue(issuer: Issuer): { phrase: string; expiresAt: number } {
    return this.registry.issue(issuer);
  }

  // Revocation commits with its receipt; open streams of the device close once it committed.
  revoke(id: string, actor: Issuer, input: unknown): CommandResponse {
    const body = (input ?? {}) as { commandId?: unknown };
    const extra = Object.keys(body).filter((key) => key !== 'commandId');
    if (
      typeof input !== 'object' ||
      input === null ||
      extra.length > 0 ||
      (body.commandId !== undefined &&
        (typeof body.commandId !== 'string' || !commandId.test(body.commandId)))
    ) {
      throw new ShiftError('INVALID_REQUEST', 'Invalid revoke request.', 422, false, ['/']);
    }
    const id_ = body.commandId as string | undefined;
    let revokedNow = false;
    const response = this.receipts.execute(
      actor,
      id_,
      { op: 'device.revoke', deviceId: id },
      () => {
        revokedNow = this.registry.device(id).revokedAt === null;
        return {
          status: 200,
          body: { device: this.registry.revoke(id, actor) as unknown as Json },
        };
      },
    );
    if (revokedNow) this.registry.notifyRevoked(id);
    return response;
  }
}
