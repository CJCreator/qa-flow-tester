/**
 * Which addresses are not public (ADR 0014). Pure and import-free so the wizard can share it: no
 * the Node net module, no DNS. Every address a name resolves to, and every literal IP, goes through here.
 */

export type AddressClass =
  | 'unspecified'
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'metadata'
  | 'unique-local'
  | 'carrier-nat'
  | 'multicast-reserved';

function parseIPv4(text: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => n > 255)) return null;
  return parts as [number, number, number, number];
}

/** Eight 16-bit groups, or null when this is not an IPv6 address. Handles `::` and a dotted tail. */
function parseIPv6(text: string): number[] | null {
  let s = text;
  if (!s.includes(':')) return null;
  // The tail may be a dotted IPv4 address (::ffff:127.0.0.1).
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    s = `${s.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const out: number[] = [];
    for (const g of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const rest = toGroups(halves[1]);
  if (!rest) return null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

function classifyV4(a: number, b: number, c: number, d: number): AddressClass | null {
  if (a === 0) return 'unspecified';
  if (a === 127) return 'loopback';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 169 && b === 254) return c === 169 && d === 254 ? 'metadata' : 'link-local';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-nat';
  if (a >= 224) return 'multicast-reserved';
  return null;
}

function classifyV6(g: number[]): AddressClass | null {
  const upperZero = g.slice(0, 5).every((x) => x === 0);
  if (g.slice(0, 7).every((x) => x === 0)) {
    if (g[7] === 0) return 'unspecified';
    if (g[7] === 1) return 'loopback';
  }
  const embedded = (): AddressClass | null => classifyV4(g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255) ?? null;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): the embedded IPv4 decides.
  if (upperZero && (g[5] === 0xffff || g[5] === 0)) {
    return embedded();
  }
  // NAT64 64:ff9b::/96
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded();
  if (g[0] === 0xfd00 && g[1] === 0x0ec2 && g.slice(2, 7).every((x) => x === 0) && g[7] === 0x254) return 'metadata';
  if ((g[0] & 0xffc0) === 0xfe80) return 'link-local';
  if ((g[0] & 0xfe00) === 0xfc00) return 'unique-local';
  if ((g[0] & 0xff00) === 0xff00) return 'multicast-reserved';
  return null;
}

function bare(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  return a;
}

/** True when the text is an IPv4 or IPv6 address (brackets and zone ids allowed). */
export function isIpLiteral(text: string): boolean {
  const a = bare(text);
  return parseIPv4(a) !== null || parseIPv6(a) !== null;
}

/** The class of a non-public address, or null for a public address or text that is not an IP. */
export function classifyAddress(address: string): AddressClass | null {
  const a = bare(address);
  const v4 = parseIPv4(a);
  if (v4) return classifyV4(...v4);
  const v6 = parseIPv6(a);
  if (v6) return classifyV6(v6);
  return null;
}

/** A valid IP address that is in none of the refused classes. Text that is not an IP is not public. */
export function isPublicAddress(address: string): boolean {
  return isIpLiteral(address) && classifyAddress(address) === null;
}

/** Names that mean this machine, whatever they resolve to. */
export function isPrivateTextHost(hostname: string): boolean {
  const h = hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === 'host.docker.internal';
}
