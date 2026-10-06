import { useEffect } from 'react';

const SITE = 'Release check-up';
/** The landing page's title: the one public screen. */
export const LANDING_TITLE = 'Release check-up';
const HOME_DESCRIPTION =
  'QA without a QA team. Paste your site address and Release check-up scans it, tests it in a real browser and tells you in plain words whether it is ready to release. Free during the beta.';

function setMeta(selector: string, create: () => HTMLElement, attr: string, value: string): void {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

const metaByName = (name: string) => () => Object.assign(document.createElement('meta'), { name });
const metaByProperty = (property: string) => () => {
  const el = document.createElement('meta');
  el.setAttribute('property', property);
  return el;
};

const PUBLIC_TITLES = new Set([
  LANDING_TITLE,
  'New check-up',
  'Past check-ups',
  'Visual Baselines',
  'Compare with another site',
  'Get started',
]);

/**
 * Names the browser tab after the screen, so tabs, history and bookmarks say where they lead. It also
 * keeps search- and share-facing tags in step for client-rendered pages: public screens allow indexing,
 * while per-run reports and settings are marked noindex.
 * null leaves the title to a screen further down, which names it itself.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    const isHome = title === LANDING_TITLE;
    const isPublic = isHome || PUBLIC_TITLES.has(title);
    document.title = isHome
      ? `${SITE} | QA without a QA team: know if your site is ready to ship`
      : title
        ? `${title} \u00B7 ${SITE}`
        : SITE;

    const description = isHome
      ? HOME_DESCRIPTION
      : `${title || 'Screen'} in ${SITE}.${isPublic ? ' QA without a QA team.' : ' This page is private to your machine.'}`;
    setMeta('meta[name="description"]', metaByName('description'), 'content', description);
    setMeta(
      'meta[name="robots"]',
      metaByName('robots'),
      'content',
      isPublic ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'
    );
    setMeta('meta[property="og:title"]', metaByProperty('og:title'), 'content', document.title);
    setMeta('meta[property="og:description"]', metaByProperty('og:description'), 'content', description);

    const canonical = isHome ? `${window.location.origin}/` : `${window.location.origin}${window.location.pathname}`;
    setMeta('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', canonical);
    setMeta('meta[property="og:url"]', metaByProperty('og:url'), 'content', canonical);
  }, [title]);
}
