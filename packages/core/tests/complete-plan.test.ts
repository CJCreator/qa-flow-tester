/**
 * The complete Plan (ADR 0009) without a browser: the App Flow, Layout Groups and Sample Pages, the
 * AI Planner's coverage check, repair and Fixed-Rule Fallback, the AI Request Budget, and the one
 * expansion from Plan to tests that the approval summary and the run share.
 */
import { describe, it, expect } from 'vitest';
import type {
  AICompletion,
  AIMessage,
  AICompletionOptions,
  AIProviderType,
  DiscoveryDraft,
  ElementInventoryItem,
  PageInventoryItem,
  PageLink,
} from '@qa/types';
import type { AIProvider } from '../src/ai/ai-provider.js';
import { buildSiteGraph } from '../src/plan/site-graph.js';
import { itemShape, sampleLayoutGroups } from '../src/plan/sampling.js';
import { planPagesAndMenus, estimatePageRequests, type PagePlannerInput } from '../src/plan/ai-planner.js';
import { BudgetSpentError, PacedAI } from '../src/plan/ai-budget.js';
import { expandPlan } from '../src/plan/expand.js';
import { planJourneys } from '../src/plan/journeys.js';
import { planToMarkdown } from '../src/plan/markdown.js';

const el = (
  role: string,
  name: string,
  selector: string,
  extra: Partial<ElementInventoryItem> = {}
): ElementInventoryItem => ({
  role,
  name,
  selector,
  tagName: role === 'link' ? 'a' : 'button',
  visible: true,
  enabled: true,
  ...extra,
});

const menu: PageLink[] = [
  { name: 'Home', selector: 'role=link[name="Home"]', to: '/', landmark: 'nav' },
  { name: 'Products', selector: 'role=link[name="Products"]', to: '/products', landmark: 'nav' },
  { name: 'About', selector: 'role=link[name="About"]', to: '/about', landmark: 'nav' },
];

function page(urlPath: string, links: PageLink[] = [], extra: Partial<PageInventoryItem> = {}): PageInventoryItem {
  return {
    urlPath,
    title: urlPath === '/' ? 'Home' : urlPath.slice(1),
    interactiveElementsCount: 0,
    formsCount: 0,
    elements: [],
    reachedBy: ['visitor'],
    links: [...menu, ...links],
    layoutGroup: 'layout-a',
    ...extra,
  };
}

/** A small shop: a home page, a product list linking six products, an about page, a partner link. */
function shop(): PageInventoryItem[] {
  const products = [
    'blue-cotton-shirt-1',
    'red-wool-scarf-2',
    'green-silk-tie-3',
    'black-leather-belt-4',
    'white-linen-dress-5',
    'grey-denim-jacket-6',
  ];
  return [
    page(
      '/',
      [
        {
          name: 'Partner',
          selector: 'role=link[name="Partner"]',
          to: 'https://partner.example/offer',
          leavesSite: true,
        },
      ],
      {
        elements: [
          el('button', 'Show offers', '[data-testid="offers"]'),
          el('button', 'Delete account', '[data-testid="delete"]'),
        ],
      }
    ),
    page(
      '/products',
      products.map((p) => ({ name: p, selector: `role=link[name="${p}"]`, to: `/products/${p}` }))
    ),
    page('/about'),
    page('/secret-landing', [], { links: [] }),
    ...products.map((p) =>
      page(`/products/${p}`, [], {
        layoutGroup: 'layout-product',
        elements: [el('tab', 'Details', '[data-testid="details"]')],
      })
    ),
  ];
}

class ScriptedAI implements AIProvider {
  readonly providerType: AIProviderType = 'mock';
  readonly prompts: string[] = [];
  constructor(private answer: (prompt: string, n: number) => string) {}
  async generateText(messages: AIMessage[], _options?: AICompletionOptions): Promise<string> {
    const prompt = messages.map((m) => m.content).join('\n');
    this.prompts.push(prompt);
    return this.answer(prompt, this.prompts.length);
  }
}

