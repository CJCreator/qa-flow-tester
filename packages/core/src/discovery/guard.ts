import type { Dialog, Page, Request, Route } from 'playwright';

const CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** How far up a chain of popups (a popup opened by a popup) the guard looks for the page it guards. */
const MAX_OPENER_DEPTH = 5;

/**
 * Makes a page safe to click around on while the Spider explores (ADR 0025): every request that would
 * change something is aborted before it leaves the browser, and any confirm/alert dialog is dismissed.
 * The guard is a context route (T-425), so a popup the page opens (`window.open`, `target="_blank"`) is
 * guarded like its opener. Other pages of the context are left alone.
 * Returns what was blocked and seen, and a function that lifts the guard.
 */
export async function guardPage(page: Page): Promise<{
  blocked: string[];
  dialogs: string[];
  release: () => Promise<void>;
}> {
  const context = page.context();
  const blocked: string[] = [];
  const dialogs: string[] = [];
  const onDialog = (d: Dialog) => {
    dialogs.push(d.type());
    void d.dismiss().catch(() => undefined);
  };
  /** The guarded page, or a page it opened (directly or through other popups). */
  const covers = async (request: Request): Promise<boolean> => {
    let current: Page | null;
    try {
      current = request.frame().page();
    } catch {
      return true; // no frame (a worker): changing requests are stopped, to be safe
    }
    for (let i = 0; current && i <= MAX_OPENER_DEPTH; i++) {
      if (current === page) return true;
      current = await current.opener().catch(() => null);
    }
    return false;
  };
  const handler = async (route: Route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (CHANGING.has(method) && (await covers(request))) {
      blocked.push(method);
      await route.abort('blockedbyclient').catch(() => undefined);
      return;
    }
    await route.fallback().catch(() => undefined);
  };
  const popups = new Set<Page>();
  const onPage = (p: Page) => {
    void (async () => {
      for (let current: Page | null = p, i = 0; current && i <= MAX_OPENER_DEPTH; i++) {
        current = await current.opener().catch(() => null);
        if (current === page || (current && popups.has(current))) {
          popups.add(p);
          p.on('dialog', onDialog);
          return;
        }
      }
    })();
  };
  page.on('dialog', onDialog);
  context.on('page', onPage);
  await context.route('**/*', handler);
  return {
    blocked,
    dialogs,
    release: async () => {
      page.off('dialog', onDialog);
      context.off('page', onPage);
      for (const p of popups) p.off('dialog', onDialog);
      await context.unroute('**/*', handler).catch(() => undefined);
    },
  };
}
