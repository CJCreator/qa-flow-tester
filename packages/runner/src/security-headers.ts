import type http from 'http';

/**
 * The runner's default Content-Security-Policy (T-303): the static site's policy (site/nginx.conf) with
 * connect-src 'self', because the API is on this origin. With Helper sign-in on, Firebase's hosts are added.
 * A page that sends its own policy in writeHead (a Shared Link, a preview, a site snapshot) keeps its own.
 */
export function runnerCsp(signInAuthDomain?: string): string {
  const google = signInAuthDomain
    ? {
        script: ' https://apis.google.com',
        frame: ` https://${signInAuthDomain}`,
        connect: ' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com',
      }
    : { script: '', frame: '', connect: '' };
  return [
    "default-src 'self'",
    `script-src 'self'${google.script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${google.connect}`,
    `frame-src 'self'${google.frame}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/** True when the visitor reached the runner over https (directly, or through Cloud Run's front end or a tunnel). */
export function servedOverHttps(req: http.IncomingMessage): boolean {
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return proto === 'https' || (req.socket as { encrypted?: boolean } | undefined)?.encrypted === true;
}

/** Default headers for every answer. Set with setHeader, so a page's own writeHead headers still win. */
export function applySecurityHeaders(req: http.IncomingMessage, res: http.ServerResponse, csp: string): void {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', csp);
  // Only over https: a browser ignores HSTS on plain http, and localhost must keep working without TLS.
  if (servedOverHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
