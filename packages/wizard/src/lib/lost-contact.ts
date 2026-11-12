/** What to do while the page has lost the runner: the hosted copy has no terminal to look at. */
export function lostContactHint(hosted: boolean): string {
  return hosted
    ? 'The online copy may be waking up or restarting after an update. This page keeps trying.'
    : 'Check that it’s still running in its terminal (start it with pnpm start). This page keeps trying.';
}
