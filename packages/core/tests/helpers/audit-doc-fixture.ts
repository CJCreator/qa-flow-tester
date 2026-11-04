/**
 * A small finished Website Audit version for the Audit Document tests (REQ-018 to REQ-022): five recorded
 * pages (four English, one Tamil), Page Content split into Sections, findings on several pages and
 * Sections (one spanning two pages), an Improvement Roadmap and redesign-or-repair recommendations.
 *
 * Hierarchy:
 *   /                 start page, Sample Page, repair
 *   ├─ /about         covered by /services
 *   │   └─ /about/team covered by /services
 *   ├─ /services      Sample Page, redesign
 *   └─ /ta            Tamil, Sample Page, repair
 *
 * Every call returns a fresh copy, so a test may change what it gets.
 */

import {
  AUDIT_AREAS,
  type AreaAssessment,
  type AuditFinding,
  type AuditPage,
  type AuditResult,
  type ContentLink,
  type PageContent,
  type PageLanguage,
  type Section,
  type SectionKind,
} from '@qa/types';

export const FIXTURE_AUDIT_ID = 'audit-doc-fixture-01';
export const FIXTURE_URL = 'https://shop.example.in/';

/** Page paths in the fixture. */
export const PATHS = {
  home: '/',
  about: '/about',
  team: '/about/team',
  services: '/services',
  tamil: '/ta',
} as const;

const EN: PageLanguage = { primary: 'en', others: [], declared: 'en' };
const TA: PageLanguage = { primary: 'ta', others: ['en'], declared: 'ta' };

/** Sections as [id, kind, heading, text] in page order. */
type SectionSpec = [string, SectionKind, string | undefined, string];

const SECTION_SPECS: Record<string, SectionSpec[]> = {
  [PATHS.home]: [
    ['s1', 'header', undefined, 'Shop Example\nHome About Services\n'],
    ['s2', 'main', 'Fresh groceries delivered', 'Fresh groceries delivered\nOrder before 6 pm for same-day delivery.\n'],
    ['s3', 'footer', undefined, 'Call 044 1234 5678\n© Shop Example'],
  ],
  [PATHS.about]: [
    ['s1', 'header', undefined, 'Shop Example\n'],
    ['s2', 'main', 'About us', 'About us\nA family shop in Chennai since 1998.\n'],
  ],
  [PATHS.team]: [['s1', 'main', 'Our team', 'Our team\nMeet the people behind the shop.']],
  [PATHS.services]: [
    ['s1', 'header', undefined, 'Shop Example\n'],
    ['s2', 'main', 'Services', 'Services\nHome delivery, bulk orders and gift hampers.\n'],
  ],
  [PATHS.tamil]: [
    ['s1', 'header', undefined, 'கடை உதாரணம்\n'],
    ['s2', 'main', 'புதிய மளிகைப் பொருட்கள்', 'புதிய மளிகைப் பொருட்கள்\nமாலை 6 மணிக்கு முன் ஆர்டர் செய்யுங்கள்.\n'],
    ['s3', 'footer', undefined, 'அழைக்க 044 1234 5678'],
  ],
};

const TITLES: Record<string, string> = {
  [PATHS.home]: 'Shop Example',
  [PATHS.about]: 'Shop Example',
  [PATHS.team]: 'Our team',
  [PATHS.services]: 'Shop Example',
  [PATHS.tamil]: 'கடை உதாரணம்',
};

/** The original text of one Section of the fixture. */
export function fixtureSectionText(urlPath: string, sectionId: string): string {
  const spec = SECTION_SPECS[urlPath]?.find(([id]) => id === sectionId);
  if (!spec) throw new Error(`no Section ${sectionId} on ${urlPath}`);
  return spec[3];
}

function sections(urlPath: string): Section[] {
  let at = 0;
  return SECTION_SPECS[urlPath].map(([id, kind, heading, text]) => {
    const s: Section = { id, kind, start: at, end: at + text.length, ...(heading ? { heading } : {}) };
    at += text.length;
    return s;
  });
}

function menu(from: string): ContentLink[] {
  return [
    { text: 'Home', to: PATHS.home, region: 'menu', sectionId: 's1' },
    { text: 'About', to: PATHS.about, region: 'menu', sectionId: 's1' },
    { text: 'Services', to: PATHS.services, region: 'menu', sectionId: 's1' },
  ].filter((l) => l.to !== from) as ContentLink[];
}

