import type { ServerInfo, ProtocolError } from '../src/protocol/index.js';

// Checked during typecheck. Runtime bounds stay the validator's responsibility.
export function contractTypes(info: ServerInfo, error: ProtocolError): void {
  const version: 1 = info.schemaVersion;
  const initialProtocol: 0 = info.protocol.max;
  const identifiers: string[] = [info.serverId, info.eventEpoch, error.requestId];
  void [version, initialProtocol, identifiers];
  // @ts-expect-error Payload versions are literal discriminants.
  const wrongVersion: ServerInfo = { ...info, schemaVersion: 2 };
  // @ts-expect-error IDs cannot be numeric provider handles.
  const wrongIdentity: ServerInfo = { ...info, serverId: 123 };
  const wrongCapabilities: ServerInfo = {
    ...info,
    capabilities: {
      ...info.capabilities,
      // @ts-expect-error Foundation cannot advertise an implemented mutation transport.
      commands: true,
    },
  };
  void [wrongVersion, wrongIdentity, wrongCapabilities];
}
