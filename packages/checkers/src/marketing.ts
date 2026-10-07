import type { Page } from 'playwright';
import type { Breakpoint, Finding, FindingSeverity, MarketingCheckResult, MarketingReview } from '@qa/types';

export interface MarketingContext {
  testCaseId?: string;
  flowId?: string;
  role: string;
  breakpoint: Breakpoint;
  urlPath: string;
  /** The address the run started from: its path counts as the home page when it isn't "/". */
  baseUrl?: string;
  /** Facts about the whole site already reported this run: each is reported once. */
  siteWide?: Set<string>;
  /** What each basic found over the run, for the report's checklist. */
  log?: MarketingLog;
}

/** What a visitor or a marketer would look for. Each is false only when the page was read and it's missing. */
export interface MarketingPageDetails {
  hasTwitterCard?: boolean;
  hasOgTitle?: boolean;
  hasOgImage?: boolean;
  hasCallToAction?: boolean;
  hasContactRoute?: boolean;
  hasPrivacyLink?: boolean;
  hasAnalytics?: boolean;
  hasSocialLinks?: boolean;
  hasPricing?: boolean;
  hasTrustSignals?: boolean;
  hasLeadCapture?: boolean;
  hasCookieNotice?: boolean;
}

/** What the run found for each basic, kept as pages are read. */
export interface MarketingLog {
  readPages: string[];
  /** True once the home page (or the page the run started from) was read: the site-level basics need it. */
  homeRead: boolean;
  results: Map<string, MarketingCheckResult>;
}

export function newMarketingLog(): MarketingLog {
  return { readPages: [], homeRead: false, results: new Map() };
}

interface Rule {
  key: string;
  label: string;
  /** A fact is there or it isn't. An opinion depends on what the site is for, so it is only a suggestion. */
  kind: 'fact' | 'opinion';
  /** Whether it needs the home page (a fact about the whole site) rather than any page. */
  homeOnly: boolean;
  /** True when found, false when the page was read and it's missing, undefined when this page can't say. */
  found: (d: MarketingPageDetails) => boolean | undefined;
  /** What to say when it passes for a reason other than being found. */
  okDetail?: (d: MarketingPageDetails) => string | undefined;
  severity: FindingSeverity;
  title: string;
  expected: string;
  actual: string;
  resolution: string;
}