/** Answers every page and menu request completely and correctly, from the facts in the prompt. */
function goodAnswer(prompt: string): string {
  const pages = prompt.match(/Pages:\n(\[[\s\S]*?\])\n\nAnswer with ONLY/);
  if (pages) {
    return JSON.stringify({
      pages: (
        JSON.parse(pages[1]) as Array<{
          urlPath: string;
          controls: Array<{ role: string; name: string; selector: string }>;
          links: Array<{ selector: string; name: string }>;
        }>
      ).map((p) => ({
        urlPath: p.urlPath,
        tests: p.controls
          .filter((c) => c.name !== 'Delete account')
          .map((c) => ({
            name: `Pressing ${c.name} shows more`,
            steps: [{ action: 'click', selector: c.selector, name: `Press ${c.name}` }],
            expect: { text: 'More' },
          })),
        links: p.links.map((l) => ({ selector: l.selector, name: `AI: ${l.name}`, expect: `The ${l.name} page` })),
      })),
    });
  }
  const links = prompt.match(/Links:\n(\[[\s\S]*?\])\n\nAnswer with ONLY/);
  if (links) {
    return JSON.stringify({
      links: (JSON.parse(links[1]) as Array<{ selector: string; name: string }>).map((l) => ({
        selector: l.selector,
        name: `AI menu: ${l.name}`,
        expect: 'It opens',
      })),
    });
  }
  return '{}';
}

function plannerInput(pages: PageInventoryItem[], extra: Partial<PagePlannerInput> = {}): PagePlannerInput {
  const { coverage } = sampleLayoutGroups(pages);
  return {
    pages,
    forms: [],
    coverage,
    graph: buildSiteGraph(pages, '/'),
    targetUrl: 'https://shop.example/',
    siteType: 'shop',
    readOnly: false,
    redact: (t) => t,
    ...extra,
  };
}

describe('The App Flow', () => {
  it('finds the shared menu, each page’s own links, click paths, unlinked pages and other hosts', () => {
    const graph = buildSiteGraph(shop(), '/');
    expect(graph.shared.map((s) => s.link.name).sort()).toEqual(['About', 'Home', 'Products']);
    expect(graph.inPage.get('/')!.map((l) => l.name)).toEqual(['Partner']);
    expect(graph.inPage.get('/products')!).toHaveLength(6);
    expect(graph.clickPaths.get('/products/red-wool-scarf-2')).toEqual(['Products', 'red-wool-scarf-2']);
    expect(graph.clickPaths.get('/')).toEqual([]);
    expect(graph.unlinked).toEqual(['/secret-landing']);
    expect(graph.otherHosts).toEqual([{ host: 'partner.example', links: 1 }]);
  });
});

describe('Layout Groups and Sample Pages', () => {
  it('tells an item’s address from a page’s own', () => {
    expect(itemShape('/products/blue-cotton-shirt-1')).toBe('/products/*');
    expect(itemShape('/about')).toBe('/about');
    expect(itemShape('/blog/2026/09/launch')).toBe('/blog/*/*/launch');
  });

  it('tests three samples of a big group, covers the rest, and never groups fixed addresses', () => {
    const { groups, coverage } = sampleLayoutGroups(shop());
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Pages like /products/…');
    // Spread across the group: the first, middle and last found.
    expect(groups[0].samples).toEqual([
      '/products/blue-cotton-shirt-1',
      '/products/green-silk-tie-3',
      '/products/grey-denim-jacket-6',
    ]);
    expect(coverage.get('/products/red-wool-scarf-2')).toMatchObject({
      coverage: 'covered',
      coveredBy: groups[0].samples,
    });
    expect(coverage.get('/products/blue-cotton-shirt-1')?.coverage).toBe('sample');
    // Same layout as the home page, but its own address: tested.
    expect(coverage.get('/about')?.coverage).toBe('tested');
  });
});