function content(urlPath: string, extra: Partial<PageContent> = {}): PageContent {
  const specs = SECTION_SPECS[urlPath];
  return {
    urlPath,
    title: TITLES[urlPath],
    description: null,
    text: specs.map(([, , , text]) => text).join(''),
    headings: specs
      .filter(([, , heading]) => heading)
      .map(([id, , heading]) => ({ level: 1 as const, text: heading as string, sectionId: id })),
    images: [],
    links: menu(urlPath),
    forms: [],
    ctas: [],
    language: urlPath === PATHS.tamil ? TA : EN,
    sections: sections(urlPath),
    ...extra,
  };
}

/** Page Content of every recorded page, English and Tamil. */
export function auditDocContents(): PageContent[] {
  return [
    content(PATHS.home, {
      description: 'Groceries delivered in Chennai.',
      images: [{ src: '/img/hero.jpg', alt: 'Fresh vegetables', sectionId: 's2' }],
      ctas: [{ text: 'Order now', kind: 'link', to: '/order', sectionId: 's2' }],
      links: [
        ...menu(PATHS.home),
        { text: 'Instagram', to: 'https://instagram.com/shopexample', region: 'footer', leavesSite: true, sectionId: 's3' },
      ],
    }),
    content(PATHS.about, {
      images: [{ src: '/img/shop.jpg', alt: null, sectionId: 's2' }],
      links: [
        ...menu(PATHS.about),
        { text: 'Our team', to: PATHS.team, region: 'internal', sectionId: 's2' },
        { text: 'Map', to: 'https://maps.example.com/shop', region: 'internal', leavesSite: true, sectionId: 's2' },
      ],
    }),
    content(PATHS.team),
    content(PATHS.services, {
      forms: [
        {
          method: 'POST',
          action: '/enquiry',
          fields: [
            { type: 'text', label: 'Name', name: 'name', required: true },
            { type: 'tel', label: 'Phone', name: 'phone' },
          ],
          sectionId: 's2',
        },
      ],
    }),
    content(PATHS.tamil, {
      links: [
        { text: 'முகப்பு', to: PATHS.home, region: 'menu', sectionId: 's1' },
        { text: 'Instagram', to: 'https://instagram.com/shopexample', region: 'footer', leavesSite: true, sectionId: 's3' },
      ],
    }),
  ];
}

function finding(over: Partial<AuditFinding> & Pick<AuditFinding, 'id' | 'rule' | 'urlPath'>): AuditFinding {
  return {
    group: 'technical',
    area: 'search-ranking',
    title: 'A finding',
    detail: 'What was seen.',
    suggestion: 'How to repair it.',
    impact: 'medium',
    effort: 'low',
    sectionId: null,
    source: 'rule',
    ...over,
  };
}

/** The findings, in ranked order. */
function findings(): AuditFinding[] {
  return [
    finding({
      id: 'AF-001',
      rule: 'duplicate-title',
      urlPath: PATHS.about,
      pages: [PATHS.about, PATHS.services],
      title: 'Two pages share one title',
      detail: 'The pages /about and /services both have the title "Shop Example".',
      suggestion: 'Give each page its own title.',
      impact: 'high',
    }),
    finding({
      id: 'AF-002',
      rule: 'missing-alt',
      group: 'content',
      area: 'accessibility',
      urlPath: PATHS.about,
      sectionId: 's2',
      title: 'An image has no alt text',
      detail: 'The image /img/shop.jpg has no alt attribute.',
      suggestion: 'Describe the image in its alt text.',
      target: '/img/shop.jpg',
    }),
    finding({
      id: 'AF-003',
      rule: 'missing-description',
      urlPath: PATHS.services,
      title: 'No meta description',
      detail: 'The page has no meta description.',
      suggestion: 'Write a one-sentence description.',
    }),
    finding({
      id: 'AF-004',
      rule: 'weak-cta',
      group: 'marketing',
      area: 'marketing',
      urlPath: PATHS.home,
      sectionId: 's2',
      title: 'The call to action is easy to miss',
      detail: 'The only call to action sits below the first screen.',
      suggestion: 'Move "Order now" near the top.',
      source: 'ai',
      advisory: true,
    }),
    finding({
      id: 'AF-005',
      rule: 'thin-content',
      group: 'content',
      area: 'content',
      urlPath: PATHS.tamil,
      sectionId: 's2',
      title: 'பக்கத்தில் குறைவான உள்ளடக்கம்',
      detail: 'இந்தப் பக்கத்தில் சில வரிகள் மட்டுமே உள்ளன.',
      suggestion: 'சேவைகளைப் பற்றி மேலும் எழுதுங்கள்.',
      impact: 'low',
    }),
    finding({
      id: 'AF-006',
      rule: 'missing-description',
      urlPath: PATHS.team,
      title: 'No meta description',
      detail: 'The page has no meta description.',
      suggestion: 'Write a one-sentence description.',
      impact: 'low',
    }),
  ];
}