const RULES: Rule[] = [
  {
    key: 'TWITTER-CARD',
    label: 'Share card for X and other social sites',
    kind: 'fact',
    homeOnly: false,
    found: (d) => d.hasTwitterCard,
    severity: 'Suggestion',
    title: 'Links shared on X and other social sites won’t show a rich preview card',
    expected: 'A twitter:card tag so shared links show a title, description and image',
    actual: 'No twitter:card meta tag found',
    resolution:
      'Add <meta name="twitter:card" content="summary_large_image"> along with a title, description and image.',
  },
  {
    key: 'SHARE-IMAGE',
    label: 'Picture on shared links',
    kind: 'fact',
    homeOnly: false,
    found: (d) => (d.hasOgTitle === true ? d.hasOgImage : undefined),
    severity: 'Minor',
    title: 'Shared links show no picture',
    expected: 'An og:image so shared links on social sites and chat apps show a picture',
    actual: 'The page has an og:title but no og:image',
    resolution: 'Add <meta property="og:image"> with a picture at least 1200×630 pixels.',
  },
  {
    key: 'CTA',
    label: 'A clear call to action',
    kind: 'fact',
    homeOnly: true,
    found: (d) => d.hasCallToAction,
    severity: 'Minor',
    title: 'The home page has no clear call to action',
    expected:
      'A visible button or link that tells visitors what to do next, such as “Get started”, “Book a demo” or “Sign up”',
    actual: 'No call-to-action button or link was found on the home page',
    resolution: 'Add one clear primary button near the top of the home page that says what happens when it’s pressed.',
  },
  {
    key: 'CONTACT',
    label: 'A way to get in touch',
    kind: 'fact',
    homeOnly: true,
    found: (d) => d.hasContactRoute,
    severity: 'Minor',
    title: 'There is no way to get in touch from the home page',
    expected: 'A contact, support or email link people can find without searching',
    actual: 'No contact page, email or phone link was found on the home page',
    resolution: 'Add a Contact link to the header or footer, or an email address people can write to.',
  },
  {
    key: 'PRIVACY',
    label: 'Privacy and terms links',
    kind: 'fact',
    homeOnly: true,
    found: (d) => d.hasPrivacyLink,
    severity: 'Minor',
    title: 'There is no privacy or terms link',
    expected: 'A link to a privacy policy or terms, which visitors, ad platforms and app stores look for',
    actual: 'No privacy or terms link was found on the home page',
    resolution: 'Add Privacy and Terms links to the footer.',
  },
  {
    key: 'ANALYTICS',
    label: 'Visitor analytics',
    kind: 'fact',
    homeOnly: true,
    found: (d) => d.hasAnalytics,
    severity: 'Suggestion',
    title: 'No visitor analytics were found',
    expected:
      'Some way to see where visitors come from and what they do, such as Google Analytics, Plausible or PostHog',
    actual: 'No analytics script was found on the home page',
    resolution: 'Add an analytics tool so you can tell which pages and campaigns bring people in.',
  },
  {
    key: 'SOCIAL',
    label: 'Links to social profiles',
    kind: 'fact',
    homeOnly: true,
    found: (d) => d.hasSocialLinks,
    severity: 'Suggestion',
    title: 'No links to social media profiles',
    expected:
      'Links to the site’s social profiles, which help people follow it and help search tools tie them together',
    actual: 'No links to LinkedIn, X, Instagram, YouTube or similar were found on the home page',
    resolution: 'Link to the profiles you keep up, from the footer.',
  },
  {
    key: 'PRICING',
    label: 'Pricing or plans',
    kind: 'opinion',
    homeOnly: true,
    found: (d) => d.hasPricing,
    severity: 'Suggestion',
    title: 'No pricing or plans were found on the home page',
    expected:
      'If the site sells something, visitors look for what it costs: a Pricing or Plans link, or visible prices',
    actual: 'No Pricing or Plans link, and no prices, were found on the home page',
    resolution:
      'Add a Pricing link to the header, or show prices where the offer is described. If nothing is sold here, you can ignore this.',
  },
  {
    key: 'TRUST',
    label: 'Reviews, testimonials or customers',
    kind: 'opinion',
    homeOnly: true,
    found: (d) => d.hasTrustSignals,
    severity: 'Suggestion',
    title: 'No reviews, testimonials or customer names were found',
    expected: 'Proof that other people use and like it: customer quotes, ratings, or the names or logos of customers',
    actual: 'No testimonials, reviews, ratings or “trusted by” section were found on the home page',
    resolution: 'Add a few real customer quotes, ratings or logos near the main call to action.',
  },
  {
    key: 'LEAD',
    label: 'A way to stay in touch (email sign-up)',
    kind: 'opinion',
    homeOnly: true,
    found: (d) => d.hasLeadCapture,
    severity: 'Suggestion',
    title: 'There is no way for a visitor to leave an email address',
    expected: 'A newsletter, waitlist or sign-up form, so visitors who aren’t ready to buy can hear from you later',
    actual: 'No email field, newsletter or waitlist form was found on the home page',
    resolution:
      'Add a short email sign-up in the footer or near the end of the home page, saying what people will get.',
  },
  {
    key: 'COOKIE',
    label: 'Cookie notice (when analytics run)',
    kind: 'opinion',
    homeOnly: true,
    // Only expected where something tracks visitors: with no analytics there is nothing to ask about.
    found: (d) => (d.hasAnalytics === true ? d.hasCookieNotice : d.hasAnalytics === false ? true : undefined),
    okDetail: (d) =>
      d.hasAnalytics === false ? 'Not needed: no analytics were found, so no consent notice is expected.' : undefined,
    severity: 'Suggestion',
    title: 'Analytics run, but no cookie notice was seen',
    expected: 'A notice or consent choice for visitors where privacy rules (such as the EU’s) apply',
    actual: 'Analytics were found on the home page, but no cookie or consent notice appeared',
    resolution:
      'If people in the EU, UK or similar places visit, ask for consent before analytics start. A notice that appears late may have been missed.',
  },
];

const HOME_PATHS = new Set(['/', '', '/index.html', '/index', '/home']);

