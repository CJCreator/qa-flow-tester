import { describe, it, expect } from 'vitest';
import type { DiscoveredFlow, PageInventoryItem } from '@qa/types';
import { isTestHost, needsTestCopy, resolveTestHost } from '../src/live-site.js';
import { buildPageSweep } from '../src/discovery/page-sweep.js';

describe('Test hosts (Task 1.5 / D3)', () => {
  it('treats this machine, private networks, Docker and dev tunnels as test copies', () => {
    for (const host of [
      'localhost',
      '127.0.0.1',
      '::1',
      '[::1]',
      'host.docker.internal',
      '10.0.0.4',
      '172.20.1.9',
      '192.168.1.20',
      'app.localhost',
      'abc123-3050.uks1.devtunnels.ms',
      'fd12:3456::1',
    ]) {
      expect(isTestHost(host), host).toBe(true);
    }
  });

  it('treats everything else as live, unless the owner marked it as staging', () => {
    for (const host of ['www.saucedemo.com', 'books.toscrape.com', '172.32.0.1', '8.8.8.8', 'devtunnels.ms.evil.com']) {
      expect(isTestHost(host), host).toBe(false);
    }
    expect(isTestHost('staging.example.com', ['staging.example.com'])).toBe(true);
    expect(isTestHost('www.example.com', ['staging.example.com'])).toBe(false);
  });
});

describe('isTestHost on a shared machine (resolveTestHost, ADR 0014)', () => {
  const pub = async () => ['93.184.216.34'];
  const shared = (over: Partial<Parameters<typeof resolveTestHost>[1]> = {}) => ({
    shared: true,
    marked: true,
    origin: 'https://preview.example.com',
    lookup: pub,
    proof: async () => true,
    ...over,
  });

  it('isTestHost: a marked host without proof is not a Test Copy on a shared machine', async () => {
    const r = await resolveTestHost('preview.example.com', shared({ proof: async () => false }));
    expect(r).toMatchObject({ testCopy: false, reason: 'not-verified' });
  });

  it('isTestHost: marked, public and proven is a Test Copy; proven but not marked is not', async () => {
    expect(await resolveTestHost('preview.example.com', shared())).toMatchObject({
      testCopy: true,
      reason: 'verified-marked',
    });
    let fetched = 0;
    const r = await resolveTestHost(
      'preview.example.com',
      shared({
        marked: false,
        proof: async () => {
          fetched++;
          return true;
        },
      })
    );
    expect(r).toMatchObject({ testCopy: false, reason: 'not-marked' });
    expect(fetched).toBe(0);
  });

  it('isTestHost refuses a name that resolves to loopback (127.0.0.1) and (::1)', async () => {
    for (const address of ['127.0.0.1', '::1']) {
      const r = await resolveTestHost('preview.example.com', shared({ lookup: async () => [address] }));
      expect(r, address).toMatchObject({ testCopy: false, reason: 'bad-address' });
    }
  });

  it('isTestHost refuses a name that resolves to 10.0.0.4, 172.16.0.1, 192.168.1.1, link-local, metadata, mapped and 0.0.0.0', async () => {
    for (const address of [
      '10.0.0.4',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.1.1',
      'fe80::1',
      '169.254.169.254',
      'fd00:ec2::254',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '0.0.0.0',
      '::',
    ]) {
      const r = await resolveTestHost('preview.example.com', shared({ lookup: async () => [address] }));
      expect(r, address).toMatchObject({ testCopy: false, reason: 'bad-address' });
    }
  });

  it('isTestHost fails closed on a mixed, empty, failed or slow lookup, and never fetches the proof then', async () => {
    let fetched = 0;
    const proof = async () => {
      fetched++;
      return true;
    };
    const cases: Array<() => Promise<string[]>> = [
      async () => ['8.8.8.8', '10.0.0.1'],
      async () => [],
      async () => {
        throw new Error('SERVFAIL');
      },
      () => Promise.reject(new Error('timeout')),
    ];
    for (const lookup of cases) {
      const r = await resolveTestHost('preview.example.com', shared({ lookup, proof }));
      expect(r.testCopy).toBe(false);
    }
    expect(fetched).toBe(0);
  });

  it('isTestHost: this machine’s names, private literals, dev tunnels and plain http are not Test Copies there', async () => {
    for (const [host, origin] of [
      ['localhost', 'https://localhost'],
      ['app.localhost', 'https://app.localhost'],
      ['127.0.0.1', 'https://127.0.0.1'],
      ['10.0.0.4', 'https://10.0.0.4'],
      ['abc-3050.uks1.devtunnels.ms', 'http://abc-3050.uks1.devtunnels.ms'],
      ['host.docker.internal', 'https://host.docker.internal'],
    ]) {
      const r = await resolveTestHost(host, shared({ origin, lookup: pub }));
      expect(r.testCopy, host).toBe(false);
    }
    // https is required: an http origin can never be verified, and is not even fetched.
    let fetched = 0;
    const r = await resolveTestHost(
      'preview.example.com',
      shared({
        origin: 'http://preview.example.com',
        proof: async () => {
          fetched++;
          return true;
        },
      })
    );
    expect(r).toMatchObject({ testCopy: false, reason: 'not-verified' });
    expect(fetched).toBe(0);
  });

  it('a proof that throws is not a Test Copy', async () => {
    const r = await resolveTestHost(
      'preview.example.com',
      shared({
        proof: async () => {
          throw new Error('boom');
        },
      })
    );
    expect(r.testCopy).toBe(false);
  });

  it('isTestHost in local mode keeps the text-only rule and makes no lookup', async () => {
    let looked = 0;
    const lookup = async () => {
      looked++;
      return ['127.0.0.1'];
    };
    for (const host of ['localhost', '10.0.0.4', 'abc-3050.uks1.devtunnels.ms', 'host.docker.internal']) {
      const r = await resolveTestHost(host, { shared: false, marked: false, origin: `http://${host}`, lookup });
      expect(r.testCopy, host).toBe(true);
    }
    expect(
      (
        await resolveTestHost('www.example.com', {
          shared: false,
          marked: true,
          origin: 'http://www.example.com',
          lookup,
        })
      ).testCopy
    ).toBe(true);
    expect(
      (
        await resolveTestHost('www.example.com', {
          shared: false,
          marked: false,
          origin: 'http://www.example.com',
          lookup,
        })
      ).testCopy
    ).toBe(false);
    expect(looked).toBe(0);
  });
});

