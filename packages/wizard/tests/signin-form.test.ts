import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_FAILURE_REASONS, signInReasonText } from '@qa/types/src/browser.js';
import {
  EMPTY_FORM,
  EMPTY_SIGN_IN,
  approveRolesOf,
  headerErrorsOf,
  parseCustomHeaders,
  rolesOf,
  scanBlockedHint,
} from '../src/lib/form';
import { approvePlan, RunnerError, testSiteSignIn } from '../src/api';
import { NewCheckupScreen } from '../src/screens/NewCheckupScreen';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('T-108: header validation', () => {
  it('detects missing colon and line number without leaking header value', () => {
    const errors = headerErrorsOf({ customHeaders: 'X-Token abc' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/line 1/i);
    expect(errors[0]).not.toContain('abc');
  });

  it('accepts valid Header: Value lines', () => {
    const errors = headerErrorsOf({ customHeaders: 'X-Token: abc\nAuthorization: Bearer xyz' });
    expect(errors).toEqual([]);
    const parsed = parseCustomHeaders('X-Token: abc\nAuthorization: Bearer xyz');
    expect(parsed).toEqual({
      'X-Token': 'abc',
      Authorization: 'Bearer xyz',
    });
  });

  it('parseCustomHeaders returns undefined when invalid', () => {
    expect(parseCustomHeaders('invalid header without colon')).toBeUndefined();
    expect(parseCustomHeaders('')).toBeUndefined();
  });
});

describe('T-108: scanBlockedHint and Start button blocking', () => {
  it('returns undefined when no sign-in details are entered', () => {
    const hint = scanBlockedHint(EMPTY_FORM);
    expect(hint).toBeUndefined();
  });

  it('returns hint when sign-in details are typed and consent is unticked', () => {
    const form = {
      ...EMPTY_FORM,
      signIns: [{ ...EMPTY_SIGN_IN, role: 'member', username: 'alice', password: 'secret-password' }],
      signInConsent: false,
    };
    const hint = scanBlockedHint(form);
    expect(hint).toBe("Tick 'I accept this' to scan with sign-in");
  });

  it('returns undefined when sign-in details are typed and consent is ticked', () => {
    const form = {
      ...EMPTY_FORM,
      signIns: [{ ...EMPTY_SIGN_IN, role: 'member', username: 'alice', password: 'secret-password' }],
      signInConsent: true,
    };
    const hint = scanBlockedHint(form);
    expect(hint).toBeUndefined();
  });

  it('renders disabled button with aria-describedby pointing to the hint in NewCheckupScreen markup', () => {
    const form = {
      ...EMPTY_FORM,
      address: 'https://example.com',
      signIns: [{ ...EMPTY_SIGN_IN, role: 'member', username: 'alice', password: 'secret-password' }],
      signInConsent: false,
    };

    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ai: null,
        onKeySaved: () => {},
        form,
        onFormChange: () => {},
        onStart: () => {},
        starting: false,
        startError: null,
        inProgress: null,
        recent: [],
      })
    );

    expect(html).toContain('id="scan-blocked-hint"');
    expect(html).toContain('Tick &#x27;I accept this&#x27; to scan with sign-in');
    expect(html).toMatch(/aria-describedby="[^"]*scan-blocked-hint[^"]*"/);
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-describedby="[^"]*scan-blocked-hint[^"]*"[^>]*>Start the check-up<\/button>/
    );
  });

  it('disables Start the check-up button and renders error when header is invalid', () => {
    const form = {
      ...EMPTY_FORM,
      address: 'https://example.com',
      customHeaders: 'X-Token abc',
    };

    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ai: null,
        onKeySaved: () => {},
        form,
        onFormChange: () => {},
        onStart: () => {},
        starting: false,
        startError: null,
        inProgress: null,
        recent: [],
      })
    );

    expect(html).toContain('role="alert"');
    expect(html).toMatch(/line 1/i);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Start the check-up<\/button>/);
  });
});