describe('The AI Planner', () => {
  it('plans every tested page and link with the AI, and never plans a click that deletes', async () => {
    const ai = new ScriptedAI(goodAnswer);
    const input = plannerInput(shop());
    const out = await planPagesAndMenus(input, ai);

    // Pages: 4 fixed-address pages + 3 samples, three per request, plus one request for the menus.
    expect(ai.prompts).toHaveLength(estimatePageRequests(input));
    expect(out.pages).toHaveLength(10);
    const home = out.pages.find((p) => p.urlPath === '/')!;
    expect(home.source).toBe('ai');
    expect(home.tests.map((t) => t.name)).toEqual(['Pressing Show offers shows more']);
    expect(ai.prompts.join('\n')).not.toContain('"Delete account"');
    expect(out.pages.find((p) => p.urlPath === '/products/red-wool-scarf-2')).toMatchObject({
      coverage: 'covered',
      tests: [],
    });

    // Shared menu once, named from the links (their destinations were all seen, so the AI wasn't
    // asked about them); every sample's own links; the partner link leaves the site.
    const shared = out.navigation.filter((n) => n.shared);
    expect(shared.map((n) => n.name).sort()).toEqual([
      'Menu: “About” opens /about',
      'Menu: “Home” opens /',
      'Menu: “Products” opens /products',
    ]);
    expect(shared.find((n) => n.linkName === 'About')!.expectation).toBe('The “about” page');
    expect(shared.every((n) => n.startPage === '/')).toBe(true);
    expect(out.navigation.filter((n) => n.startPage === '/products' && !n.shared)).toHaveLength(6);
    expect(out.navigation.find((n) => n.leavesSite)).toMatchObject({
      to: 'https://partner.example/offer',
      name: '“Partner” link to partner.example works',
    });
    expect(out.navigation.every((n) => n.source === 'ai')).toBe(true);
  });

  it('asks once more when an answer is incomplete, then falls back to fixed rules for what is still missing', async () => {
    // Every answer invents a selector and leaves the links out.
    const ai = new ScriptedAI((prompt) =>
      prompt.includes('Pages:')
        ? JSON.stringify({
            pages: [
              {
                urlPath: '/',
                tests: [{ name: 'Made up', steps: [{ action: 'click', selector: '#invented', name: 'x' }] }],
                links: [],
              },
            ],
          })
        : '{}'
    );
    const input = plannerInput([
      page('/', [], { links: [menu[1]], elements: [el('button', 'Show offers', '[data-testid="offers"]')] }),
    ]);
    const out = await planPagesAndMenus(input, ai);

    expect(ai.prompts).toHaveLength(2);
    expect(ai.prompts[1]).toContain("“#invented”, which isn't on the page");
    expect(out.pages[0]).toMatchObject({
      source: 'fallback',
      tests: [{ name: 'Try the page’s buttons and tabs', source: 'fallback' }],
    });
    expect(out.navigation[0]).toMatchObject({ source: 'fallback', name: '“Products” opens /products' });
    expect(out.notes[0]).toContain('fixed rules');
  });

  it('keeps to the AI Request Budget: past it, fixed rules plan the rest and the Plan says so', async () => {
    const ai = new PacedAI(new ScriptedAI(goodAnswer), 1);
    const out = await planPagesAndMenus(plannerInput(shop()), ai);
    expect(ai.used).toBe(1);
    expect(out.pages.filter((p) => p.coverage !== 'covered' && p.source === 'ai')).toHaveLength(3);
    expect(out.overBudget).toBeGreaterThan(0);
    expect(out.notes.some((n) => n.includes('AI Request Budget ran out'))).toBe(true);
  });

  it('doesn’t repair an answer the model cut off: fixed rules plan it, and the note names the real cause', async () => {
    const prompts: string[] = [];
    const cutOff: AIProvider = {
      providerType: 'openrouter',
      async generateText() {
        throw new Error('complete() is used');
      },
      async complete(messages: AIMessage[]): Promise<AICompletion> {
        prompts.push(messages.map((m) => m.content).join('\n'));
        return {
          text: '',
          finishReason: 'length',
          model: 'vendor/thinker',
          usage: { promptTokens: 700, completionTokens: 4096, reasoningTokens: 4096 },
        };
      },
    };
    const input = plannerInput([page('/', [], { elements: [el('button', 'Show offers', '[data-testid="offers"]')] })]);
    const out = await planPagesAndMenus(input, cutOff);
    expect(prompts).toHaveLength(1);
    expect(out.pages[0]).toMatchObject({ source: 'fallback', fallbackReason: 'truncated' });
    // The page, and its links to the two pages the crawl didn't see (asked about in the same request).
    expect(out.truncated).toBe(3);
    expect(out.overBudget).toBe(0);
    expect(out.notes).toEqual([expect.stringContaining('fixed rules planned 3 items')]);
    expect(out.notes[0]).toContain('The AI model stopped before it finished answering');
    expect(out.notes.join(' ')).not.toContain('Budget');
  });

  it('asks the AI only about links to pages the crawl didn’t see', async () => {
    const unseen: PageLink = { name: 'Careers', selector: 'role=link[name="Careers"]', to: '/careers' };
    const ai = new ScriptedAI(goodAnswer);
    const out = await planPagesAndMenus(plannerInput([page('/', [unseen]), page('/about')]), ai);
    const pagesPrompt = ai.prompts.find((p) => p.includes('Pages:'))!;
    expect(pagesPrompt).toContain('Careers');
    expect(pagesPrompt).not.toContain('"to":"/about"');
    expect(out.navigation.find((n) => n.linkName === 'Careers')).toMatchObject({
      source: 'ai',
      expectation: 'The Careers page',
    });
  });

  it('opens a folded menu first where narrow screens hide a link, and skips sizes where nothing shows it', async () => {
    const folded = menu.map((l) => ({ ...l, hiddenAt: ['375px', '768px'] as Array<'375px' | '768px'> }));
    const home = page('/', [], {
      links: folded,
      narrowMenus: [{ breakpoint: '375px', selector: 'role=button[name="Menu"]', name: 'Menu' }],
    });
    const out = await planPagesAndMenus(
      plannerInput([home, page('/about', [], { links: folded })]),
      new ScriptedAI(goodAnswer)
    );
    const about = out.navigation.find((n) => n.linkName === 'About')!;
    expect(about.menuSteps).toEqual([
      { action: 'click', selector: 'role=button[name="Menu"]', name: 'Open the menu (“Menu”)', onlyAt: ['375px'] },
    ]);
    expect(about.notAt).toEqual(['768px']);
  });
});

