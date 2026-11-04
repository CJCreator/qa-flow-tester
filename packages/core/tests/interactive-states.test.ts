/** The Spider opens tabs, accordions, drawers and dialogs, records what opens them, and sends nothing (ADR 0025). */
import { describe, it, expect } from 'vitest';
import { openerCandidates } from '../src/discovery/interactive-states.js';

describe('Spider: Interactive States', () => {
  it('does not offer a control that deletes or sits in a form as an opener', () => {
    const el = (name: string, extra = {}) => ({
      role: 'button',
      name,
      selector: `#${name}`,
      tagName: 'button',
      visible: true,
      enabled: true,
      ...extra,
    });
    const found = openerCandidates([el('Add item'), el('Plain'), el('Menu', { toggles: true })]).map((e) => e.name);
    expect(found).toEqual(['Add item', 'Menu']);
  });
});
