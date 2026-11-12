import { describe, it, expect } from 'vitest';
import {
  SecurityChecker,
  parseCsp,
  hstsMaxAge,
  frameAncestorsAllowsAll,
  type SecurityContext,
} from '../src/security.js';

describe('parseCsp', () => {
  it('parses directives into map with directive name lower-cased', () => {
    const csp = parseCsp("DEFAULT-SRC 'self'; SCRIPT-SRC 'self' https://Example.com; object-src 'none'");
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'", 'https://Example.com']);
    expect(csp.get('object-src')).toEqual(["'none'"]);
  });

  it('preserves token casing', () => {
    const csp = parseCsp("script-src 'nonce-R4nd0mStr1ng' https://CDN.Vendor.COM");
    expect(csp.get('script-src')).toEqual(["'nonce-R4nd0mStr1ng'", 'https://CDN.Vendor.COM']);
  });

  it('keeps the first occurrence of a directive', () => {
    const csp = parseCsp("default-src 'self'; script-src 'self'; default-src 'none'");
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
  });

  it('handles directives with no tokens', () => {
    const csp = parseCsp('upgrade-insecure-requests; frame-ancestors');
    expect(csp.has('upgrade-insecure-requests')).toBe(true);
    expect(csp.get('upgrade-insecure-requests')).toEqual([]);
    expect(csp.has('frame-ancestors')).toBe(true);
    expect(csp.get('frame-ancestors')).toEqual([]);
  });

  it('handles empty string and extra whitespace/semicolons', () => {
    const csp = parseCsp("  ;;  default-src   'self'   ; ;  ");
    expect(csp.size).toBe(1);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(parseCsp('').size).toBe(0);
  });
});

describe('hstsMaxAge', () => {
  it('extracts max-age integer from standard header values', () => {
    expect(hstsMaxAge('max-age=31536000')).toBe(31536000);
    expect(hstsMaxAge('max-age=31536000; includeSubDomains')).toBe(31536000);
    expect(hstsMaxAge('includeSubDomains; max-age=15552000; preload')).toBe(15552000);
  });

  it('handles case-insensitivity and optional quotes', () => {
    expect(hstsMaxAge('MAX-AGE="31536000"')).toBe(31536000);
    expect(hstsMaxAge("Max-Age='15552000'")).toBe(15552000);
    expect(hstsMaxAge('max-age = "86400"')).toBe(86400);
    expect(hstsMaxAge('max-age=0')).toBe(0);
  });

  it('returns undefined when max-age is missing or invalid', () => {
    expect(hstsMaxAge('includeSubDomains; preload')).toBeUndefined();
    expect(hstsMaxAge('max-age=abc')).toBeUndefined();
    expect(hstsMaxAge('max-age=')).toBeUndefined();
    expect(hstsMaxAge('')).toBeUndefined();
    expect(hstsMaxAge('not-max-age=31536000')).toBeUndefined();
  });
});

describe('frameAncestorsAllowsAll', () => {
  it('returns true when frame-ancestors directive is missing or empty', () => {
    expect(frameAncestorsAllowsAll(new Map())).toBe(true);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', []]]))).toBe(true);
  });

  it('returns true when frame-ancestors contains *, http:, or https: as a token', () => {
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ['*']]]))).toBe(true);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ["'self'", '*']]]))).toBe(true);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ['http:']]]))).toBe(true);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ['HTTP:']]]))).toBe(true);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ['https:']]]))).toBe(true);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ['HTTPS:']]]))).toBe(true);
  });

  it('returns false when frame-ancestors is restricted to specific origins or none/self', () => {
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ["'self'"]]]))).toBe(false);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ["'none'"]]]))).toBe(false);
    expect(frameAncestorsAllowsAll(new Map([['frame-ancestors', ['https://trusted.example.com']]]))).toBe(false);
  });
});

