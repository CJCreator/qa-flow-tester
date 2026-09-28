import http from 'http';

const port = process.env.PORT || 3050;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${port}`);

  // API endpoints
  if (url.pathname === '/api/failing-endpoint') {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', code: 500 }));
    return;
  }

  if (url.pathname === '/api/invoices' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, id: 'INV-101' }));
    return;
  }

  // A real signed-in area: POST sign-in sets a session cookie; /account pages need it.
  const session = (req.headers.cookie || '').match(/fixture_session=(manager|viewer)/)?.[1];
  const html = (title, body, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>
      <header><nav><a href="/">Home</a> <a href="/account">My account</a> <a href="/about">About</a></nav></header>
      <main>${body}</main></body></html>`);
  };
  const SIGN_IN_FORM = `<form method="post" action="/signin">
      <label for="signin-email">Email</label><input id="signin-email" name="email" type="email">
      <label for="signin-password">Password</label><input id="signin-password" name="password" type="password">
      <button type="submit" data-testid="signin-btn">Sign in</button>
    </form>`;
  const ACCOUNTS = { 'manager@example.com': ['manager-password', 'manager'], 'viewer@example.com': ['viewer-password', 'viewer'] };

  if (url.pathname === '/signin' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const form = new URLSearchParams(body);
      const account = ACCOUNTS[form.get('email') || ''];
      if (account && account[0] === form.get('password')) {
        res.writeHead(302, { 'Set-Cookie': `fixture_session=${account[1]}; Path=/; HttpOnly`, Location: '/account' });
        res.end();
      } else {
        html('Sign in', `<h1>Sign in</h1><p role="alert">Wrong email or password</p>${SIGN_IN_FORM}`);
      }
    });
    return;
  }
  if (url.pathname === '/signin') return html('Sign in', `<h1>Sign in</h1>${SIGN_IN_FORM}`);
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
         <a href="/signout">Sign out</a>`
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
    // Only managers may see the team page.
    if (url.pathname === '/account/team') {
      return session === 'manager'
        ? html('Team', '<h1>Team</h1><p>2 people</p>')
        : html('No access', '<h1>You don’t have access to this page</h1>', 403);
    }
  }
  // Planted: a page with no title (and no description) for search engines to show.
  if (url.pathname === '/about') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body>
      <header><nav><a href="/">Home</a></nav></header><main><h1>About Fixture</h1><p>We make invoices.</p></main></body></html>`);
    return;
  }
  // Planted: a slow page (answers after 2 seconds).
  if (url.pathname === '/reports') {
    setTimeout(() => html('Reports', '<h1>Reports</h1><p>Monthly totals.</p>'), 2000);
    return;
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
      </head>
      <body>
        <header><nav><a href="/">Home</a></nav></header>
        <main>
          <h2>Sign In</h2>
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
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Fixture App - Dashboard</title>
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
          <h2>Dashboard</h2>
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
          <h2>Create Invoice</h2>
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
      </head>
      <body>
        <header><nav><a href="/dashboard">Dashboard</a></nav></header>
        <main>
          <h2>Invoice INV-101</h2>
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

if (process.env.NODE_ENV !== 'test') {
  server.listen(port, () => {
    console.log(`Fixture server running at http://localhost:${port}`);
  });
}

export { server };