describe('PacedAI', () => {
  it('spaces requests, retries a per-minute rate limit, and stops for the day when the service says so', async () => {
    const waits: number[] = [];
    let calls = 0;
    const flaky: AIProvider = {
      providerType: 'openrouter',
      async generateText() {
        calls++;
        if (calls === 2) throw new Error('OpenAI/OpenRouter API error (429): Rate limit exceeded: free-models-per-min');
        if (calls === 4) throw new Error('OpenAI/OpenRouter API error (429): Rate limit exceeded: free-models-per-day');
        return 'ok';
      },
    };
    const ai = new PacedAI(flaky, Infinity, { sleep: async (ms) => void waits.push(ms) });
    expect(await ai.generateText([])).toBe('ok');
    expect(await ai.generateText([])).toBe('ok');
    expect(waits.some((w) => w >= 20000)).toBe(true);
    await expect(ai.generateText([])).rejects.toBeInstanceOf(BudgetSpentError);
    await expect(ai.generateText([])).rejects.toBeInstanceOf(BudgetSpentError);
    expect(calls).toBe(4);
  });

  it('moves on to the next model, without waiting, when a model’s shared free pool is busy', async () => {
    const asked: Array<string | undefined> = [];
    const waits: number[] = [];
    const inner: AIProvider = {
      providerType: 'openrouter',
      async generateText() {
        return '';
      },
      async complete(_m: AIMessage[], options?: AICompletionOptions): Promise<AICompletion> {
        asked.push(options?.model);
        if (options?.model === 'vendor/busy') {
          throw new Error(
            'OpenAI/OpenRouter API error (429): vendor/busy is temporarily rate-limited upstream. Please retry shortly'
          );
        }
        return { text: '{}', finishReason: 'stop' };
      },
    };
    const ai = new PacedAI(inner, Infinity, {
      gapMs: 0,
      sleep: async (ms) => void waits.push(ms),
      model: 'vendor/busy',
      fallbackModels: ['vendor/free'],
    });
    expect((await ai.complete([], { stage: 'journeys' })).text).toBe('{}');
    expect(asked).toEqual(['vendor/busy', 'vendor/free']);
    expect(waits).toEqual([]);
    expect(ai.models['vendor/busy']).toMatchObject({ failed: 1 });
  });

  it('asks for fewer, shorter journeys when the answer is cut off, instead of repeating the same request', async () => {
    const prompts: string[] = [];
    const ai: AIProvider = {
      providerType: 'openrouter',
      async generateText() {
        throw new Error('complete() is used');
      },
      async complete(messages: AIMessage[]): Promise<AICompletion> {
        const prompt = messages.map((m) => m.content).join('\n');
        prompts.push(prompt);
        return prompt.includes('Keep the answer short')
          ? { text: JSON.stringify({ flows: [] }), finishReason: 'stop' }
          : { text: '{"flows": [{"id": "FLOW-001", "name": "Buy', finishReason: 'length' };
      },
    };
    const out = await planJourneys(
      {
        targetUrl: 'https://shop.example/',
        productId: 'shop',
        promptPages: shop().slice(0, 2),
        spider: { pages: shop(), forms: [] },
        roles: [],
        siteType: 'shop',
        redact: (t) => t,
      },
      ai
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('at most 3 flows');
    expect(out.usedFallback).toBe(false);
  });

  it('switches to the next model when one answers nothing, and adds up tokens per stage and outcomes per model', async () => {
    const asked: Array<string | undefined> = [];
    const inner: AIProvider = {
      providerType: 'openrouter',
      async generateText() {
        return '';
      },
      async complete(_m: AIMessage[], options?: AICompletionOptions): Promise<AICompletion> {
        asked.push(options?.model);
        return options?.model === 'vendor/thinker'
          ? {
              text: '',
              finishReason: 'length',
              usage: { promptTokens: 100, completionTokens: 4096, reasoningTokens: 4096 },
            }
          : { text: '{}', finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 10 } };
      },
    };
    const ai = new PacedAI(inner, Infinity, { gapMs: 0, model: 'vendor/thinker', fallbackModels: ['vendor/plain'] });
    expect((await ai.complete([], { stage: 'planning' })).text).toBe('{}');
    expect((await ai.complete([], { stage: 'journeys' })).text).toBe('{}');
    expect(asked).toEqual(['vendor/thinker', 'vendor/plain', 'vendor/plain']);
    expect(ai.used).toBe(3);
    expect(ai.tokens.planning).toMatchObject({
      requests: 2,
      completionTokens: 4106,
      reasoningTokens: 4096,
      truncated: 1,
    });
    expect(ai.tokens.journeys).toMatchObject({ requests: 1 });
    expect(ai.models).toEqual({
      'vendor/thinker': { ok: 0, truncated: 1, failed: 0 },
      'vendor/plain': { ok: 2, truncated: 0, failed: 0 },
    });
  });
});

