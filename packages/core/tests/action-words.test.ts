import { describe, it, expect } from 'vitest';
import { actionText, changesData, riskyToClick, sensitiveKind } from '../src/discovery/action-words.js';

describe('action-words', () => {
  describe('actionText', () => {
    it('normalises camelCase, hyphens, underscores and symbols to spaced words', () => {
      expect(actionText('Buy-Now')).toBe('buy now');
      expect(actionText('buy_now')).toBe('buy now');
      expect(actionText('BuyNow')).toBe('buy now');
      expect(actionText('buy  now')).toBe('buy now');
    });
  });

  describe('sensitiveKind', () => {
    const paymentWords = [
      'Place order',
      'Place-order',
      'place_order',
      '#placeOrderBtn',
      'Buy now',
      'Buy Now →',
      'Pay $25.00',
      'Complete purchase',
      'Confirm my order',
      'Upgrade plan',
      'Donate',
      'Transfer funds',
      'Withdraw',
      'Proceed to checkout',
      'Subscribe',
    ];

    it.each(paymentWords)('identifies "%s" as payment', (word) => {
      expect(sensitiveKind(word)).toBe('payment');
    });

    const deletionWords = [
      'Delete account',
      'Close account',
      'Close my account',
      'Cancel account',
      'cancel-account',
      'Cancel my subscription',
      'Deactivate',
      'Unsubscribe',
      'Remove item',
    ];

    it.each(deletionWords)('identifies "%s" as deletion', (word) => {
      expect(sensitiveKind(word)).toBe('deletion');
    });

    const commsWords = [
      'Send email',
      'send-email',
      'Send SMS',
      'Resend code',
      'Send invitation',
      'Invite teammates',
      'Notify all users',
    ];

    it.each(commsWords)('identifies "%s" as external_communication', (word) => {
      expect(sensitiveKind(word)).toBe('external_communication');
    });

    const benignWords = [
      'Save invoice',
      'Display settings',
      'Payroll report',
      'Order history',
      'Close',
      'Dropdown',
      'Learn more',
      'View invoice',
      'Next',
    ];

    it.each(benignWords)('returns null for benign wording "%s"', (word) => {
      expect(sensitiveKind(word)).toBeNull();
    });
  });

  describe('changesData', () => {
    const trueCases = ['Sign up', 'sign-up', 'Add to basket', 'Book now', 'Post comment', 'Place order'];
    it.each(trueCases)('returns true for "%s"', (word) => {
      expect(changesData(word)).toBe(true);
    });

    const falseCases = ['View invoice', 'Next', 'Learn more'];
    it.each(falseCases)('returns false for "%s"', (word) => {
      expect(changesData(word)).toBe(false);
    });
  });

  describe('riskyToClick', () => {
    const trueCases = ['Print', 'Share', 'Download PDF', 'Close', 'Display options', 'Transfer funds', 'Resend code'];
    it.each(trueCases)('returns true for "%s"', (word) => {
      expect(riskyToClick(word)).toBe(true);
    });

    const falseCases = ['Next', 'Learn more', 'Open menu'];
    it.each(falseCases)('returns false for "%s"', (word) => {
      expect(riskyToClick(word)).toBe(false);
    });
  });
});
