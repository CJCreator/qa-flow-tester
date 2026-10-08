import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource/big-shoulders-stencil-display/800';
import './index.css';
import { matchRoute } from './lib/router';
import { applyTheme, readTheme } from './lib/theme';

// The public landing page is what most first visits open, so it loads without the app's code (the
// runner connection, the plan editor, the report). Its links are page loads, which fetch the app.
const root = ReactDOM.createRoot(document.getElementById('root')!);
const isLanding = matchRoute(window.location.pathname).name === 'landing';
// The landing page remembers a light choice; set before the first paint so it does not flash dark.
if (isLanding) applyTheme(readTheme(), document.documentElement);
const Entry = isLanding ? import('./LandingRoot') : import('./App');
void Entry.then(({ default: Page }) =>
  root.render(
    <React.StrictMode>
      <Page />
    </React.StrictMode>
  )
);