describe('From Plan to tests', () => {
  async function draftFor(pages: PageInventoryItem[], readOnly = false): Promise<DiscoveryDraft> {
    const input = plannerInput(pages, { readOnly });
    const planned = await planPagesAndMenus(input, new ScriptedAI(goodAnswer));
    return {
      version: '1.0',
      productId: 'shop',
      targetUrl: 'https://shop.example/',
      timestamp: '2026-09-30T00:00:00Z',
      pages,
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [
        {
          id: 'Q-001',
          urlPath: '/',
          question: 'Press “Delete account”?',
          options: ['Skip it'],
          category: 'sensitive_action',
        },
      ],
      plan: { pages: planned.pages, navigation: planned.navigation, layoutGroups: [], otherHosts: [] },
    };
  }

  it('runs exactly what the Plan lists, and the summary counts it', async () => {
    const draft = await draftFor(shop());
    draft.plan!.navigation.find((n) => n.linkName === 'About' && n.shared)!.skipped = true;
    const { testCases, wontRun, summary } = expandPlan(draft, { readOnly: false, screenSizes: ['375px', '1440px'] });

    const kinds = (k: string) => testCases.filter((tc) => tc.kind === k);
    expect(kinds('page')).toHaveLength(7);
    expect(kinds('page-test')).toHaveLength(4);
    expect(kinds('link')).toEqual([
      expect.objectContaining({
        breakpoints: ['375px'],
        steps: [expect.objectContaining({ action: 'check-link', value: 'https://partner.example/offer' })],
      }),
    ]);
    // 2 shared menu links left (About is off) + 6 product links on /products.
    expect(kinds('navigation')).toHaveLength(8);
    expect(kinds('navigation')[0].expectations).toMatchObject({ url: { pattern: '/' }, pageWorks: {} });
    // A link goes to the same place at every width: it's clicked once, at the widest size.
    expect(kinds('navigation').every((tc) => JSON.stringify(tc.breakpoints) === JSON.stringify(['1440px']))).toBe(true);
    expect(testCases.every((tc) => tc.planItemId)).toBe(true);
    expect(testCases.some((tc) => tc.startPage === '/products/red-wool-scarf-2')).toBe(false);
    expect(wontRun).toEqual([
      expect.objectContaining({ what: 'Menu: “About” opens /about', reason: 'Switched off in the review.' }),
    ]);

    // (7 + 4) tests at 2 sizes, the 8 Navigation Checks and the link check once.
    expect(summary.tests).toBe(11 * 2 + 8 + 1);
    expect(summary.pages).toBe(7);
    expect(summary.pagesListed).toBe(10);
    expect(summary.lines.map((l) => l.text)).toEqual([
      '31 tests on 7 pages at 2 screen sizes (375px, 1440px)',
      '3 pages are covered by Sample Pages and not visited',
      '1 question will use the safe answer',
      '1 item won’t run',
    ]);
  });

  it('expects each role to land where it landed while exploring: signed-out visitors on the sign-in page', async () => {
    const account: PageLink = {
      name: 'My account',
      selector: 'role=link[name="My account"]',
      to: '/account',
      landmark: 'nav',
      landsOnBy: { visitor: '/signin' },
      seenBy: ['visitor', 'member'],
    };
    const both = { links: [account], reachedBy: ['visitor', 'member'] };
    const draft = await draftFor([page('/', [], both), page('/about', [], both)]);
    const { testCases } = expandPlan(draft, { readOnly: false, screenSizes: ['1440px'] });
    const checks = testCases.filter((tc) => tc.kind === 'navigation');
    expect(checks.map((tc) => [tc.role, tc.expectations.url?.pattern])).toEqual([
      ['visitor', '/signin'],
      ['member', '/account'],
    ]);
  });

  it('keeps tests that would send data out of a live site’s run, listed with the reason', async () => {
    const form = page('/contact', [], {
      elements: [el('button', 'Send', '#send', { insideForm: true, inputType: 'submit' })],
    });
    const draft = await draftFor([form], true);
    draft.plan!.pages[0].tests = [
      {
        id: 'pagetest:/contact:1',
        name: 'Send the form',
        role: 'visitor',
        steps: [{ action: 'click', selector: '#send', name: 'Send' }],
        source: 'ai',
        needsTestCopy: true,
      },
    ];
    const { testCases, notRun, wontRun } = expandPlan(draft, { readOnly: true, screenSizes: ['1440px'] });
    expect(testCases.filter((tc) => tc.kind === 'page-test')).toEqual([]);
    expect(notRun).toEqual([expect.objectContaining({ name: 'Send the form' })]);
    expect(wontRun[0].reason).toContain('Needs a test copy');
  });

  it('writes the whole Plan as Markdown', async () => {
    const draft = await draftFor(shop());
    const expanded = expandPlan(draft, { readOnly: false, screenSizes: ['1440px'] });
    const markdown = planToMarkdown({
      runId: 'run-1',
      targetUrl: draft.targetUrl,
      discoveredAt: draft.timestamp,
      pages: draft.pages,
      flows: [],
      questions: draft.ambiguityQuestions,
      planPages: draft.plan!.pages,
      navigation: draft.plan!.navigation,
      layoutGroups: sampleLayoutGroups(draft.pages).groups,
      screenSizes: ['1440px'],
      roles: ['visitor'],
      wontRun: expanded.wontRun,
      summary: expanded.summary,
    });
    expect(markdown).toContain('# Test plan: shop.example');
    expect(markdown).toContain('## Pages (10)');
    expect(markdown).toContain('### Pages like /products/… (6 pages)');
    expect(markdown).toContain('- /products/red-wool-scarf-2 — products/red-wool-scarf-2');
    expect(markdown).toContain('### Shared menus (checked once for the whole site)');
    expect(markdown).toContain('### Links that leave the site (checked with one request each)');
    expect(markdown).toContain('Reached by: Start → Products → green-silk-tie-3');
  });
});
