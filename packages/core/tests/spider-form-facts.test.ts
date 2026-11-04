/** The Spider records the attributes a form field sets (type, required, pattern, limits) as facts. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { chromium, type Browser } from 'playwright';
import { DeterministicSpider } from '../src/discovery/deterministic-spider.js';

// Own port: access-token.test.ts uses 3562, and the two clashed when they ran at the same time.
const PORT = 3563;
const PAGE = `<!doctype html><html lang="en"><head><title>Sign up</title></head><body><h1>Sign up</h1>
<form method="post" action="/done">
  <label for="em">Email</label><input id="em" name="email" type="email" required>
  <label for="zip">Zip</label><input id="zip" name="zip" type="text" pattern="[0-9]{5}" minlength="5" maxlength="5">
  <label for="age">Age</label><input id="age" name="age" type="number" min="18" max="99">
  <label for="bio">Bio</label><textarea id="bio" name="bio"></textarea>
  <button type="submit">Join</button>
</form></body></html>`;

describe('DeterministicSpider: form input facts', () => {
  let server: http.Server;
  let browser: Browser;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE);
    });
    await new Promise<void>((resolve) => server.listen(PORT, resolve));
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('reads required, pattern, min, max, minlength and maxlength off each field', async () => {
    const context = await browser.newContext();
    const result = await new DeterministicSpider().crawl(context, `http://localhost:${PORT}/`);
    await context.close();

    const form = result.forms.find((f) => f.urlPath === '/')!;
    const by = (name: string) => form.inputs.find((i) => i.name === name)!;
    expect(by('email')).toMatchObject({ type: 'email', required: true, label: 'Email' });
    expect(by('zip')).toMatchObject({ pattern: '[0-9]{5}', minLength: 5, maxLength: 5, required: false });
    expect(by('age')).toMatchObject({ type: 'number', min: '18', max: '99' });
    expect(by('bio').pattern).toBeUndefined();
    expect(by('bio').maxLength).toBeUndefined();
  });
});
