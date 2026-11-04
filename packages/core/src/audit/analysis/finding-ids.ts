/** Finding ids of a version ("AF-001", "AF-002"...), shared by every analysis rule so they never clash. */

export interface FindingIdAllocator {
  /** The next id, in call order. */
  next(): string;
  /** The number the next call to `next` will use: hand it on so later stages (the AI) continue the series. */
  readonly nextNumber: number;
}

/** "AF-" and the number, at least three digits. */
export function formatFindingId(n: number): string {
  return `AF-${String(n).padStart(3, '0')}`;
}

/** Hands out AF-NNN ids in call order, starting from `start` (1 by default). */
export function createFindingIdAllocator(start = 1): FindingIdAllocator {
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new RangeError(`Finding numbers start at a whole number of at least 1 (got ${start})`);
  }
  let n = start;
  return {
    next: () => formatFindingId(n++),
    get nextNumber() {
      return n;
    },
  };
}
