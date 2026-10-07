import { describe, it, expect } from 'vitest';
import { computeStructuralFingerprint, normalizeRoute, normalizeSelector } from '../src/fingerprint.js';

describe('Structural Fingerprinting & Normalization', () => {
  describe('normalizeRoute', () => {
    it('normalizes full URLs to invariant lowercase pathnames', () => {
      expect(normalizeRoute('http://localhost:3000/checkout')).toBe('/checkout');
      expect(normalizeRoute('https://staging.internal.net:8080/checkout/')).toBe('/checkout');
      expect(normalizeRoute('http://127.0.0.1:4173/app/invoices/')).toBe('/app/invoices');
    });

    it('strips query parameters and hashes', () => {
      expect(normalizeRoute('/checkout?session_id=abc1234&retry=true')).toBe('/checkout');
      expect(normalizeRoute('/dashboard#overview-metrics')).toBe('/dashboard');
      expect(normalizeRoute('http://localhost:3000/users/12?ref=nav#profile')).toBe('/users/12');
    });

    it('handles root and edge cases', () => {
      expect(normalizeRoute('/')).toBe('/');
      expect(normalizeRoute('')).toBe('/');
      expect(normalizeRoute('///')).toBe('/');
    });
  });

  describe('normalizeSelector', () => {
    it('standardizes attribute quotes and internal spacing', () => {
      expect(normalizeSelector("button[data-testid='submit-btn']")).toBe('button[data-testid="submit-btn"]');
      expect(normalizeSelector('  div >   span.label   ')).toBe('div > span.label');
      expect(normalizeSelector(undefined)).toBe('');
    });
  });

  describe('computeStructuralFingerprint', () => {
    it('produces identical fingerprints across different developer hosts, ports, and timestamps', () => {
      const dev1 = computeStructuralFingerprint({
        productId: 'product-a',
        route: 'http://localhost:3000/checkout?token=dev1-token#step2',
        checkerId: 'ux-quality',
        ruleCode: 'contrast-ratio-low',
        selector: "button[data-testid='pay-btn']",
      });

      const dev2 = computeStructuralFingerprint({
        productId: 'PRODUCT-A',
        route: 'https://staging.company.net:8443/checkout/',
        checkerId: 'ux-quality',
        ruleCode: 'contrast-ratio-low',
        selector: 'button[data-testid="pay-btn"]',
      });

      expect(dev1).toBe(dev2);
      expect(dev1).toMatch(/^fp_[a-f0-9]{16}$/);
    });

    it('produces different fingerprints for distinct rules, selectors, or routes', () => {
      const fp1 = computeStructuralFingerprint({
        productId: 'product-a',
        route: '/checkout',
        checkerId: 'ux-quality',
        ruleCode: 'contrast-ratio-low',
        selector: 'button[data-testid="pay-btn"]',
      });

      const fp2 = computeStructuralFingerprint({
        productId: 'product-a',
        route: '/checkout',
        checkerId: 'ux-quality',
        ruleCode: 'target-size-small', // different rule
        selector: 'button[data-testid="pay-btn"]',
      });

      const fp3 = computeStructuralFingerprint({
        productId: 'product-a',
        route: '/invoices', // different route
        checkerId: 'ux-quality',
        ruleCode: 'contrast-ratio-low',
        selector: 'button[data-testid="pay-btn"]',
      });

      expect(fp1).not.toBe(fp2);
      expect(fp1).not.toBe(fp3);
      expect(fp2).not.toBe(fp3);
    });
  });
});
