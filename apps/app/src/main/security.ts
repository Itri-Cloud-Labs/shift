export const APP_URL = 'shift://app/index.html';
export const DOCUMENTATION_URL = 'https://github.com/Itri-Cloud-Labs/shift/tree/main/docs';
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
export const securePreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
} as const;
export function isApplicationDocument(value: string): boolean {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === APP_URL;
  } catch {
    return false;
  }
}
export function assetPath(value: string, allowedPaths: ReadonlySet<string>): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'shift:' ||
      url.hostname !== 'app' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    const path = decodeURIComponent(url.pathname).slice(1);
    if (
      path.includes('\\') ||
      path.includes('\0') ||
      path.split('/').some((part) => part === '.' || part === '..')
    )
      return undefined;
    return allowedPaths.has(path) ? path : undefined;
  } catch {
    return undefined;
  }
}
export function validExternalLink(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.href === DOCUMENTATION_URL
    );
  } catch {
    return false;
  }
}
export interface SenderContext {
  senderId: number;
  mainSenderId: number;
  frameIsMain: boolean;
  url: string;
}
export function validSender(context: SenderContext): boolean {
  return (
    context.senderId === context.mainSenderId &&
    context.frameIsMain &&
    isApplicationDocument(context.url)
  );
}
