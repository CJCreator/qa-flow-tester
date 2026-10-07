import { describe, it, expect } from 'vitest';
import type { ElementInventoryItem, PageInventoryItem } from '@qa/types';
import { detectSiteType, generateFallbackJourneys } from '../src/discovery/site-type.js';
import type { SpiderResult } from '../src/discovery/deterministic-spider.js';

const el = (
  role: string,
  name: string,
  selector: string,
  extra: Partial<ElementInventoryItem> = {}
): ElementInventoryItem => ({
  role,
  name,
  selector,
  tagName: role === 'link' ? 'a' : role === 'textbox' ? 'input' : 'button',
  visible: true,
  enabled: true,
  ...extra,
});

const page = (
  urlPath: string,
  title: string,
  elements: ElementInventoryItem[] = [],
  extra: Partial<PageInventoryItem> = {}
): PageInventoryItem => ({
  urlPath,
  title,
  interactiveElementsCount: elements.length,
  formsCount: 0,
  elements,
  ...extra,
});

const spider = (pages: PageInventoryItem[], forms: SpiderResult['forms'] = []): SpiderResult => ({
  pages,
  forms,
  sensitiveActions: [],
  ambiguityQuestions: [],
  signInWalls: [],
});

// What the scan of books.toscrape.com records (its address says nothing about shopping).
const books = [
  page('/', 'All products | Books to Scrape - Sandbox', [
    el('link', 'A Light in the Attic', 'role=link[name="A Light in the Attic"]', {
      href: 'catalogue/a-light-in-the-attic_1000/index.html',
    }),
    el('button', 'Add to basket', 'role=button[name="Add to basket"]', { insideForm: true }),
  ]),
  page('/catalogue/a-light-in-the-attic_1000/index.html', 'A Light in the Attic | Books to Scrape - Sandbox', [
    el('button', 'Add to basket', 'role=button[name="Add to basket"]', { insideForm: true }),
  ]),
];

// TodoMVC: one screen, one field outside any form.
const todo = [
  page('/todomvc/', 'React • TodoMVC', [el('textbox', 'What needs to be done?', '.new-todo', { inputType: 'text' })]),
];

describe('Site type (Task 1.4 / D4)', () => {
  it('names a shop from its pages and buttons, not its address', () => {
    expect(detectSiteType(books, 'https://books.toscrape.com/')).toBe('shop');
  });

  it('names a one-screen to-do list an app', () => {
    expect(detectSiteType(todo, 'https://demo.playwright.dev/todomvc/')).toBe('app');
  });

  it('reads whole words in an address: a workshop is not a shop', () => {
    expect(detectSiteType([page('/', 'Welcome')], 'https://shop.example.com/')).toBe('shop');
    expect(detectSiteType([page('/', 'Welcome')], 'https://workshop.example.com/')).toBe('other');
  });

  it('names SaaS and content sites from their pages', () => {
    const saas = [page('/dashboard', 'Team Dashboard', [el('button', 'Upgrade Plan', 'button.upgrade')])];
    expect(detectSiteType(saas, 'https://cloud-app.io/dashboard')).toBe('SaaS');

    const content = [
      page('/blog/first-post', 'Company Blog Articles & News'),
      page('/guides/getting-started', 'Documentation Guide'),
    ];
    expect(detectSiteType(content, 'https://news-docs.org')).toBe('content');
  });

  it('gives the same answer for the same pages every time', () => {
    const answers = new Set(Array.from({ length: 5 }, () => detectSiteType(books, 'https://books.toscrape.com/')));
    expect(answers.size).toBe(1);
  });
});

describe('Journeys without AI', () => {
  it('plans browse → book for a shop, plus a visit to the main pages', () => {
    const journeys = generateFallbackJourneys('shop', spider(books));
    const browse = journeys.find((j) => j.name === 'Browse and view product');
    expect(
      browse?.steps.some((s) => s.action === 'click' && s.selector === 'role=link[name="A Light in the Attic"]')
    ).toBe(true);
    expect(journeys.at(-1)?.name).toBe('Visit the main pages');
    for (const j of journeys) {
      expect(j.description.length, j.name).toBeGreaterThan(10);
      expect(j.source).toBe('fallback');
    }
  });

  it('types into the main field of an app', () => {
    const journeys = generateFallbackJourneys('app', spider(todo));
    expect(journeys[0].steps.some((s) => s.action === 'fill' && s.selector === '.new-todo')).toBe(true);
  });

  it('sends each ordinary form, never the sign-in form', () => {
    const pages = [
      page('/', 'Home'),
      page('/contact', 'Contact Us'),
      page('/login', 'Sign in', [], { hasSignInForm: true }),
    ];
    const forms: SpiderResult['forms'] = [
      {
        action: '/contact',
        method: 'POST',
        urlPath: '/contact',
        submitButtonSelector: 'button[type="submit"]',
        inputs: [
          { type: 'text', name: 'name', selector: 'input[name="name"]', label: 'Full Name' },
          { type: 'email', name: 'email', selector: 'input[name="email"]', label: 'Email Address' },
        ],
      },
      {
        action: '/login',
        method: 'POST',
        urlPath: '/login',
        submitButtonSelector: '#sign-in',
        inputs: [
          { type: 'email', name: 'email', selector: '#email', label: 'Email' },
          { type: 'password', name: 'password', selector: '#password', label: 'Password' },
        ],
      },
    ];
    const journeys = generateFallbackJourneys('other', spider(pages, forms));
    expect(journeys.map((j) => j.name)).toEqual(['Send the form on /contact', 'Visit the main pages']);
    // The sign-in page isn't one of the main pages to visit either: roles sign in before tests run.
    expect(journeys[1].steps.map((s) => s.value)).toEqual(['/', '/contact']);
  });
});
