import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, PageError } from '../src/components/ErrorBoundary';

describe('PageError', () => {
  it('renders notice title and reload button', () => {
    const html = renderToStaticMarkup(createElement(PageError));
    expect(html).toContain('This page couldn’t be shown');
    expect(html).toContain('Reload the page');
    expect(html).toContain('btn-primary');
  });

  it('triggers window.location.reload when reload button is clicked', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', {
      location: { reload },
    });
    try {
      const el = PageError();
      const noticeProps = el.props.children.props;
      const button = noticeProps.actions;
      button.props.onClick();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('ErrorBoundary.getDerivedStateFromError', () => {
  it('derives state from an error instance', () => {
    const err = new Error('Test crash');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('derives state when error is null or undefined', () => {
    const res1 = ErrorBoundary.getDerivedStateFromError(null);
    expect(res1.error).toBeInstanceOf(Error);
    expect((res1.error as Error).message).toBe('Unknown render error');

    const res2 = ErrorBoundary.getDerivedStateFromError(undefined);
    expect(res2.error).toBeInstanceOf(Error);
    expect((res2.error as Error).message).toBe('Unknown render error');
  });

  it('derives state from a string or other throwables', () => {
    expect(ErrorBoundary.getDerivedStateFromError('string error')).toEqual({ error: 'string error' });
  });
});

describe('ErrorBoundary.getDerivedStateFromProps', () => {
  it('resets error when resetKey changes', () => {
    const props = { children: 'content', resetKey: '/new-route' };
    const state = { error: new Error('fail'), key: '/old-route' };
    expect(ErrorBoundary.getDerivedStateFromProps(props, state)).toEqual({
      error: null,
      key: '/new-route',
    });
  });

  it('returns null when resetKey has not changed', () => {
    const props = { children: 'content', resetKey: '/same-route' };
    const state = { error: new Error('fail'), key: '/same-route' };
    expect(ErrorBoundary.getDerivedStateFromProps(props, state)).toBeNull();
  });

  it('returns null when both keys are undefined', () => {
    const props = { children: 'content' };
    const state = { error: null, key: undefined };
    expect(ErrorBoundary.getDerivedStateFromProps(props, state)).toBeNull();
  });
});

describe('ErrorBoundary render and lifecycle', () => {
  it('renders children when error is null', () => {
    const boundary = new ErrorBoundary({ children: createElement('span', null, 'Normal Content') });
    boundary.state = { error: null, key: undefined };
    const rendered = boundary.render();
    const html = renderToStaticMarkup(rendered as any);
    expect(html).toContain('Normal Content');
  });

  it('renders PageError when error is set', () => {
    const boundary = new ErrorBoundary({ children: createElement('span', null, 'Normal Content') });
    boundary.state = { error: new Error('crash'), key: undefined };
    const rendered = boundary.render();
    const html = renderToStaticMarkup(rendered as any);
    expect(html).toContain('This page couldn’t be shown');
    expect(html).toContain('Reload the page');
    expect(html).not.toContain('Normal Content');
  });

  it('logs component stack on componentDidCatch', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: 'Child' });
    const err = new Error('crash');
    boundary.componentDidCatch(err, { componentStack: '\n at BrokenComp' });
    expect(errorSpy).toHaveBeenCalledWith('A page could not be shown', err, '\n at BrokenComp');
    errorSpy.mockRestore();
  });
});

describe('source checks for main.tsx and App.tsx', () => {
  const SRC = fileURLToPath(new URL('../src', import.meta.url));

  it('main.tsx imports ErrorBoundary and PageError and protects entry rendering', () => {
    const main = readFileSync(join(SRC, 'main.tsx'), 'utf8');
    expect(main).toMatch(/import\s*\{\s*ErrorBoundary,\s*PageError\s*\}\s*from\s*'\.\/components\/ErrorBoundary'/);
    expect(main).toContain('<ErrorBoundary>');
    expect(main).toContain('</ErrorBoundary>');
    expect(main).toMatch(/\(\)\s*=>\s*root\.render\(<PageError\s*\/>\)/);
  });

  it('App.tsx imports ErrorBoundary and wraps Suspense with resetKey', () => {
    const app = readFileSync(join(SRC, 'App.tsx'), 'utf8');
    expect(app).toMatch(/import\s*\{\s*ErrorBoundary\s*\}\s*from\s*'\.\/components\/ErrorBoundary'/);
    expect(app).toContain('<ErrorBoundary resetKey={pathname}>');
    expect(app).toContain('<Suspense fallback={<Loading label="Opening…" />}>{body}</Suspense>');
    expect(app).toContain('</ErrorBoundary>');
  });
});