describe('T-108: rolesOf includes and omits selectors correctly', () => {
  it('includes selectors when filled and omits them when empty', () => {
    const formWithSelectors = {
      signIns: [
        {
          role: 'admin',
          username: 'alice',
          password: 'pw',
          loginPath: '/login',
          usernameSelector: '#username',
          passwordSelector: '#pass',
          submitSelector: '#submit-btn',
        },
      ],
    };

    const rolesWith = rolesOf(formWithSelectors);
    expect(rolesWith).toEqual([
      {
        role: 'admin',
        username: 'alice',
        password: 'pw',
        loginPath: '/login',
        usernameSelector: '#username',
        passwordSelector: '#pass',
        submitSelector: '#submit-btn',
      },
    ]);

    const formWithoutSelectors = {
      signIns: [
        {
          role: 'member',
          username: 'bob',
          password: 'pw',
          loginPath: '',
          usernameSelector: '',
          passwordSelector: '   ',
          submitSelector: '',
        },
      ],
    };

    const rolesWithout = rolesOf(formWithoutSelectors);
    expect(rolesWithout).toEqual([
      {
        role: 'member',
        username: 'bob',
        password: 'pw',
      },
    ]);
    expect('usernameSelector' in rolesWithout[0]).toBe(false);
    expect('passwordSelector' in rolesWithout[0]).toBe(false);
    expect('submitSelector' in rolesWithout[0]).toBe(false);
  });
});

describe('T-108: keyboard accessibility of file inputs', () => {
  it('file inputs in NewCheckupScreen use sr-only and not display:none or hidden', () => {
    const html = renderToStaticMarkup(
      createElement(NewCheckupScreen, {
        ai: null,
        onKeySaved: () => {},
        form: EMPTY_FORM,
        onFormChange: () => {},
        onStart: () => {},
        starting: false,
        startError: null,
        inProgress: null,
        recent: [],
      })
    );

    // Matches type="file" inputs
    const fileInputs = html.match(/<input[^>]*type="file"[^>]*>/g) || [];
    expect(fileInputs.length).toBeGreaterThanOrEqual(2);
    for (const input of fileInputs) {
      expect(input).toContain('sr-only');
      expect(input).not.toContain('class="hidden"');
      expect(input).not.toContain('display:none');
      expect(input).not.toContain('display: none');
    }
  });
});

describe('T-108: testSiteSignIn error handling with known failure reasons', () => {
  it('returns verified false with known reason on 422 instead of throwing generic error', async () => {
    for (const reason of SIGN_IN_FAILURE_REASONS) {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(JSON.stringify({ verified: false, reason, error: 'internal server text' }), { status: 422 })
        )
      );

      const res = await testSiteSignIn('example.com', 'admin');
      expect(res.verified).toBe(false);
      expect(res.reason).toBe(reason);
      expect(res.error).toBe(signInReasonText(reason));
      expect(res.error).not.toContain('internal server text');
    }
  });

  it('sends customHeaders when provided', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return new Response(JSON.stringify({ verified: true }), { status: 200 });
      })
    );

    await testSiteSignIn('example.com', 'admin', 'X-Custom: 123');
    expect(bodies[0]).toContain('"customHeaders":"X-Custom: 123"');
  });
});

describe('T-108: approveRolesOf with pending array', () => {
  it('returns every pending role when pending array is provided', () => {
    const roles = approveRolesOf('user', 'secret', ['admin', 'editor']);
    expect(roles).toEqual([
      { role: 'admin', username: 'user', password: 'secret' },
      { role: 'editor', username: 'user', password: 'secret' },
    ]);
  });

  it('falls back to single member role when pending is omitted or empty', () => {
    const roles = approveRolesOf('user', 'secret');
    expect(roles).toEqual([{ role: 'member', username: 'user', password: 'secret' }]);

    const rolesEmptyPending = approveRolesOf('user', 'secret', []);
    expect(rolesEmptyPending).toEqual([{ role: 'member', username: 'user', password: 'secret' }]);
  });
});

describe('T-108: approvePlan customHeaders and RunnerError needsHeaders', () => {
  it('sends customHeaders when provided and omits when absent', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response('{}', { status: 200 });
      })
    );

    await approvePlan({
      roles: [{ role: 'member', username: 'u', password: 'p' }],
      customHeaders: 'Authorization: Bearer xyz',
    });
    expect(bodies[0].customHeaders).toBe('Authorization: Bearer xyz');

    await approvePlan({
      roles: [{ role: 'member', username: 'u', password: 'p' }],
    });
    expect(bodies[1].customHeaders).toBeUndefined();
  });

  it('exposes needsHeaders and needsSignIn from 409 body on RunnerError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'Headers needed',
              code: 'ERR_HEADERS_NOT_SAVED',
              needsHeaders: ['Authorization', 'X-Api-Key'],
              needsSignIn: ['admin'],
            }),
            { status: 409 }
          )
      )
    );

    let caught: unknown;
    try {
      await approvePlan({
        roles: [],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(RunnerError);
    const runnerErr = caught as RunnerError;
    expect(runnerErr.code).toBe('ERR_HEADERS_NOT_SAVED');
    expect(runnerErr.needsHeaders).toEqual(['Authorization', 'X-Api-Key']);
    expect(runnerErr.needsSignIn).toEqual(['admin']);
  });
});
