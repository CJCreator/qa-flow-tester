/**
 * A limit on browsers started outside the run slot (today: the sign-in test, T-300). A Check-up, comparison or
 * Website Audit already holds the one run slot, so it is not counted here. One instance per runner process.
 */
export class BrowserGate {
  private inUse = 0;

  constructor(readonly limit: number) {}

  /** A release function when a place is free, or null when all are taken. Calling release twice frees one place. */
  tryAcquire(): (() => void) | null {
    if (this.inUse >= this.limit) return null;
    this.inUse++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse--;
    };
  }

  get active(): number {
    return this.inUse;
  }
}