const seo = (findingIds: string[]): AuditPage['seo'] => ({
  hasTitle: true,
  hasDescription: false,
  h1Count: 1,
  skippedHeadingLevel: false,
  imagesWithoutAlt: 0,
  htmlLang: 'en',
  findingIds,
});

function areas(evidence: string[]): AreaAssessment[] {
  return AUDIT_AREAS.map(
    (area): AreaAssessment =>
      area === 'marketing'
        ? { area, grade: 'C', status: 'done', note: 'The offer is clear; the call to action is late.', evidence }
        : { area, grade: null, status: 'not-done', reason: 'no-ai-key' },
  );
}

function pages(): AuditPage[] {
  const summary = (urlPath: string) => sections(urlPath).map(({ id, kind, heading }) => ({ id, kind, ...(heading ? { heading } : {}) }));
  return [
    {
      urlPath: PATHS.home,
      title: TITLES[PATHS.home],
      depth: 0,
      layoutGroup: 'home',
      coverage: 'sample',
      language: EN,
      sections: summary(PATHS.home),
      seo: { ...seo([]), hasDescription: true },
      areas: areas(['AF-004']),
      recommendation: {
        urlPath: PATHS.home,
        action: 'repair',
        reason: 'The layout works; the call to action needs moving.',
        findingIds: ['AF-004'],
        decidedBy: 'ai',
      },
    },
    {
      urlPath: PATHS.about,
      title: TITLES[PATHS.about],
      depth: 1,
      layoutGroup: 'content',
      coverage: 'covered',
      sampleUrlPath: PATHS.services,
      language: EN,
      sections: summary(PATHS.about),
      seo: { ...seo(['AF-001', 'AF-002']), imagesWithoutAlt: 1 },
    },
    {
      urlPath: PATHS.team,
      title: TITLES[PATHS.team],
      depth: 2,
      layoutGroup: 'content',
      coverage: 'covered',
      sampleUrlPath: PATHS.services,
      language: EN,
      sections: summary(PATHS.team),
      seo: seo(['AF-006']),
    },
    {
      urlPath: PATHS.services,
      title: TITLES[PATHS.services],
      depth: 1,
      layoutGroup: 'content',
      coverage: 'sample',
      language: EN,
      sections: summary(PATHS.services),
      seo: seo(['AF-001', 'AF-003']),
      recommendation: {
        urlPath: PATHS.services,
        action: 'redesign',
        reason: 'The page has no clear offer and no description.',
        findingIds: ['AF-001', 'AF-003'],
        decidedBy: 'rule',
      },
    },
    {
      urlPath: PATHS.tamil,
      title: TITLES[PATHS.tamil],
      depth: 1,
      layoutGroup: 'home',
      coverage: 'sample',
      language: TA,
      sections: summary(PATHS.tamil),
      seo: { ...seo(['AF-005']), htmlLang: 'ta' },
      recommendation: {
        urlPath: PATHS.tamil,
        action: 'repair',
        reason: 'Only the text is thin.',
        findingIds: ['AF-005'],
        decidedBy: 'rule',
      },
    },
  ];
}

