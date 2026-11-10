import { describe, expect, it } from 'vitest';
import { RowKeys } from '../src/lib/row-keys';

describe('RowKeys', () => {
  it('gives each row its own key and keeps it', () => {
    const k = new RowKeys();
    expect([...k.for(3)]).toEqual([1, 2, 3]);
    expect([...k.for(3)]).toEqual([1, 2, 3]);
  });
  it('keeps the other rows’ keys when one is removed', () => {
    const k = new RowKeys();
    k.for(3);
    k.remove(0);
    expect([...k.for(2)]).toEqual([2, 3]);
  });
  it('gives a new row a key never used before', () => {
    const k = new RowKeys();
    k.for(2);
    k.remove(1);
    expect([...k.for(2)]).toEqual([1, 3]);
  });
  it('drops extra keys when the list was shortened elsewhere', () => {
    const k = new RowKeys();
    k.for(3);
    expect([...k.for(1)]).toEqual([1]);
  });
});
