import { describe, it, expect } from 'vitest';
import { parseSessionFile, MAX_SESSION_BYTES } from '../src/lib/session-file';

const good = JSON.stringify({ cookies: [{ name: 'sid', value: 'SECRET-SENTINEL', domain: 'a.test' }], origins: [] });

describe('parseSessionFile', () => {
  it('accepts a storage state', () => {
    expect(parseSessionFile('s.json', good.length, good).ok).toBe(true);
  });
  it('rejects non-JSON, bad shape, oversize, bad cookie', () => {
    expect(parseSessionFile('s.json', 3, 'abc')).toMatchObject({ ok: false });
    expect(parseSessionFile('s.json', 2, '[]')).toMatchObject({ ok: false });
    expect(parseSessionFile('s.json', 2, '{"cookies":1,"origins":[]}')).toMatchObject({ ok: false });
    expect(parseSessionFile('s.json', MAX_SESSION_BYTES + 1, good)).toMatchObject({ ok: false });
    expect(parseSessionFile('s.json', 9, '{"cookies":[{}],"origins":[]}')).toMatchObject({ ok: false });
  });
  it('never puts file contents in a message', () => {
    const msgs = [
      parseSessionFile('s.json', 3, 'SECRET-SENTINEL'),
      parseSessionFile('s.json', MAX_SESSION_BYTES + 1, good),
      parseSessionFile('s.json', 5, '{"cookies":[{"value":"SECRET-SENTINEL"}],"origins":[]}'),
    ].map((r) => (r.ok ? '' : r.message));
    for (const m of msgs) expect(m).not.toMatch(/SECRET-SENTINEL/);
  });
});
