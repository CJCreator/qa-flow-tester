export type NormalizedUrl = { ok: true; url: string } | { ok: false; reason: string };

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Accepts what people actually type ("shop.example.com", "localhost:5173") and returns a full URL.
 * A bare address on this computer or a private network gets http://, as a site being built there
 * usually has no certificate; anything else gets https://.
 */
export function normalizeUrl(input: string): NormalizedUrl {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'Enter the address of the site you want to check.' };

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `${isLocal(trimmed) ? 'http' : 'https'}://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'That doesn’t look like a web address. Try something like shop.example.com.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only web addresses that start with http:// or https:// can be checked.' };
  }
  if (!LOCAL_HOSTS.includes(url.hostname) && !url.hostname.includes('.') && !/^\d+(\.\d+){3}$/.test(url.hostname)) {
    return { ok: false, reason: 'That address is missing its ending, like .com or .org.' };
  }
  return { ok: true, url: url.toString() };
}

/** On this computer or a private network: localhost, an IP address, or a name ending in .local. */
function isLocal(value: string): boolean {
  const host = value.split(/[/:?#]/)[0].toLowerCase();
  return LOCAL_HOSTS.includes(host) || /^\d+(\.\d+){3}$/.test(host) || host.endsWith('.local');
}

export function displayHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url;
  }
}

/** Just the host, e.g. "shop.example.com" or "localhost:3050". */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
