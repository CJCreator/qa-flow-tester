import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DisabledReason, WORKING_ID, WorkingLine, reasonId, workingId } from '../src/components/DisabledReason';
import {
  defaultExportChoice,
  defaultOwnerAuditChoice,
  defaultPitchChoice,
} from '../src/screens/audit/documents/export-api';
import { ExportDocumentsView } from '../src/screens/audit/documents/ExportDocumentsScreen';
import { AuditAiModelsView } from '../src/screens/audit/ai/AuditAiModelsPanel';
import {
  AUDIT_AI_STAGES,
  STAGE_DEFAULT_SLOT,
  draftFrom,
  type AuditAiModelsReply,
  type ModelsState,
} from '../src/screens/audit/ai/stage-models-api';

/**
 * T-396 (gap W20): every disabled button says why.
 *
 * Two checks. The rendered check puts screens in their disabled states and follows each disabled
 * button's `aria-describedby` to visible text. The source check walks every `<button>` in the wizard
 * and fails when one that can be disabled has no `aria-describedby`, or points at an id that nothing
 * in its file renders.
 */

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const noop = () => {};

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** The text of the element with this id, '' when no element has it. */
function textOfId(html: string, id: string): string {
  const open = html.match(new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id}"[^>]*>`));
  if (!open) return '';
  const start = (open.index ?? 0) + open[0].length;
  const end = html.indexOf(`</${open[1]}>`, start);
  return decode(html.slice(start, end).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every disabled button in the markup that has no `aria-describedby` pointing at visible text. */
function unexplained(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = m[1];
    if (!/\sdisabled(=""|\s|$)/.test(` ${attrs}`)) continue;
    const label = decode(m[2].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    const ids = (attrs.match(/aria-describedby="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
    if (!ids.some((id) => textOfId(html, id) !== '')) bad.push(label || attrs);
  }
  return bad;
}

describe('DisabledReason', () => {
  it('renders a visible line with the id the button points at', () => {
    const html = renderToStaticMarkup(createElement(DisabledReason, { id: 'x', children: 'Enter the address first' }));
    expect(textOfId(html, 'x')).toBe('Enter the address first');
  });

  it('renders nothing while the button is on', () => {
    const html = renderToStaticMarkup(createElement(DisabledReason, { id: 'x', when: false, children: 'No' }));
    expect(html).toBe('');
    expect(reasonId('x', false)).toBeUndefined();
    expect(reasonId('x', true)).toBe('x');
  });

  it('the shared busy line is a live region that says Working…', () => {
    const idle = renderToStaticMarkup(createElement(WorkingLine, { busy: false }));
    expect(idle).toContain('role="status"');
    expect(idle).toContain('aria-live="polite"');
    expect(idle).not.toContain('Working');
    const busy = renderToStaticMarkup(createElement(WorkingLine, { busy: true }));
    expect(textOfId(busy, WORKING_ID)).toBe('Working…');
    expect(workingId(true)).toBe(WORKING_ID);
    expect(workingId(false)).toBeUndefined();
    expect(workingId(true, 'other')).toBe('other');
  });
});

describe('rendered screens', () => {
  const exportView = (props: Partial<Parameters<typeof ExportDocumentsView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(ExportDocumentsView, {
        auditId: 'abcd1234',
        choice: defaultExportChoice(),
        pitch: defaultPitchChoice(),
        owner: defaultOwnerAuditChoice(),
        onChoice: noop,
        onPitch: noop,
        onOwner: noop,
        ...props,
      })
    );

  it.each([
    ['a download is running', { busy: 'pitch' as const }],
    ['the version is not ready', { blockedReason: 'The Website Audit is still running.' }],
    ['the version is being read', { checking: true }],
    ['the version could not be read', { loadError: 'It was not found.' }],
  ])('Export: every disabled download says why when %s', (_name, props) => {
    const html = exportView(props);
    expect(html).toMatch(/<button\b[^>]*\sdisabled/);
    expect(unexplained(html)).toEqual([]);
  });

  it('Export: an enabled download has no reason line', () => {
    expect(exportView()).not.toContain('export-off-reason');
  });

  const modelsView = (saving: boolean) => {
    const defaults = { text: 'gemini-2.5-flash', vision: 'gemini-2.5-pro' };
    const effective = {} as AuditAiModelsReply['effective'];
    for (const stage of AUDIT_AI_STAGES) effective[stage] = defaults[STAGE_DEFAULT_SLOT[stage]];
    const reply: AuditAiModelsReply = { models: {}, defaults, effective };
    const state: ModelsState = { reply, draft: draftFrom(reply), errors: {}, message: null };
    return renderToStaticMarkup(
      createElement(AuditAiModelsView, { ...state, saving, onDraft: noop, onSave: noop, onDiscard: noop })
    );
  };

  it.each([
    ['nothing has changed', false],
    ['it is saving', true],
  ])('AI models: Save and Discard say why when %s', (_name, saving) => {
    const html = modelsView(saving);
    expect(html).toMatch(/<button\b[^>]*\sdisabled/);
    expect(unexplained(html)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------
// Source check: every screen, in every state
// ---------------------------------------------------------------------------------------------------

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) tsxFiles(full, out);
    else if (full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

interface ButtonSite {
  file: string;
  line: number;
  /** The aria-describedby expression, or null when the button has none. */
  describedBy: string | null;
  /** String and template ids named in that expression. */
  ids: string[];
}

function disabledButtons(): ButtonSite[] {
  const sites: ButtonSite[] = [];
  for (const file of tsxFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === 'button') {
        const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
        const named = (name: string) => attrs.find((a) => a.name.getText() === name);
        if (named('disabled')) {
          const by = named('aria-describedby');
          const ids: string[] = [];
          const collect = (n: ts.Node): void => {
            if (ts.isStringLiteralLike(n) && !ts.isBinaryExpression(n.parent)) ids.push(n.text);
            else if (ts.isTemplateExpression(n))
              ids.push('`' + n.templateSpans[n.templateSpans.length - 1].literal.text);
            ts.forEachChild(n, collect);
          };
          if (by?.initializer) collect(by.initializer);
          sites.push({
            file: relative(SRC, file).replace(/\\/g, '/'),
            line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            describedBy: by?.initializer ? by.initializer.getText() : null,
            ids,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

/** Components whose buttons are on while a screen is busy: the screen that renders them mounts the shared line. */
const SHARED_LINE_FROM: Record<string, string> = {
  'components/plan/parts.tsx': 'components/plan/PlanDocument.tsx',
};

describe('every disabled button in the wizard', () => {
  const sites = disabledButtons();

  it('finds the disabled buttons (the guard itself is not empty)', () => {
    expect(sites.length).toBeGreaterThan(60);
  });

  it('has an aria-describedby', () => {
    expect(sites.filter((s) => s.describedBy === null).map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });

  it('points at a line its file renders', () => {
    const missing: string[] = [];
    for (const site of sites) {
      if (site.describedBy === null) continue;
      const source = readFileSync(join(SRC, site.file), 'utf8');
      // A shared line, from DisabledReason.tsx, or a prop passed on to a component that renders it.
      const usesHelper = /workingId\(|WORKING_ID|reasonId\(/.test(site.describedBy);
      const named = site.ids.filter((id) => id !== '');
      for (const id of named) {
        if (id.startsWith('`')) {
          // A template id: the file must render an element whose id ends the same way.
          if (!source.includes(id.slice(1) + '`')) missing.push(`${site.file}:${site.line} ${id}`);
        } else if (!new RegExp(`id=(?:"${id}"|\\{'${id}'\\}|\\{"${id}"\\})`).test(source)) {
          missing.push(`${site.file}:${site.line} ${id}`);
        }
      }
      if (usesHelper && !named.length) {
        // workingId() alone: the file mounts the shared line, or the screen that renders its component does.
        const host = SHARED_LINE_FROM[site.file];
        const hostSource = host ? readFileSync(join(SRC, host), 'utf8') : source;
        if (!hostSource.includes('<WorkingLine')) missing.push(`${site.file}:${site.line} (no busy line)`);
      }
    }
    expect(missing).toEqual([]);
  });
});