describe('SecurityChecker header checks (HSTS-WEAK, CSP-UNSAFE, CLICKJACK)', () => {
  const checker = new SecurityChecker();
  const ctx: SecurityContext & { urlPath: string; isHttps?: boolean } = {
    testCaseId: 'T339',
    role: 'visitor',
    breakpoint: '1440px',
    urlPath: '/dashboard',
    isHttps: true,
  };

  describe('HSTS-WEAK', () => {
    it('flags HSTS with max-age < 15552000 as Minor finding F-SEC-<id>-HSTS-WEAK', () => {
      const findings = checker.checkHeaders(
        {
          'strict-transport-security': 'max-age=86400; includeSubDomains',
          'content-security-policy': "default-src 'self'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-frame-options': 'DENY',
        },
        ctx
      );

      const weak = findings.find((f) => f.id === 'F-SEC-T339-HSTS-WEAK');
      expect(weak).toBeDefined();
      expect(weak?.severity).toBe('Minor');
      expect(weak?.title).toBe('Strict-Transport-Security max-age is too short or missing');
      expect(weak?.expectedVsActual.expected).toBe('max-age of at least 15552000 seconds');
      expect(weak?.expectedVsActual.actual).toBe('"max-age=86400; includeSubDomains"');
    });

    it('flags HSTS with missing or invalid max-age directive as HSTS-WEAK', () => {
      const findings = checker.checkHeaders(
        {
          'strict-transport-security': 'includeSubDomains; preload',
          'content-security-policy': "default-src 'self'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-frame-options': 'DENY',
        },
        ctx
      );

      const weak = findings.find((f) => f.id === 'F-SEC-T339-HSTS-WEAK');
      expect(weak).toBeDefined();
      expect(weak?.title).toBe('Strict-Transport-Security max-age is too short or missing');
      expect(weak?.expectedVsActual.actual).toBe('"includeSubDomains; preload"');
    });

    it('does not flag HSTS when max-age is at least 15552000 seconds', () => {
      const findings = checker.checkHeaders(
        {
          'strict-transport-security': 'max-age=15552000; includeSubDomains',
          'content-security-policy': "default-src 'self'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-frame-options': 'DENY',
        },
        ctx
      );

      expect(findings.some((f) => f.id.includes('HSTS'))).toBe(false);
    });

    it('does not check HSTS when not HTTPS', () => {
      const findings = checker.checkHeaders(
        {
          'strict-transport-security': 'max-age=100',
        },
        { ...ctx, isHttps: false }
      );

      expect(findings.some((f) => f.id.includes('HSTS'))).toBe(false);
    });
  });

  describe('CSP-UNSAFE', () => {
    it('flags script-src with unsafe-inline without nonce or strict-dynamic', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-frame-options': 'DENY',
        },
        { ...ctx, isHttps: false }
      );

      const unsafe = findings.find((f) => f.id === 'F-SEC-T339-CSP-UNSAFE');
      expect(unsafe).toBeDefined();
      expect(unsafe?.severity).toBe('Minor');
      expect(unsafe?.title).toBe('Content-Security-Policy allows unsafe script sources');
      expect(unsafe?.expectedVsActual.actual).toBe("'unsafe-inline'");
    });

    it('flags script-src with unsafe-eval', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "script-src 'self' 'unsafe-eval'",
        },
        { ...ctx, isHttps: false }
      );

      const unsafe = findings.find((f) => f.id === 'F-SEC-T339-CSP-UNSAFE');
      expect(unsafe).toBeDefined();
      expect(unsafe?.expectedVsActual.actual).toBe("'unsafe-eval'");
    });

    it('flags both unsafe-inline and unsafe-eval together in actual', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        },
        { ...ctx, isHttps: false }
      );

      const unsafe = findings.find((f) => f.id === 'F-SEC-T339-CSP-UNSAFE');
      expect(unsafe).toBeDefined();
      expect(unsafe?.expectedVsActual.actual).toBe("'unsafe-inline', 'unsafe-eval'");
    });

    it('ignores unsafe-inline when a nonce is present', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "script-src 'self' 'unsafe-inline' 'nonce-random123'",
        },
        { ...ctx, isHttps: false }
      );

      expect(findings.some((f) => f.id.includes('CSP-UNSAFE'))).toBe(false);
    });

    it('ignores unsafe-inline when strict-dynamic is present', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "script-src 'self' 'unsafe-inline' 'strict-dynamic'",
        },
        { ...ctx, isHttps: false }
      );

      expect(findings.some((f) => f.id.includes('CSP-UNSAFE'))).toBe(false);
    });

    it('still flags unsafe-eval even when nonce or strict-dynamic is present', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "script-src 'self' 'unsafe-inline' 'strict-dynamic' 'unsafe-eval'",
        },
        { ...ctx, isHttps: false }
      );

      const unsafe = findings.find((f) => f.id === 'F-SEC-T339-CSP-UNSAFE');
      expect(unsafe).toBeDefined();
      expect(unsafe?.expectedVsActual.actual).toBe("'unsafe-eval'");
    });

    it('falls back to default-src when script-src is missing', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "default-src 'self' 'unsafe-inline'",
        },
        { ...ctx, isHttps: false }
      );

      const unsafe = findings.find((f) => f.id === 'F-SEC-T339-CSP-UNSAFE');
      expect(unsafe).toBeDefined();
      expect(unsafe?.expectedVsActual.actual).toBe("'unsafe-inline'");
    });

    it('prefers script-src over default-src if script-src is defined', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "default-src 'self' 'unsafe-inline'; script-src 'self'",
        },
        { ...ctx, isHttps: false }
      );

      expect(findings.some((f) => f.id.includes('CSP-UNSAFE'))).toBe(false);
    });
  });

  describe('Clickjacking with open frame-ancestors', () => {
    it('flags clickjacking when frame-ancestors has wildcard *', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "default-src 'self'; frame-ancestors *",
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'strict-origin-when-cross-origin',
        },
        { ...ctx, isHttps: false }
      );

      const clickjack = findings.find((f) => f.id === 'F-SEC-T339-CLICKJACK');
      expect(clickjack).toBeDefined();
      expect(clickjack?.severity).toBe('Minor');
      expect(clickjack?.expectedVsActual.actual).toBe('frame-ancestors allows any site');
    });

    it('flags clickjacking when frame-ancestors allows http: or https:', () => {
      const findingsHttp = checker.checkHeaders(
        {
          'content-security-policy': 'frame-ancestors http:',
        },
        { ...ctx, isHttps: false }
      );
      expect(findingsHttp.find((f) => f.id.includes('CLICKJACK'))?.expectedVsActual.actual).toBe(
        'frame-ancestors allows any site'
      );

      const findingsHttps = checker.checkHeaders(
        {
          'content-security-policy': 'frame-ancestors https:',
        },
        { ...ctx, isHttps: false }
      );
      expect(findingsHttps.find((f) => f.id.includes('CLICKJACK'))?.expectedVsActual.actual).toBe(
        'frame-ancestors allows any site'
      );
    });

    it('flags clickjacking when frame-ancestors directive exists but is empty', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': 'frame-ancestors; script-src self',
        },
        { ...ctx, isHttps: false }
      );

      const clickjack = findings.find((f) => f.id === 'F-SEC-T339-CLICKJACK');
      expect(clickjack).toBeDefined();
      expect(clickjack?.expectedVsActual.actual).toBe('frame-ancestors allows any site');
    });

    it('flags open frame-ancestors even when X-Frame-Options is DENY', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': 'frame-ancestors *',
          'x-frame-options': 'DENY',
        },
        { ...ctx, isHttps: false }
      );

      const clickjack = findings.find((f) => f.id === 'F-SEC-T339-CLICKJACK');
      expect(clickjack).toBeDefined();
      expect(clickjack?.expectedVsActual.actual).toBe('frame-ancestors allows any site');
    });

    it('reports standard missing headers message when no frame restriction exists at all', () => {
      const findings = checker.checkHeaders(
        {
          'content-security-policy': "default-src 'self'",
        },
        { ...ctx, isHttps: false }
      );

      const clickjack = findings.find((f) => f.id === 'F-SEC-T339-CLICKJACK');
      expect(clickjack).toBeDefined();
      expect(clickjack?.expectedVsActual.actual).toBe('No frame restriction headers were found');
    });

    it('does not flag clickjacking when frame-ancestors is restricted to self or none', () => {
      const findingsSelf = checker.checkHeaders(
        {
          'content-security-policy': "default-src 'self'; frame-ancestors 'self'",
        },
        { ...ctx, isHttps: false }
      );
      expect(findingsSelf.some((f) => f.id.includes('CLICKJACK'))).toBe(false);

      const findingsNone = checker.checkHeaders(
        {
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
        },
        { ...ctx, isHttps: false }
      );
      expect(findingsNone.some((f) => f.id.includes('CLICKJACK'))).toBe(false);
    });
  });
});
