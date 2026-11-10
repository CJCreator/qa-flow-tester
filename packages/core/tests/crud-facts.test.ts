/** CRUD facts come from structure; the Delete probe cancels at the confirm and sends nothing (ADR 0025). */
import { describe, it, expect } from 'vitest';
import { inferCrud, isNavigatingLink } from '../src/discovery/crud-facts.js';

describe('inferCrud', () => {
  it('reads a list with Add, row Edit and row Delete', () => {
    expect(
      inferCrud({ listRows: 2, addNames: ['Home', 'Add item'], rowControlNames: ['Edit', 'Delete', 'Edit', 'Delete'] })
    ).toEqual({ list: true, add: 'Add item', editFromRow: true });
  });
  it('is nothing for a page with no rows, or rows with no managing controls', () => {
    expect(inferCrud({ listRows: 0, addNames: ['Add item'], rowControlNames: [] })).toBeUndefined();
    expect(inferCrud({ listRows: 3, addNames: ['Home'], rowControlNames: ['View'] })).toBeUndefined();
  });
});

describe('isNavigatingLink', () => {
  it('is true only for a link with a real address', () => {
    expect(isNavigatingLink('A', '/items/42/delete')).toBe(true);
    expect(isNavigatingLink('a', 'https://example.com/x')).toBe(true);
    expect(isNavigatingLink('A', '#')).toBe(false);
    expect(isNavigatingLink('A', '#row-2')).toBe(false);
    expect(isNavigatingLink('A', 'javascript:void(0)')).toBe(false);
    expect(isNavigatingLink('A', '')).toBe(false);
    expect(isNavigatingLink('A', null)).toBe(false);
    expect(isNavigatingLink('BUTTON', '/x')).toBe(false);
  });
});
