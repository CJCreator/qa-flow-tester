import type { SensitiveAction } from '@qa/types';

/**
 * Wording is matched on normalised text: camelCase split, lower case, every run of anything that is not a
 * letter or digit becomes one space. "Buy-Now", "buy_now", "BuyNow" and "buy  now" all read "buy now".
 */
export function actionText(...parts: string[]): string {
  return parts
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Phrases in normalised words; `(x )?` marks an optional word.
const DELETION = [
  'delete',
  'remove',
  'destroy',
  'purge',
  'erase',
  'drop',
  'truncate',
  'wipe',
  'deactivate',
  'terminate',
  'revoke',
  'unsubscribe',
  '(cancel|close) (my )?account',
  'cancel (my )?(subscription|membership|plan)',
];
const PAYMENT = [
  'pay',
  'pay now',
  'payment',
  'charge',
  'checkout',
  'purchase',
  'subscribe',
  'buy now',
  'credit card',
  'place (my )?order',
  'order now',
  'reorder',
  '(confirm|complete|submit) (my )?order',
  'donate',
  'transfer',
  'withdraw',
  'top up',
  'upgrade',
  'invoice pay',
];
const MESSAGING = [
  '(re)?send (an )?(email|e mail|sms|text|message|invite|invitation|code)',
  'resend',
  'email blast',
  'notify (all )?users',
  'broadcast',
  'invite (all )?(users|teammates)',
];
/** Changes data but is not a Sensitive Action: a journey with it needs a Test Copy (today's CHANGES_SOMETHING). */
const CHANGES = [
  'save',
  'submit',
  'send',
  'buy',
  'order',
  'register',
  'sign up',
  'create',
  'publish',
  'comment',
  'confirm',
  'finish',
  'upload',
  'reserve',
  'book now',
  'add to (cart|basket|bag)',
  'check out',
  'update',
];
/** Today's RISKY_TO_CLICK words. Matched anywhere in the text, as today, so "Display" still counts as "pay". */
const NOT_WHILE_EXPLORING = [
  'reset',
  'delete',
  'remove',
  'destroy',
  'clear',
  'cancel',
  'pay',
  'purchase',
  'buy',
  'place order',
  'subscribe',
  'send',
  'submit',
  'finish',
  'confirm',
  'save',
  'apply',
  'upload',
  'download',
  'print',
  'share',
  'invite',
  'deactivate',
  'close',
  'display',
];

const asWords = (list: string[]) => new RegExp(`\\b(?:${list.join('|')})\\b`);
const KINDS: Array<[SensitiveAction['type'], RegExp]> = [
  ['deletion', asWords(DELETION)],
  ['payment', asWords(PAYMENT)],
  ['external_communication', asWords(MESSAGING)],
];
const CHANGES_WORDS = asWords(CHANGES);
const RISKY_ANYWHERE = new RegExp(`(?:${NOT_WHILE_EXPLORING.join('|')})`);

/** The kind of Sensitive Action the wording names, or null. */
export function sensitiveKind(...parts: string[]): SensitiveAction['type'] | null {
  const text = actionText(...parts);
  return KINDS.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** True when pressing it saves, sends, pays for or deletes something. */
export function changesData(...parts: string[]): boolean {
  return sensitiveKind(...parts) !== null || CHANGES_WORDS.test(actionText(...parts));
}

/** Never clicked while exploring: today's list, plus every Sensitive Action. */
export function riskyToClick(name: string): boolean {
  return RISKY_ANYWHERE.test(actionText(name)) || sensitiveKind(name) !== null;
}
