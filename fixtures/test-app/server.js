import http from 'http';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const port = process.env.PORT || 3050;

function getLab() {
  return (
    globalThis.__fixtureLab ||
    (globalThis.__fixtureLab = {
      posts: 0,
      deletes: 0,
      cancelledDeletes: 0,
      signIns: 0,
      headerHits: {},
    })
  );
}

let labExpiringState = {
  maxRequests: 3,
  currentRequests: 0,
  invalidated: false,
};

let sessionsInvalidated = false;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);
  // Name the port this socket is on (not PORT), so robots/sitemap/llms point at the running fixture.
  const origin = `http://localhost:${req.socket.localPort}`;

  // Baseline security headers: the security checker now reads response headers, and the fixture is the
  // reference "healthy" app. Inline scripts get a per-response nonce so the policy needs no 'unsafe-inline'.
  const nonce = randomBytes(12).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self' 'nonce-${nonce}'; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'`
  );
  const end = res.end.bind(res);
  res.end = (chunk, ...rest) =>
    end(typeof chunk === 'string' ? chunk.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`) : chunk, ...rest);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.headers['x-qa-bypass-token']) {
    const p = url.pathname;
    const lab = getLab();
    lab.headerHits[p] = (lab.headerHits[p] || 0) + 1;
  }

  // API endpoints
  if (url.pathname === '/api/failing-endpoint') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', code: 500 }));
    return;
  }

  if (url.pathname === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `User-agent: *\nAllow: /\nDisallow: /private/\n\nUser-agent: GPTBot\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
    );
    return;
  }

  if (url.pathname === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`
    );
    return;
  }

  if (url.pathname === '/llms.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      `# Fixture QA App\n\n> Test application for verifying QA Flow Tester checks.\n\n- [About](${origin}/about): Overview of invoice features.\n`
    );
    return;
  }

  if (url.pathname === '/.well-known/security.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Contact: mailto:security@example.com\nExpires: 2099-01-01T00:00:00.000Z\n');
    return;
  }

  if (url.pathname === '/favicon.ico') {
    res.writeHead(200, { 'Content-Type': 'image/x-icon' });
    res.end();
    return;
  }

  if (url.pathname === '/api/invoices' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: 'INV-101' }));
    return;
  }

  // A real signed-in area: POST sign-in sets a session cookie; /account pages need it.
  const rawSession = (req.headers.cookie || '').match(/fixture_session=(admin|manager|viewer)/)?.[1];
  const session = sessionsInvalidated ? null : rawSession;
  const html = (
    title,
    body,
    status = 200,
    description = `${title}: a page of the fixture invoicing app, used to check QA Flow Tester.`
  ) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${description}"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <header><nav><a href="/">Home</a> <a href="/account">My account</a> <a href="/about">About</a></nav></header>
      <main>${body}</main></body></html>`);
  };
  const SIGN_IN_FORM = `<form method="post" action="/signin">
      <label for="signin-email">Email</label><input id="signin-email" name="email" type="email">
      <label for="signin-password">Password</label><input id="signin-password" name="password" type="password">
      <button type="submit" data-testid="signin-btn">Sign in</button>
    </form>`;
  const ACCOUNTS = {
    'manager@example.com': ['manager-password', 'manager'],
    'viewer@example.com': ['viewer-password', 'viewer'],
    'admin@example.com': ['admin-password', 'admin'],
    'two-step@example.com': ['two-step-password', 'manager'],
  };

  if (url.pathname === '/signin' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const account = ACCOUNTS[form.get('email') || ''];
      if (account && account[0] === form.get('password')) {
        getLab().signIns += 1;
        res.writeHead(302, { 'Set-Cookie': `fixture_session=${account[1]}; Path=/; HttpOnly`, Location: '/account' });
        res.end();
      } else {
        html('Sign in', `<h1>Sign in</h1><p role="alert">Wrong email or password</p>${SIGN_IN_FORM}`);
      }
    });
    return;
  }
  if (url.pathname === '/signin') return html('Sign in', `<h1>Sign in</h1>${SIGN_IN_FORM}`);

  if (url.pathname === '/login') {
    return html(
      'Sign in',
      `<h1>Sign in</h1>
      <form action="/dashboard" method="GET">
        <div><label for="email">Email</label><input type="email" id="email" data-testid="email-input" name="email" value="admin@example.com" /></div>
        <div><label for="password">Password</label><input type="password" id="password" data-testid="password-input" name="password" value="secret" /></div>
        <button type="submit" data-testid="submit-btn">Sign In</button>
      </form>`,
      200,
      'Sign in to access your dashboard and manage company invoices.'
    );
  }

  // --- /lab/* routes for auth and crawler failure modes (T-102) ---
  if (url.pathname === '/lab/reset' && req.method === 'POST') {
    const lab = getLab();
    lab.posts = 0;
    lab.deletes = 0;
    lab.cancelledDeletes = 0;
    lab.signIns = 0;
    lab.headerHits = {};
    lab.mirrorFirst = undefined;
    labExpiringState.maxRequests = 3;
    labExpiringState.currentRequests = 0;
    labExpiringState.invalidated = false;
    sessionsInvalidated = false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/lab/headers' && req.method === 'GET') {
    const hasToken = req.headers['x-qa-bypass-token'] ? 'present' : 'absent';
    const ua = req.headers['user-agent'] || '';
    const hasCookie = req.headers['cookie'] ? 'present' : 'absent';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        'x-qa-bypass-token': hasToken,
        'user-agent': ua,
        cookie: hasCookie,
      })
    );
    return;
  }

  if (url.pathname === '/lab/spa-late') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>SPA Late Hydration</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <h1>SPA Late Hydration</h1>
      <div id="root"></div>
      <script>
        setTimeout(function() {
          var root = document.getElementById('root');
          if (root) {
            var t = 'a';
            root.innerHTML = '<' + t + ' href="/lab/spa-late/a">Page A</' + t + '> <' + t + ' href="/lab/spa-late/b">Page B</' + t + '>';
          }
        }, 1500);
      </script>
    </body></html>`);
    return;
  }

  if (url.pathname === '/lab/spa-late/a') {
    html('SPA Late A', '<h1>SPA Late A</h1><p>Late hydrated page A</p><a href="/lab/spa-late">Back</a>');
    return;
  }

  if (url.pathname === '/lab/spa-late/b') {
    html('SPA Late B', '<h1>SPA Late B</h1><p>Late hydrated page B</p><a href="/lab/spa-late">Back</a>');
    return;
  }

  if (url.pathname === '/lab/spa-login' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>SPA Login</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <h1>SPA Login</h1>
      <div id="login-container"></div>
      <script>
        setTimeout(function() {
          var c = document.getElementById('login-container');
          if (c) {
            c.innerHTML = '<form method="post" action="/lab/spa-login">' +
              '<label for="signin-email">Email</label><input id="signin-email" name="email" type="email">' +
              '<label for="signin-password">Password</label><input id="signin-password" name="password" type="password">' +
              '<button type="submit" data-testid="signin-btn">Sign in</button>' +
              '</form>';
          }
        }, 1200);
      </script>
    </body></html>`);
    return;
  }

  if (url.pathname === '/lab/spa-login' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const account = ACCOUNTS[form.get('email') || ''];
      if (account && account[0] === form.get('password')) {
        getLab().signIns += 1;
        res.writeHead(302, { 'Set-Cookie': `fixture_session=${account[1]}; Path=/; HttpOnly`, Location: '/account' });
        res.end();
      } else {
        html('SPA Sign in', `<h1>SPA Sign in</h1><p role="alert">Wrong email or password</p>${SIGN_IN_FORM}`);
      }
    });
    return;
  }

  if (url.pathname === '/lab/expiring/start' && req.method === 'POST') {
    const n = parseInt(url.searchParams.get('n') || '3', 10);
    labExpiringState.maxRequests = n;
    labExpiringState.currentRequests = 0;
    labExpiringState.invalidated = false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, n }));
    return;
  }

  if (url.pathname === '/lab/expire-session' && req.method === 'POST') {
    sessionsInvalidated = true;
    labExpiringState.invalidated = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, expired: true }));
    return;
  }

  if (
    url.pathname === '/lab/expiring' ||
    (url.pathname.startsWith('/lab/expiring/') && url.pathname !== '/lab/expiring/start')
  ) {
    if (!session || sessionsInvalidated || labExpiringState.invalidated) {
      res.writeHead(302, { Location: '/signin' });
      res.end();
      return;
    }
    labExpiringState.currentRequests += 1;
    if (labExpiringState.currentRequests > labExpiringState.maxRequests) {
      labExpiringState.invalidated = true;
      res.writeHead(302, { Location: '/signin' });
      res.end();
      return;
    }
    html(
      'Expiring Protected Page',
      `<h1>Protected Area</h1><p>Request ${labExpiringState.currentRequests} of ${labExpiringState.maxRequests}</p>`
    );
    return;
  }

  if (url.pathname === '/lab/expiring-spa') {
    const isInvalid = !session || sessionsInvalidated || labExpiringState.invalidated;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Expiring SPA</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <h1>Expiring SPA</h1>
      <p>Status: ${isInvalid ? 'invalid' : 'valid'}</p>
      ${isInvalid ? `<script>setTimeout(function() { location.replace('/signin'); }, 300);</script>` : ''}
    </body></html>`);
    return;
  }

  if (url.pathname.startsWith('/lab/trap/')) {
    const n = parseInt(url.pathname.replace('/lab/trap/', ''), 10) || 0;
    html(
      `Trap Page ${n}`,
      `<h1>Trap Page ${n}</h1><p>Infinite trap chain</p><a href="/lab/trap/${n + 1}">Next trap</a>`
    );
    return;
  }

  if (url.pathname === '/lab/calendar') {
    const month = url.searchParams.get('month') || '2026-10';
    const parts = month.split('-').map(Number);
    let y = parts[0] || 2026;
    let m = parts[1] || 10;
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    const prevStr = `${prevY}-${String(prevM).padStart(2, '0')}`;
    const nextStr = `${nextY}-${String(nextM).padStart(2, '0')}`;
    html(
      `Calendar ${month}`,
      `<h1>Calendar ${month}</h1><p>Monthly calendar view</p><a href="/lab/calendar?month=${prevStr}">Previous Month</a> <a href="/lab/calendar?month=${nextStr}">Next Month</a>`
    );
    return;
  }

  if (url.pathname === '/lab/hash') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Hash Router</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <h1 id="heading">Section One</h1>
      <nav><a href="#/one">One</a> <a href="#/two">Two</a></nav>
      <script>
        function updateHeading() {
          var h = document.getElementById('heading');
          if (location.hash === '#/two') {
            h.textContent = 'Section Two';
          } else {
            h.textContent = 'Section One';
          }
        }
        window.addEventListener('hashchange', updateHeading);
        updateHeading();
      </script>
    </body></html>`);
    return;
  }

  if (url.pathname === '/lab/onclick') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>OnClick Navigation</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <h1>OnClick Navigation</h1>
      <div role="link" data-href="/lab/onclick/target" onclick="location.href='/lab/onclick/target'">Target 1 Div</div>
      <button onclick="location.href='/lab/onclick/target2'">Target 2 Button</button>
    </body></html>`);
    return;
  }
  if (url.pathname === '/lab/onclick/target') {
    html('OnClick Target 1', '<h1>OnClick Target 1</h1><a href="/lab/onclick">Back</a>');
    return;
  }
  if (url.pathname === '/lab/onclick/target2') {
    html('OnClick Target 2', '<h1>OnClick Target 2</h1><a href="/lab/onclick">Back</a>');
    return;
  }

  if (url.pathname === '/lab/overlay') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Overlay Banner</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <div id="overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:9999;">
        <h2>Cookie Consent</h2>
        <p>Please accept cookies to continue.</p>
        <button id="accept" onclick="document.getElementById('overlay').remove()">Accept</button>
      </div>
      <h1>Overlay Page</h1>
      <a href="/lab/overlay/inner">Inner Link</a>
    </body></html>`);
    return;
  }
  if (url.pathname === '/lab/overlay/inner') {
    html('Overlay Inner', '<h1>Overlay Inner</h1><a href="/lab/overlay">Back</a>');
    return;
  }

  if (url.pathname === '/lab/redirect-chain') {
    res.writeHead(302, { Location: '/lab/redirect-chain/2' });
    res.end();
    return;
  }
  if (url.pathname === '/lab/redirect-chain/2') {
    res.writeHead(302, { Location: '/lab/redirect-chain/final' });
    res.end();
    return;
  }
  if (url.pathname === '/lab/redirect-chain/final') {
    html('Redirect Final', '<h1>Redirect Final</h1><p>Reached after 2 hops.</p>');
    return;
  }

  if (url.pathname === '/lab/always-500') {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Internal Server Error</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body><h1>Server Error 500</h1></body></html>'
    );
    return;
  }

  if (url.pathname === '/lab/forbidden') {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Forbidden</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body><h1>Forbidden 403</h1></body></html>'
    );
    return;
  }

  if (url.pathname === '/lab/index' || url.pathname === '/lab') {
    html(
      'Lab Failure Modes',
      `<h1>Lab Failure Modes</h1>
      <ul>
        <li><a href="/lab/spa-late">SPA Late</a></li>
        <li><a href="/lab/spa-login">SPA Login</a></li>
        <li><a href="/lab/expiring">Expiring Session</a></li>
        <li><a href="/lab/expiring-spa">Expiring SPA</a></li>
        <li><a href="/lab/trap/1">Trap Chain</a></li>
        <li><a href="/lab/calendar?month=2026-10">Calendar</a></li>
        <li><a href="/lab/hash">Hash Route</a></li>
        <li><a href="/lab/onclick">OnClick</a></li>
        <li><a href="/lab/overlay">Overlay</a></li>
        <li><a href="/lab/redirect-chain">Redirect Chain</a></li>
        <li><a href="/lab/always-500">Always 500</a></li>
        <li><a href="/lab/forbidden">Forbidden</a></li>
        <li><a href="/lab/headers">Headers</a></li>
      </ul>`
    );
    return;
  }

  // Sign-in variants for the sign-in robustness tests. Linked from nowhere, so crawls never see them.
  const readJson = (cb) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let data = {};
      try {
        data = JSON.parse(raw || '{}');
      } catch {
        data = {};
      }
      cb(data);
    });
  };
  const json = (status, obj, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(obj));
  };
  const sessionCookie = (account) => ({ 'Set-Cookie': `fixture_session=${account[1]}; Path=/; HttpOnly` });

  if (url.pathname === '/login-two-step/email' && req.method === 'POST') {
    return readJson((data) => (ACCOUNTS[data.email] ? json(200, { ok: true }) : json(401, { ok: false })));
  }
  if (url.pathname === '/login-two-step/password' && req.method === 'POST') {
    return readJson((data) => {
      const account = ACCOUNTS[data.email];
      return account && account[0] === data.password
        ? json(200, { ok: true }, sessionCookie(account))
        : json(401, { ok: false });
    });
  }
  if (url.pathname === '/login-two-step') {
    return html(
      'Sign in (two steps)',
      `<h1>Sign in</h1>
       <form id="two-step" novalidate>
         <p role="alert" id="two-step-error" hidden>Wrong email or password</p>
         <div id="step-email"><label for="ts-email">Email</label><input id="ts-email" name="email" type="email">
           <button type="button" id="ts-next">Next</button></div>
         <div id="step-password" hidden><label for="ts-password">Password</label><input id="ts-password" name="password" type="password">
           <button type="submit" id="ts-submit">Sign in</button></div>
       </form>
       <script>
         const $ = (id) => document.getElementById(id);
         const post = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
         $('ts-next').addEventListener('click', async () => {
           const r = await post('/login-two-step/email', { email: $('ts-email').value });
           if (r.ok) { $('two-step-error').hidden = true; $('step-email').hidden = true; $('step-password').hidden = false; }
           else $('two-step-error').hidden = false;
         });
         $('two-step').addEventListener('submit', async (e) => {
           e.preventDefault();
           const r = await post('/login-two-step/password', { email: $('ts-email').value, password: $('ts-password').value });
           if (r.ok) location.href = '/account'; else $('two-step-error').hidden = false;
         });
       </script>`
    );
  }

  if (url.pathname === '/login-modal/submit' && req.method === 'POST') {
    return readJson((data) => {
      const account = ACCOUNTS[data.email];
      return account && account[0] === data.password
        ? json(200, { ok: true }, sessionCookie(account))
        : json(401, { ok: false });
    });
  }
  if (url.pathname === '/login-modal') {
    return html(
      'Sign in (modal)',
      `<h1>Welcome</h1>
       <button type="button" id="open-signin">Sign in</button>
       <dialog id="signin-dialog">
         <form id="modal-form" method="dialog" novalidate>
           <p role="alert" id="modal-error" hidden>Wrong email or password</p>
           <label for="m-email">Email</label><input id="m-email" name="email" type="email">
           <label for="m-password">Password</label><input id="m-password" name="password" type="password">
           <button type="submit" id="m-submit">Sign in</button>
         </form>
       </dialog>
       <script>
         const $ = (id) => document.getElementById(id);
         $('open-signin').addEventListener('click', () => $('signin-dialog').showModal());
         $('modal-form').addEventListener('submit', async (e) => {
           e.preventDefault();
           const r = await fetch('/login-modal/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ email: $('m-email').value, password: $('m-password').value }) });
           if (r.ok) location.href = '/account'; else $('modal-error').hidden = false;
         });
       </script>`
    );
  }

  if (url.pathname === '/login-captcha') {
    return html(
      'Sign in (CAPTCHA)',
      `<h1>Sign in</h1>${SIGN_IN_FORM}<div class="g-recaptcha" data-sitekey="x" style="width:300px;height:78px;border:1px solid #ccc">I am not a robot</div>`
    );
  }
  if (url.pathname === '/login-nothing') return html('Nothing here', '<h1>Welcome</h1><p>No sign-in on this page.</p>');
  if (url.pathname === '/login-sso') {
    return html('Sign in (single sign-on)', '<h1>Sign in</h1><button type="button">Continue with Google</button>');
  }
  if (url.pathname === '/signout') {
    res.writeHead(302, { 'Set-Cookie': 'fixture_session=; Path=/; Max-Age=0', Location: '/' });
    res.end();
    return;
  }
  if (url.pathname.startsWith('/account')) {
    if (!session) {
      res.writeHead(302, { Location: '/signin' });
      res.end();
      return;
    }
    if (url.pathname === '/account') {
      return html(
        'My account',
        `<h1>My account</h1><p>Signed in as ${session}.</p>
         <a href="/account/orders">Orders</a> <a href="/account/profile">Profile</a> <a href="/account/team">Team</a>
         <a href="/account/security">Security</a>
         ${session === 'admin' ? '<a href="/account/users/new">Create user</a>' : ''}
         <a href="/signout">Sign out</a>`
      );
    }
    // Planted: a page with a visible password field that is not the sign-in page (T-301).
    if (url.pathname === '/account/security') {
      return html(
        'Security',
        `<h1>Security</h1>
         <form id="change-password-form" action="/account/security" method="post">
           <label for="display-name">Display name</label><input id="display-name" name="display-name" type="text" value="Sam">
           <label for="current-password">Current password</label><input id="current-password" name="current-password" type="password">
           <button type="submit" data-testid="save-password">Save</button>
         </form>`
      );
    }
    if (url.pathname === '/account/orders') return html('Orders', '<h1>Orders</h1><p>No orders yet.</p>');
    // Planted: a form that shows its own error message when the name is left empty.
    if (url.pathname === '/account/profile') {
      return html(
        'Profile',
        `<h1>Profile</h1>
         <form id="profile-form" novalidate>
           <label for="display-name">Display name</label><input id="display-name" data-testid="display-name" value="Sam">
           <p id="name-error" class="field-error" role="alert"></p>
           <button type="submit" data-testid="save-profile">Save profile</button>
         </form>
         <p id="saved" hidden>Profile saved</p>
         <script>
           document.getElementById('profile-form').addEventListener('submit', (e) => {
             e.preventDefault();
             const name = document.getElementById('display-name').value.trim();
             document.getElementById('name-error').textContent = name ? '' : 'Please enter your name';
             document.getElementById('saved').hidden = !name;
           });
         </script>`
      );
    }
    // Only admins may create users. Everyone else gets no link and a 403 on the address.
    if (url.pathname === '/account/users/new') {
      return session === 'admin'
        ? html(
            'Create user',
            `<h1>Create user</h1>
             <form id="create-user-form"><label for="new-user-email">Email</label><input id="new-user-email" name="email" type="email">
             <button type="submit" data-testid="create-user-btn">Create user</button></form>`
          )
        : html('No access', '<h1>You don’t have access to this page</h1>', 403);
    }
    // Only managers (and admins) may see the team page.
    if (url.pathname === '/account/team') {
      return session === 'manager' || session === 'admin'
        ? html('Team', '<h1>Team</h1><p>2 people</p>')
        : html('No access', '<h1>You don’t have access to this page</h1>', 403);
    }
  }
  // Slow-crawl pages: /slow/1../slow/N answer after ?delay ms (default 1500, at most 10000) and link to the next
  // one. Linked from nowhere else, so the normal crawls and the benchmark never see them.
  // /lab/*: pages for the intent/refusal-rule and interactive-state tests. Linked from nowhere (not in nav,
  // sitemap or any page), so crawls and benchmark counts are unchanged.
  if (url.pathname.startsWith('/lab/')) {
    const lab = getLab();
    const labPath = url.pathname;
    if (req.method === 'POST') lab.posts++;
    if (req.method === 'DELETE') lab.deletes++;
    if (labPath === '/lab/stats') return json(200, lab);
    if (labPath === '/lab/stats/reset') {
      lab.posts = lab.deletes = lab.cancelledDeletes = lab.signIns = 0;
      lab.headerHits = {};
      return json(200, lab);
    }
    if (labPath === '/lab/cancelled') {
      lab.cancelledDeletes++;
      res.writeHead(204);
      res.end();
      return;
    }
    const labPage = (title, body, status = 200) => html(title, `<h1>${title}</h1>${body}`, status);
    const drain = (cb) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => cb(new URLSearchParams(raw)));
    };
    const emailOk = (v) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v || '');

    // QSP-011: access-control and passive-security lab routes. GET only, linked from nowhere.
    const labEmail = { admin: 'admin@example.com', manager: 'manager@example.com', viewer: 'viewer@example.com' };
    if (labPath === '/lab/open-account') {
      // Protected content with no sign-in at all (a leak).
      return labPage('Account balance', '<p>Account balance: 4,200 EUR. Invoices: 12.</p>');
    }
    if (labPath === '/lab/closed-account') {
      if (!session) {
        res.writeHead(302, { Location: '/signin' });
        res.end();
        return;
      }
      return labPage('Account balance', '<p>Account balance: 4,200 EUR. Invoices: 12.</p>');
    }
    if (labPath === '/lab/401') {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!DOCTYPE html><html lang="en"><head><title>Unauthorized</title></head><body><h1>Unauthorized 401</h1></body></html>'
      );
      return;
    }
    if (labPath === '/lab/mirror') {
      // Shows whoever is asking, per session. Correct behaviour.
      if (!session) {
        res.writeHead(302, { Location: '/signin' });
        res.end();
        return;
      }
      return labPage('Profile', `<p>Signed in as ${labEmail[session]}</p>`);
    }
    if (labPath === '/lab/mirror-leak') {
      // Bug on purpose: remembers the first user it saw and shows that name to everyone after.
      if (!session) {
        res.writeHead(302, { Location: '/signin' });
        res.end();
        return;
      }
      const lab2 = getLab();
      lab2.mirrorFirst = lab2.mirrorFirst || labEmail[session];
      return labPage('Profile', `<p>Signed in as ${lab2.mirrorFirst}</p>`);
    }
    if (labPath === '/lab/csrf-form') {
      return labPage(
        'Update profile',
        '<form method="post" action="/lab/csrf-form"><label for="nick">Nickname</label><input id="nick" name="nickname"><button type="submit">Save</button></form>'
      );
    }
    if (labPath === '/lab/csrf-ok') {
      return labPage(
        'Update profile',
        '<form method="post" action="/lab/csrf-ok"><input type="hidden" name="csrf_token" value="fixture-token"><label for="nick">Nickname</label><input id="nick" name="nickname"><button type="submit">Save</button></form>'
      );
    }
    if (labPath === '/lab/cookie-good') {
      res.setHeader('Set-Cookie', 'lab_pref=dark; Path=/; HttpOnly; SameSite=Lax');
      return labPage('Cookie with flags', '<p>Sets a cookie with HttpOnly and SameSite=Lax.</p>');
    }
    if (labPath === '/lab/cookie-bad') {
      res.setHeader('Set-Cookie', 'lab_session_id=abc; Path=/');
      return labPage('Cookie without flags', '<p>Sets a session-like cookie with no flags.</p>');
    }
    if (labPath === '/lab/done') return labPage('Done', '<p>Saved. Thank you.</p>');

    if (labPath === '/lab/signup') {
      const server = url.searchParams.get('mode') === 'server';
      if (req.method === 'POST') {
        return drain((f) => {
          if (!f.get('name') || !emailOk(f.get('email')) || !/^[A-Z]{3}-\d{3}$/.test(f.get('code') || '')) {
            return labPage(
              'Sign up',
              signupForm(server, '<p role="alert">Enter a name, a valid email and a code like ABC-123.</p>')
            );
          }
          res.writeHead(302, { Location: '/lab/done' });
          res.end();
        });
      }
      return labPage('Sign up', signupForm(server, ''));
    }

    if (labPath === '/lab/lenient') {
      if (req.method === 'POST') {
        return drain(() => {
          res.writeHead(302, { Location: '/lab/done' });
          res.end();
        });
      }
      return labPage(
        'Lenient',
        `<form method="post" action="/lab/lenient"><label for="l-name">Name</label><input id="l-name" name="name">
        <label for="l-email">Email</label><input id="l-email" name="email"><button type="submit">Save</button></form>`
      );
    }

    if (labPath === '/lab/toast') {
      const form = (
        note
      ) => `${note}<form method="post" action="/lab/toast" novalidate><label for="t-email">Email</label>
        <input id="t-email" name="email"><button type="submit">Save</button></form>`;
      if (req.method === 'POST') {
        return drain((f) =>
          emailOk(f.get('email'))
            ? (res.writeHead(302, { Location: '/lab/done' }), res.end())
            : labPage('Toast', form('<div class="toast">That email does not look right.</div>'))
        );
      }
      return labPage('Toast', form(''));
    }

    if (labPath === '/lab/tabs') {
      return labPage(
        'Tabs',
        `<div role="tablist"><button role="tab" id="tab-a" aria-selected="true" aria-controls="panel-a">Overview</button>
        <button role="tab" id="tab-b" aria-selected="false" aria-controls="panel-b">Contact</button></div>
        <div role="tabpanel" id="panel-a"><p>Overview text.</p></div>
        <div role="tabpanel" id="panel-b" hidden>
          <form method="post" action="/lab/lenient"><label for="tb-email">Email</label><input id="tb-email" name="email" type="email" required>
          <button type="submit">Send</button></form></div>
        <details><summary>More options</summary>
          <form method="post" action="/lab/lenient"><label for="ac-note">Note</label><input id="ac-note" name="note" required>
          <button type="submit">Save note</button></form></details>
        <button id="open-drawer" aria-expanded="false" aria-controls="drawer">Open settings</button>
        <aside id="drawer" hidden><form method="post" action="/lab/lenient"><label for="dr-name">Display name</label>
          <input id="dr-name" name="name" required><button type="submit">Save settings</button></form></aside>
        <script>
          const tabs = [...document.querySelectorAll('[role=tab]')];
          tabs.forEach((t) => t.addEventListener('click', () => {
            tabs.forEach((o) => { o.setAttribute('aria-selected', String(o === t)); document.getElementById(o.getAttribute('aria-controls')).hidden = o !== t; });
          }));
          document.getElementById('open-drawer').addEventListener('click', (e) => {
            document.getElementById('drawer').hidden = false; e.currentTarget.setAttribute('aria-expanded', 'true');
          });
        </script>`
      );
    }

    if (labPath === '/lab/modal') {
      return labPage(
        'Modal',
        `<button id="open-modal">New message</button>
        <dialog id="msg"><form method="post" action="/lab/lenient"><label for="m-subject">Subject</label>
          <input id="m-subject" name="subject" required><button type="submit">Send message</button></form>
          <button type="button" id="close-modal">Close</button></dialog>
        <script>
          const d = document.getElementById('msg');
          document.getElementById('open-modal').addEventListener('click', () => d.showModal());
          document.getElementById('close-modal').addEventListener('click', () => d.close());
        </script>`
      );
    }

    if (labPath === '/lab/crud') {
      return labPage(
        'Items',
        `<button id="add-item">Add item</button>
        <form id="item-form" method="post" action="/lab/lenient" hidden><label for="i-name">Item name</label>
          <input id="i-name" name="name" required><button type="submit">Save item</button></form>
        <table><thead><tr><th>Name</th><th>Actions</th></tr></thead><tbody>
          <tr><td>Widget</td><td><button class="edit">Edit</button> <button class="delete">Delete</button></td></tr>
          <tr><td>Gadget</td><td><button class="edit">Edit</button> <button class="delete">Delete</button></td></tr>
        </tbody></table>
        <script>
          const f = document.getElementById('item-form');
          document.getElementById('add-item').addEventListener('click', () => { f.hidden = false; });
          document.querySelectorAll('.edit').forEach((b) => b.addEventListener('click', () => {
            f.hidden = false; document.getElementById('i-name').value = b.closest('tr').firstElementChild.textContent;
          }));
          document.querySelectorAll('.delete').forEach((b) => b.addEventListener('click', () => {
            if (!confirm('Delete this item?')) { fetch('/lab/cancelled'); return; }
            fetch('/lab/items/1', { method: 'DELETE' }).then(() => b.closest('tr').remove());
          }));
        </script>`
      );
    }

    if (labPath.startsWith('/lab/items/') && req.method === 'DELETE') return json(200, { deleted: true });

    function signupForm(server, note) {
      return `${note}<form method="post" action="/lab/signup${server ? '?mode=server' : ''}"${server ? ' novalidate' : ''}>
        <label for="s-name">Name</label><input id="s-name" name="name" required>
        <label for="s-email">Email</label><input id="s-email" name="email" type="email" required>
        <label for="s-code">Code</label><input id="s-code" name="code" pattern="[A-Z]{3}-[0-9]{3}" required>
        <button type="submit">Sign up</button></form>`;
    }
    return html('Not found', '<h1>Not found</h1>', 404);
  }

  const slow = url.pathname.match(/^\/slow\/(\d{1,3})$/);
  if (slow) {
    const n = Number(slow[1]);
    const delay = Math.min(Math.max(Number(url.searchParams.get('delay') ?? 1500) || 0, 0), 10000);
    setTimeout(
      () =>
        html(
          `Slow page ${n}`,
          `<h1>Slow page ${n}</h1><p>This page answers after ${delay} ms.</p><a href="/slow/${n + 1}?delay=${delay}">Next slow page</a>`,
          200,
          `Slow page ${n} of the fixture app: it answers after ${delay} milliseconds, to test a crawl that takes a while.`
        ),
      delay
    );
    return;
  }
  // Product documents for Sources tests. The guide files also live in fixtures/test-app/docs/.
  if (url.pathname === '/docs' || url.pathname === '/docs/') {
    return html(
      'Docs',
      '<h1>Docs</h1><a href="/docs/admin-guide.md">Admin guide</a> <a href="/docs/product-guide.md">Product guide</a>'
    );
  }
  const docFile = url.pathname.match(/^\/docs\/(admin-guide|product-guide)\.md$/);
  if (docFile) {
    try {
      const text = readFileSync(fileURLToPath(new URL(`./docs/${docFile[1]}.md`, import.meta.url)), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
      res.end(text);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
    return;
  }
  // Mock saved-session login: hands back a browser storage state for a role, the way a person's saved session
  // would look. role=expired gives a cookie the app no longer accepts. The value is the role name (not a secret).
  if (url.pathname === '/saved-session/mint') {
    const role = url.searchParams.get('role') || 'viewer';
    const known = ['admin', 'manager', 'viewer', 'expired'].includes(role);
    if (!known) return json(400, { error: 'unknown role' });
    return json(200, {
      cookies: [
        {
          name: 'fixture_session',
          value: role,
          domain: 'localhost',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    });
  }

  // Planted: a page with no title for search engines to show.
  if (url.pathname === '/about') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="description" content="About the fixture invoicing app: what it does and who makes it."><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/favicon.ico"></head><body>
      <header><nav><a href="/">Home</a></nav></header><main><h1>About Fixture</h1><p>We make invoices.</p></main></body></html>`);
    return;
  }
  // Planted: a slow page (answers after 2 seconds).
  if (url.pathname === '/reports') {
    setTimeout(() => html('Reports', '<h1>Reports</h1><p>Monthly totals.</p>'), 2000);
    return;
  }
  // Planted: the path the site really uses, asked for under a different case and slash (T-301, T-303).
  if (url.pathname === '/Settings') {
    res.writeHead(302, { Location: '/settings/' });
    res.end();
    return;
  }
  if (url.pathname === '/settings/') {
    return html('Settings', '<h1>Settings</h1><p>Workspace settings for the fixture app.</p>');
  }
  // robots.txt asks crawlers to leave /private/ alone; a crawl that ignores it reaches these (T-304).
  if (url.pathname === '/private/') {
    return html('Private', '<h1>Private</h1><p>Pages robots.txt asks crawlers to leave alone.</p>');
  }
  if (url.pathname === '/private/reports') {
    return html('Private reports', '<h1>Private reports</h1><p>Internal numbers.</p>');
  }

  // Default for the HTML pages below; the 404 fallback overrides it (writeHead would throw if sent twice).
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (url.pathname === '/') {
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Fixture App - Home</title>
        <meta name="description" content="Home of the fixture invoicing app: sign in, create invoices and view reports.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/favicon.ico">
      </head>
      <body>
        <header>
          <nav>
            <a href="/" data-testid="nav-home">Home</a>
            <a href="/login" data-testid="nav-login">Sign In</a>
            <a href="/invoices/new" data-testid="nav-new-invoice">New Invoice</a>
            <a href="/account" data-testid="nav-account">My account</a>
            <a href="/about" data-testid="nav-about">About</a>
            <a href="/reports" data-testid="nav-reports">Reports</a>
            <a href="/settings/" data-testid="nav-settings">Settings</a>
            <a href="/private/" data-testid="nav-private">Private</a>
            <a href="/private/reports" data-testid="nav-private-reports">Private reports</a>
          </nav>
        </header>
        <main>
          <h1>Welcome to Fixture QA App</h1>
          <p>This application is used to verify deterministic QA checks.</p>
        </main>
      </body>
      </html>
    `);
    return;
  }

  if (url.pathname === '/login') {
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Fixture App - Login</title>
        <meta name="description" content="Sign in to the fixture invoicing app with your email and password.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/favicon.ico">
      </head>
      <body>
        <header><nav><a href="/">Home</a></nav></header>
        <main>
          <h1>Sign In</h1>
          <form action="/dashboard" method="GET">
            <div>
              <label for="email">Email</label>
              <input type="email" id="email" data-testid="email-input" name="email" value="admin@example.com" />
            </div>
            <div>
              <label for="password">Password</label>
              <input type="password" id="password" data-testid="password-input" name="password" value="secret" />
            </div>
            <button type="submit" data-testid="submit-btn">Sign In</button>
          </form>
        </main>
      </body>
      </html>
    `);
    return;
  }

  if (url.pathname === '/dashboard') {
    if (url.searchParams.get('email') && url.searchParams.get('password')) {
      res.setHeader('Set-Cookie', 'fixture_session=manager; Path=/');
    }
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Fixture App - Dashboard</title>
        <meta name="description" content="Dashboard of the fixture invoicing app with shortcuts to invoices and test actions.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/favicon.ico">
      </head>
      <body>
        <header>
          <nav>
            <a href="/" data-testid="nav-home">Home</a>
            <a href="/invoices/new" data-testid="nav-invoices">Invoices</a>
            <a href="/deadend" data-testid="deadend-link">Orphaned Page</a>
          </nav>
        </header>
        <main>
          <h1>Dashboard</h1>
          <p>Welcome back, Manager!</p>

          <!-- Intentional defect 1: Console Error -->
          <button data-testid="trigger-error-btn" onclick="console.error('Simulated Unhandled Runtime Bug in Dashboard');">
            Trigger Console Error
          </button>

          <!-- Intentional defect 2: Failed 500 API Call -->
          <button data-testid="trigger-failed-api-btn" onclick="fetch('/api/failing-endpoint');">
            Trigger 500 API Failure
          </button>

          <!-- Intentional defect 3: Small touch target (< 44px) -->
          <div style="margin-top: 10px;">
            <button data-testid="tiny-touch-btn" style="width: 20px; height: 20px; padding: 0; font-size: 10px;">
              X
            </button>
          </div>
        </main>
      </body>
      </html>
    `);
    return;
  }

  if (url.pathname === '/deadend') {
    // Intentional UX defect: Dead end page with no navigation or back button
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Dead End Page</title>
        <meta name="description" content="A page of the fixture invoicing app that has no way back, used to test dead ends.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/favicon.ico">
      </head>
      <body>
        <div>
          <h1>Lost in Space</h1>
          <p>There are no links, buttons, or navigation back from this screen.</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  if (url.pathname === '/invoices/new') {
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Create Invoice</title>
        <meta name="description" content="Create a new invoice in the fixture invoicing app by entering a customer and an amount.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/favicon.ico">
        <script>
          async function handleSave(e) {
            e.preventDefault();
            const customer = document.getElementById('customer').value;
            const amount = document.getElementById('amount').value;
            
            await fetch('/api/invoices', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ customer, amount })
            });

            window.location.href = '/invoices/INV-101';
          }
        </script>
      </head>
      <body>
        <header><nav><a href="/dashboard">Dashboard</a></nav></header>
        <main>
          <h1>Create Invoice</h1>
          <form onsubmit="handleSave(event)">
            <div>
              <label for="customer">Customer</label>
              <input type="text" id="customer" data-testid="customer-field" value="Acme Corp" />
            </div>
            <div>
              <label for="amount">Amount</label>
              <input type="number" id="amount" data-testid="amount-field" value="1200" />
            </div>
            <button type="submit" data-testid="save-btn">Save</button>
          </form>
        </main>
      </body>
      </html>
    `);
    return;
  }

  if (url.pathname === '/invoices/INV-101') {
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Invoice Details</title>
        <meta name="description" content="Details of invoice INV-101 for Acme Corp, including the customer, the amount and the current status.">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="icon" href="/favicon.ico">
        <meta property="og:title" content="Invoice Details">
        <meta property="og:description" content="Details of invoice INV-101 for Acme Corp.">
        <meta property="og:image" content="https://example.com/invoice-preview.png">
      </head>
      <body>
        <header><nav><a href="/dashboard">Dashboard</a></nav></header>
        <main>
          <h1>Invoice INV-101</h1>
          <div data-testid="status-message">Invoice created successfully</div>
          <p>Customer: Acme Corp | Amount: $1200</p>
        </main>
      </body>
      </html>
    `);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(port, () => {
    console.log(`Fixture server running at http://localhost:${port}`);
  });
}

export { server };
