import { isTestHost, resolveTestHost, verifyDomainProof, type NetDeps } from '@qa/core';

/**
 * Whether an address is a Test Copy, where the runner decides it (ADR 0014). Local mode keeps the
 * text-only rule with no lookup. A shared machine (beta) needs: marked by the owner, every resolved
 * address public, and a Verified Domain proof for the exact origin, fetched now.
 */
export async function testCopyFor(i: {
  beta: boolean;
  hostname: string;
  origin: string;
  marked: boolean;
  token: () => string | undefined;
  deps?: NetDeps;
}): Promise<boolean> {
  if (!i.beta) return isTestHost(i.hostname, i.marked ? [i.hostname] : []);
  const result = await resolveTestHost(i.hostname, {
    shared: true,
    marked: i.marked,
    origin: i.origin,
    lookup: i.deps?.lookup,
    proof: async () => {
      const token = i.token();
      return token ? (await verifyDomainProof(i.origin, token, i.deps)).ok : false;
    },
  });
  return result.testCopy;
}
