// Server URL normalization (client specification 4.1). Remote servers need HTTPS; plain HTTP is
// accepted only for a loopback address, and only where the caller allows it (development).

const loopback = (hostname: string) =>
  hostname === 'localhost' ||
  hostname === '[::1]' ||
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

export type UrlProblem = 'INVALID_URL' | 'INSECURE_URL';

// The URL every API path is appended to, without a trailing slash, or the reason it is refused.
export function normalizeServerUrl(
  input: string,
  options: { allowLoopbackHttp: boolean },
): { url: string } | { problem: UrlProblem } {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { problem: 'INVALID_URL' };
  }
  if (url.username || url.password || url.search || url.hash) return { problem: 'INVALID_URL' };
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { problem: 'INVALID_URL' };
  if (url.protocol === 'http:' && !(options.allowLoopbackHttp && loopback(url.hostname))) {
    return { problem: 'INSECURE_URL' };
  }
  const path = url.pathname.replace(/\/+$/, '');
  return { url: `${url.protocol}//${url.host}${path}` };
}
