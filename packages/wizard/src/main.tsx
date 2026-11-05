import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/anek-latin/wdth.css';
import '@fontsource-variable/anek-tamil/wdth.css';
import './index.css';
import { matchRoute } from './lib/router';
import { applyTheme, readTheme } from './lib/theme';

// The public landing page is what most first visits open, so it loads without the app's code (the
// runner connection, the plan editor, the report). Its links are page loads, which fetch the app.
const root = ReactDOM.createRoot(document.getElementById('root')!);
const isLanding = matchRoute(window.location.pathname).name === 'landing';
// A saved light or dark choice is set before the first paint, so the page never flashes the other theme.
applyTheme(readTheme(), document.documentElement);
const Entry = isLanding ? import('./LandingRoot') : import('./App');
void Entry.then(({ default: Page }) =>
  root.render(
    <React.StrictMode>
      <Page />
    </React.StrictMode>
  )
);