function normalise(pathname: string): string {
  const p = pathname.split(/[?#]/)[0].replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

/** The home page, or the page the run started from, or a language's home such as /en or /pt-br. */
export function isHomePath(urlPath: string, baseUrl?: string): boolean {
  const here = normalise(urlPath);
  if (HOME_PATHS.has(here) || /^\/[a-z]{2}(-[a-z]{2})?$/i.test(here)) return true;
  if (!baseUrl) return false;
  try {
    return normalise(new URL(baseUrl).pathname) === here;
  } catch {
    return false;
  }
}

const RANK: Record<MarketingCheckResult['status'], number> = { 'not-checked': 0, ok: 1, gap: 2 };

/** A gap anywhere stays a gap; a pass doesn't hide it. */
function remember(log: MarketingLog | undefined, result: MarketingCheckResult): void {
  if (!log) return;
  const before = log.results.get(result.key);
  if (!before || RANK[result.status] > RANK[before.status] || (result.status === 'ok' && before.status === 'ok'))
    log.results.set(result.key, result);
}

/**
 * The checklist for the report: every basic, in order, each found, missing, or not looked for (with
 * why). Undefined when no page was read, so a report never shows a checklist nothing produced.
 */
export function marketingReview(log: MarketingLog): MarketingReview | undefined {
  if (log.readPages.length === 0) return undefined;
  return {
    readPages: [...log.readPages],
    checks: RULES.map(
      (rule) =>
        log.results.get(rule.key) ?? {
          key: rule.key,
          label: rule.label,
          kind: rule.kind,
          status: 'not-checked' as const,
          detail: rule.homeOnly
            ? 'This is looked for on the home page, which wasn’t among the pages tested.'
            : 'No page said either way.',
        }
    ),
  };
}

/**
 * The marketing basics a site is expected to have: share previews, a clear call to action, a way to
 * get in touch, trust links, analytics and social profiles, and a few suggestions that depend on
 * what the site is for (pricing, proof from customers, an email sign-up, a cookie notice). Reported
 * once per site, not per page.
 */
export class MarketingChecker {
  async checkPage(page: Page, context: MarketingContext): Promise<Finding[]> {
    const details = await this.collectDetails(page);
    if (!details) return [];

    const isHome = isHomePath(context.urlPath, context.baseUrl);
    if (context.log) {
      if (!context.log.readPages.includes(context.urlPath)) context.log.readPages.push(context.urlPath);
      if (isHome) context.log.homeRead = true;
    }
    const tcId = context.testCaseId || 'MKT';
    const findings: Finding[] = [];
    for (const rule of RULES) {
      if (rule.homeOnly && !isHome) continue;
      const found = rule.found(details);
      if (found === undefined) continue;
      const base = { key: rule.key, label: rule.label, kind: rule.kind };
      if (found) {
        remember(context.log, {
          ...base,
          status: 'ok',
          detail: rule.okDetail?.(details) ?? `Found on ${context.urlPath}.`,
        });
        continue;
      }
      const siteKey = `marketing:${rule.key}`;
      const alreadyReported = !!context.siteWide?.has(siteKey);
      context.siteWide?.add(siteKey);
      const id = `F-MKT-${tcId}-${rule.key}-${findings.length + 1}`;
      remember(context.log, {
        ...base,
        status: 'gap',
        detail: `Not found on ${context.urlPath}.`,
        ...(alreadyReported ? {} : { findingId: id }),
      });
      if (alreadyReported) continue;
      findings.push({
        id,
        testCaseId: context.testCaseId,
        flowId: context.flowId,
        severity: rule.severity,
        checker: 'seo',
        categoryTag: 'MKT',
        title: rule.title,
        where: { urlPath: context.urlPath, role: context.role, breakpoint: context.breakpoint },
        expectedVsActual: { expected: rule.expected, actual: rule.actual },
        stepsToReproduce: [`Visit ${context.urlPath}`, 'Look for it on the page and in its HTML'],
        evidence: {},
        resolution: rule.kind === 'opinion' ? `A suggestion, not a fault: ${rule.resolution}` : rule.resolution,
      });
    }
    return findings;
  }

  private async collectDetails(page: Page): Promise<MarketingPageDetails | null> {
    try {
      const details = await page.evaluate((): MarketingPageDetails => {
        const meta = (sel: string) => !!document.querySelector(sel);
        const metaContent = (sel: string) => !!document.querySelector<HTMLMetaElement>(sel)?.content?.trim();
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
        const textOf = (el: Element) => (el.textContent || '').replace(/\s+/g, ' ').trim();
        const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
        const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ');

        const ctaWords =
          /\b(get started|start|try|sign up|join|buy|book|schedule|request|demo|subscribe|download|shop|order|free|contact us|learn more)\b/i;
        const hasCallToAction = Array.from(document.querySelectorAll('a, button, [role="button"]')).some(
          (el) => visible(el) && textOf(el).length > 0 && textOf(el).length <= 40 && ctaWords.test(textOf(el))
        );

        const hasContactRoute = links.some(
          (a) =>
            /^(mailto|tel):/i.test(a.getAttribute('href') || '') ||
            /contact|support|help/i.test(textOf(a)) ||
            /contact/i.test(a.getAttribute('href') || '')
        );
        const hasPrivacyLink = links.some(
          (a) => /privacy|terms|legal/i.test(textOf(a)) || /privacy|terms/i.test(a.getAttribute('href') || '')
        );

        const analyticsPattern =
          /googletagmanager|google-analytics|gtag\(|plausible|posthog|segment\.(com|io)|fathom|matomo|umami|clarity\.ms|mixpanel|hotjar|amplitude|fbevents|vercel[-/]insights|_vercel\/insights/i;
        const w = window as unknown as Record<string, unknown>;
        const hasAnalytics =
          !!(
            w.dataLayer ||
            w.gtag ||
            w.ga ||
            w.plausible ||
            w.posthog ||
            w.analytics ||
            w.mixpanel ||
            w._paq ||
            w.fbq
          ) ||
          Array.from(document.scripts).some(
            (s) => analyticsPattern.test(s.src || '') || analyticsPattern.test(s.textContent || '')
          );

        const socialHosts =
          /(^|\.)(twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|tiktok\.com|github\.com|threads\.net|mastodon\.[a-z]+)$/i;
        const hasSocialLinks = links.some((a) => {
          try {
            return socialHosts.test(new URL(a.href).hostname);
          } catch {
            return false;
          }
        });

        // Pricing: a link to it, or a price written in the page.
        const hasPricing =
          links.some(
            (a) =>
              /\b(pricing|plans?|prices?)\b/i.test(textOf(a)) ||
              /\/(pricing|plans?|prices?)(\/|$|\?)/i.test(a.getAttribute('href') || '')
          ) || /(^|[^\w])[$€£₹]\s?\d[\d,.]*/.test(bodyText);

        // Proof from other people: quotes, ratings, or a "trusted by" row.
        const hasTrustSignals =
          !!document.querySelector(
            '[class*="testimonial" i], [class*="review" i], [class*="rating" i], [itemprop="review"], [itemprop="aggregateRating"], blockquote'
          ) ||
          /\b(trusted by|loved by|used by|what (our )?(customers|users|clients) say|testimonials?|customer stories|rated \d(\.\d)?)\b/i.test(
            bodyText
          ) ||
          /\b\d(\.\d)?\s?\/\s?5\b/.test(bodyText);

        // A way to leave an email: an email field, or newsletter and waitlist wording.
        const hasLeadCapture =
          !!document.querySelector('input[type="email"], input[name*="email" i], input[placeholder*="email" i]') ||
          /\b(newsletter|subscribe|join the waitlist|waitlist|get (updates|news)|stay (up to date|in the loop))\b/i.test(
            bodyText
          );

        // A consent notice: a known tool, or a banner that talks about cookies.
        const hasCookieNotice =
          !!document.querySelector(
            '#onetrust-banner-sdk, #CybotCookiebotDialog, .cc-window, .cookie-banner, [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [aria-label*="cookie" i]'
          ) ||
          Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], aside, footer, div')).some(
            (el) =>
              visible(el) &&
              /\bcookies?\b/i.test(textOf(el)) &&
              textOf(el).length < 600 &&
              /accept|agree|allow|got it|ok|manage|reject|decline/i.test(textOf(el))
          );

        return {
          hasTwitterCard: meta('meta[name="twitter:card"]'),
          hasOgTitle: metaContent('meta[property="og:title"]'),
          hasOgImage: metaContent('meta[property="og:image"]'),
          hasCallToAction,
          hasContactRoute,
          hasPrivacyLink,
          hasAnalytics,
          hasSocialLinks,
          hasPricing,
          hasTrustSignals,
          hasLeadCapture,
          hasCookieNotice,
        };
      });
      return details && typeof details === 'object' ? details : null;
    } catch {
      return null;
    }
  }
}
