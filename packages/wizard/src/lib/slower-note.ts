import type { SlowerThanLastTime } from '@qa/types';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const SCREEN: Record<SlowerThanLastTime['breakpoint'], string> = {
  '375px': 'phone',
  '768px': 'tablet',
  '1440px': 'desktop',
};

/**
 * One plain sentence about a page that loaded slower than in the last check-up: the page, then and now,
 * and how it was measured (ADR 0018, ADR 0035). A note, not a finding, and no claim words.
 */
export function slowerNote(item: SlowerThanLastTime): string {
  const what = item.metric === 'lcp' ? 'the largest content showed' : 'the page was ready';
  const loads = `${item.loads} ${item.loads === 1 ? 'load' : 'loads'}`;
  const how = item.throttled
    ? `Measured on a ${SCREEN[item.breakpoint]}-sized screen over ${loads}, with the connection slowed.`
    : `Measured on a ${SCREEN[item.breakpoint]}-sized screen over ${loads}; the connection was not slowed.`;
  return `${item.urlPath}: ${what} after ${seconds(item.previousMs)} last time and ${seconds(item.currentMs)} now. ${how}`;
}
