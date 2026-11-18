/** Small display helpers shared by the runner, core and the wizard. Browser-safe. */

/** The host (with port) of an address, or the address itself when it is not a full URL. */
export function hostOf(address: string): string {
  try {
    return new URL(address).host;
  } catch {
    return address;
  }
}

/** "30 September 2026"; the input unchanged when it is not a date. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
