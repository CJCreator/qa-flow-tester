export { formatDay } from '@qa/types/src/browser.js';

/** "3 pages", "1 page". */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "30 Sep 2026, 14:05": precise enough to tell two check-ups of one day apart. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "4 min", "35 s": how long a check-up took. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Smooth scrolling, unless the person asked for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

/** Scrolls to a section and moves focus to its heading, so keyboard and screen-reader users land there too. */
export function goToSection(id: string) {
  const heading = document.getElementById(id);
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  heading.focus({ preventScroll: true });
}