/** The finished version. */
export function auditDocResult(): AuditResult {
  return {
    auditId: FIXTURE_AUDIT_ID,
    version: 1,
    url: FIXTURE_URL,
    limits: { maxPages: 50, maxDepth: 3, includePaths: [], excludePaths: [] },
    language: 'en',
    startedAt: '2026-11-01T09:00:00.000Z',
    finishedAt: '2026-11-01T09:04:00.000Z',
    technology: {
      status: 'identified',
      technologies: [{ name: 'WordPress', kind: 'cms', evidence: ['meta generator'] }],
    },
    pages: pages(),
    coverage: {
      found: 6,
      reached: 5,
      skipped: [{ urlPath: '/checkout', why: 'payment' }],
    },
    leavingSite: [
      { to: 'https://instagram.com/shopexample', from: [PATHS.home, PATHS.tamil] },
      { to: 'https://maps.example.com/shop', from: [PATHS.about] },
    ],
    hierarchy: {
      root: {
        urlPath: PATHS.home,
        title: TITLES[PATHS.home],
        placedBy: 'start',
        children: [
          {
            urlPath: PATHS.about,
            title: TITLES[PATHS.about],
            placedBy: 'menu',
            children: [{ urlPath: PATHS.team, title: TITLES[PATHS.team], placedBy: 'path', children: [] }],
          },
          { urlPath: PATHS.services, title: TITLES[PATHS.services], placedBy: 'menu', children: [] },
          { urlPath: PATHS.tamil, title: TITLES[PATHS.tamil], placedBy: 'path', children: [] },
        ],
      },
      links: [
        { from: PATHS.home, to: PATHS.about, region: 'menu', text: 'About' },
        { from: PATHS.home, to: PATHS.services, region: 'menu', text: 'Services' },
        { from: PATHS.about, to: PATHS.home, region: 'menu', text: 'Home' },
        { from: PATHS.about, to: PATHS.services, region: 'menu', text: 'Services' },
        { from: PATHS.about, to: PATHS.team, region: 'internal', text: 'Our team' },
        { from: PATHS.services, to: PATHS.about, region: 'menu', text: 'About' },
        { from: PATHS.team, to: PATHS.home, region: 'menu', text: 'Home' },
        { from: PATHS.tamil, to: PATHS.home, region: 'menu', text: 'முகப்பு' },
      ],
    },
    internalLinking: {
      inboundCounts: { [PATHS.home]: 3, [PATHS.about]: 2, [PATHS.services]: 2, [PATHS.team]: 1, [PATHS.tamil]: 0 },
      unlinkedPages: [PATHS.tamil],
    },
    findings: findings(),
    roadmap: [
      {
        id: 'RM-1',
        title: 'Give every page its own title',
        priority: 'high',
        phase: 1,
        effort: 'low',
        findingIds: ['AF-001'],
        pages: [PATHS.about, PATHS.services],
      },
      {
        id: 'RM-2',
        title: 'Add alt text to images',
        priority: 'medium',
        phase: 1,
        effort: 'low',
        findingIds: ['AF-002'],
        pages: [PATHS.about],
      },
      {
        id: 'RM-3',
        title: 'Write meta descriptions',
        priority: 'medium',
        phase: 2,
        effort: 'low',
        findingIds: ['AF-003', 'AF-006'],
        pages: [PATHS.services, PATHS.team],
      },
      {
        id: 'RM-4',
        title: 'Strengthen calls to action and thin pages',
        priority: 'medium',
        phase: 2,
        effort: 'medium',
        findingIds: ['AF-004', 'AF-005'],
        pages: [PATHS.home, PATHS.tamil],
      },
    ],
    marketing: {
      readPages: [PATHS.home, PATHS.about, PATHS.services, PATHS.tamil],
      checks: [],
      signals: [
        {
          key: 'click-to-call',
          label: 'Click-to-call',
          status: 'not-found',
          pages: [],
          detail: 'No tel: link was found.',
        },
        {
          key: 'local-signals',
          label: 'Local signals (NAP and map)',
          status: 'found',
          pages: [PATHS.home, PATHS.about],
          detail: 'A phone number and a map link were found.',
          nap: [
            { urlPath: PATHS.home, name: 'Shop Example', phone: '044 1234 5678' },
            { urlPath: PATHS.about, name: 'Shop Example', address: 'Chennai' },
          ],
        },
        {
          key: 'ctas',
          label: 'Calls to action',
          status: 'found',
          pages: [PATHS.home],
          detail: 'One call to action was found.',
          findingIds: ['AF-004'],
        },
      ],
    },
    siteAreas: areas(['AF-004']),
    notes: ['AI notes need an AI key.'],
  };
}