describe('Journeys that need a test copy', () => {
  const pages: PageInventoryItem[] = [
    {
      urlPath: '/',
      title: 'Shop',
      interactiveElementsCount: 4,
      formsCount: 1,
      elements: [
        {
          role: 'link',
          name: 'Backpack',
          selector: '#item-4',
          tagName: 'a',
          href: '/item/4',
          visible: true,
          enabled: true,
        },
        { role: 'button', name: 'Add to cart', selector: '#add-4', tagName: 'button', visible: true, enabled: true },
        { role: 'button', name: 'Open menu', selector: '#menu', tagName: 'button', visible: true, enabled: true },
        {
          role: 'button',
          name: 'Search',
          selector: '#search-go',
          tagName: 'button',
          visible: true,
          enabled: true,
          insideForm: true,
        },
      ],
    },
  ];
  const forms = [{ urlPath: '/', inputs: [{ selector: '#q' }], submitButtonSelector: '#search-go', method: 'GET' }];
  const flow = (steps: DiscoveredFlow['steps']): DiscoveredFlow => ({
    id: 'F',
    name: 'Journey',
    role: 'visitor',
    description: '',
    startPage: '/',
    steps,
  });

  it('browsing, opening menus, typing and searching need nothing', () => {
    expect(
      needsTestCopy(
        flow([
          { action: 'click', selector: '#menu', name: 'Open menu' },
          { action: 'click', selector: '#item-4', name: 'Open the backpack' },
          { action: 'fill', selector: '#q', value: 'bag', name: 'Type a search' },
          { action: 'click', selector: '#search-go', name: 'Search' },
        ]),
        pages,
        forms
      )
    ).toBe(false);
  });

  it('adding to a cart, sending a POST form or paying needs a test copy', () => {
    expect(needsTestCopy(flow([{ action: 'click', selector: '#add-4', name: 'Add to cart' }]), pages, forms)).toBe(
      true
    );
    expect(
      needsTestCopy(flow([{ action: 'click', selector: '#send', name: 'Go' }]), pages, [
        { urlPath: '/', inputs: [], submitButtonSelector: '#send', method: 'POST' },
      ])
    ).toBe(true);
    expect(needsTestCopy(flow([{ action: 'click', selector: '#pay', name: 'Pay now' }]), pages, forms)).toBe(true);
  });
});

describe('Page sweep (Task 0.8)', () => {
  it('visits each page once for everyone who reached it', () => {
    const sweep = buildPageSweep({
      version: '1',
      productId: 'p',
      targetUrl: 'http://localhost',
      timestamp: '',
      pages: [
        { urlPath: '/', title: 'Home', interactiveElementsCount: 0, formsCount: 0, reachedBy: ['visitor', 'manager'] },
        { urlPath: '/account', title: 'Account', interactiveElementsCount: 0, formsCount: 0, reachedBy: ['manager'] },
      ],
      flows: [],
      sensitiveActions: [],
      ambiguityQuestions: [],
    });
    expect(sweep.map((tc) => `${tc.startPage} ${tc.role}`)).toEqual(['/ visitor', '/ manager', '/account manager']);
    expect(new Set(sweep.map((tc) => tc.id)).size).toBe(3);
  });
});
