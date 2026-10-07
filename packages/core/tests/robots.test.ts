import { describe, it, expect } from 'vitest';
import { RobotsPolicy } from '../src/competitive/robots.js';

const UA = 'QA-Benchmarking-Bot';

describe('RobotsPolicy', () => {
  it('allows everything when there are no rules', () => {
    expect(RobotsPolicy.parse('', UA).isAllowed('/pricing')).toBe(true);
    expect(RobotsPolicy.allowAll().isAllowed('/anything')).toBe(true);
  });

  it('applies the wildcard group when no group names our bot', () => {
    const policy = RobotsPolicy.parse('User-agent: *\nDisallow: /admin\n', UA);
    expect(policy.isAllowed('/admin/users')).toBe(false);
    expect(policy.isAllowed('/pricing')).toBe(true);
  });

  it('prefers a group naming our bot over the wildcard group', () => {
    const txt = ['User-agent: *', 'Disallow: /', '', 'User-agent: qa-benchmarking-bot', 'Disallow: /private'].join(
      '\n'
    );
    const policy = RobotsPolicy.parse(txt, UA);
    expect(policy.isAllowed('/pricing')).toBe(true);
    expect(policy.isAllowed('/private/x')).toBe(false);
  });

  it('lets the longest matching rule win, with Allow winning ties', () => {
    const policy = RobotsPolicy.parse('User-agent: *\nDisallow: /docs\nAllow: /docs/public\n', UA);
    expect(policy.isAllowed('/docs/internal')).toBe(false);
    expect(policy.isAllowed('/docs/public/intro')).toBe(true);
  });

  it('supports * and $ wildcards', () => {
    const policy = RobotsPolicy.parse('User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?session=\n', UA);
    expect(policy.isAllowed('/files/guide.pdf')).toBe(false);
    expect(policy.isAllowed('/files/guide.pdf.html')).toBe(true);
    expect(policy.isAllowed('/cart?session=abc')).toBe(false);
  });

  it('treats an empty Disallow as allow-all and ignores comments', () => {
    const policy = RobotsPolicy.parse('User-agent: * # everyone\nDisallow:\n', UA);
    expect(policy.isAllowed('/')).toBe(true);
  });
});
