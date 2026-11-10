import { useEffect, useRef, useState } from 'react';
import type { AuditGetReply, EditOverlay, PageAction, PageContent } from '@qa/types/src/browser.js';
import { getAiSetup } from '../../../api';
import { useConfirm } from '../../../components/ConfirmDialog';
import { ErrorMessage, Notice, Spinner } from '../../../components/text';
import { Badge, BottomActionBar, LoadError, Page, PageHeader } from '../../../components/ui';
import { count, scrollBehavior } from '../../../lib/format';
import { Link, navigate, PATHS } from '../../../lib/router';
import { AuditTabs } from '../AuditTabs';
import { useDocumentTitle } from '../../../lib/title';
import { RewriteReview } from '../ai/RewriteReview';
import {
  ADVISORY_LABEL,
  PLACED_BY_LABEL,
  SCALE_LABEL,
  SECTION_KIND_LABEL,
  SOURCE_LABEL,
  sectionLabel,
  textLangAttrs,
  titleText,
} from '../results/analysis-text';
import {
  chooseAction,
  draftToPatch,
  emptyDraft,
  findingRows,
  hierarchyTree,
  isDraftEmpty,
  recommendationRows,
  resetAction,
  resetFinding,
  resetSection,
  sectionRows,
  setFindingField,
  setPageRemoved,
  setSectionText,
  type FindingField,
  type ReviewDraft,
  type ReviewPageNode,
  type SectionRow,
} from './review-model';
import { loadAudit, loadEdits, loadPageContent, saveEdits, type Fetch } from './review-api';

/** A page's Page Content as the screen holds it while it loads. */
export type PageContentState =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; content: PageContent };

const FIELD_LABEL: Readonly<Record<FindingField, string>> = {
  title: 'Title',
  detail: 'What was found',
  suggestion: 'How to repair',
};

const ACTION_LABEL: Readonly<Record<PageAction, string>> = { redesign: 'Redesign', repair: 'Repair' };
const ACTIONS: readonly PageAction[] = ['redesign', 'repair'];

const DECIDED_BY_LABEL = { ai: 'proposed by AI', rule: 'decided by a fixed rule (no AI key)' } as const;

const UNSAVED = 'Not saved yet';

function UnsavedTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-2 align-middle">
      <Badge tone="warn">{UNSAVED}</Badge>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------
// Page hierarchy
// ---------------------------------------------------------------------------------------------------

function PageItem({
  node,
  selectedPage,
  onRemove,
  onSelect,
}: {
  node: ReviewPageNode;
  selectedPage: string | null;
  onRemove: (urlPath: string, removed: boolean) => void;
  onSelect: (urlPath: string) => void;
}) {
  const hasTitle = node.title !== null && node.title.trim() !== '';
  const isRoot = node.placedBy === 'start';
  return (
    <li className="mt-2" data-page={node.urlPath}>
      <div className={`flex flex-wrap items-center gap-2 ${node.removed ? 'text-ink-soft' : ''}`}>
        <span
          className={`font-bold ${node.removed ? 'line-through' : 'text-ink'}`}
          {...(hasTitle ? textLangAttrs(node.title ?? '', 'not-identified') : {})}
        >
          {hasTitle ? node.title : node.urlPath}
        </span>
        {hasTitle ? (
          <span className="break-all text-sm text-ink-soft">{node.urlPath}</span>
        ) : (
          <span className="text-sm text-ink-soft">({titleText(node.title)})</span>
        )}
        <span className="text-xs text-ink-soft">{PLACED_BY_LABEL[node.placedBy]}</span>
        {node.removed && <span className="text-sm font-semibold text-fail">Removed from the Audit Documents</span>}
        <UnsavedTag show={node.unsaved} />
        {node.removed ? (
          <button
            type="button"
            className="btn-quiet btn-sm"
            aria-label={`Restore ${node.urlPath} to the Audit Documents`}
            onClick={() => onRemove(node.urlPath, false)}
          >
            Restore
          </button>
        ) : (
          !isRoot && (
            <button
              type="button"
              className="btn-quiet btn-sm"
              aria-label={`Remove ${node.urlPath} from the Audit Documents`}
              onClick={() => onRemove(node.urlPath, true)}
            >
              Remove
            </button>
          )
        )}
        <button
          type="button"
          className="btn-link text-sm"
          aria-label={`Edit the Sections of ${node.urlPath}`}
          aria-pressed={selectedPage === node.urlPath}
          onClick={() => onSelect(node.urlPath)}
        >
          Edit Sections
        </button>
      </div>
      {node.children.length > 0 && (
        <ul className="ml-4 border-l border-rule pl-3">
          {node.children.map((child) => (
            <PageItem
              key={child.urlPath}
              node={child}
              selectedPage={selectedPage}
              onRemove={onRemove}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------
// Sections of one page
// ---------------------------------------------------------------------------------------------------

function sectionName(row: SectionRow): string {
  const heading = row.section.heading?.trim();
  return `Section ${row.section.id}: ${heading ? heading : SECTION_KIND_LABEL[row.section.kind]}`;
}

function SectionsEditor({
  urlPath,
  state,
  edits,
  draft,
  onDraft,
}: {
  urlPath: string | null;
  state: PageContentState | undefined;
  edits: EditOverlay;
  draft: ReviewDraft;
  onDraft: (draft: ReviewDraft) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Picking a page opens its Sections here: scroll to them and move focus, so the change is not silent.
  useEffect(() => {
    if (urlPath === null) return;
    const heading = headingRef.current;
    if (!heading) return;
    heading.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    heading.focus({ preventScroll: true });
  }, [urlPath]);

  let body;
  if (urlPath === null) {
    body = <p className="text-sm text-ink-soft">Pick a page in the hierarchy with Edit Sections to change its text.</p>;
  } else if (!state || state.status === 'loading') {
    body = <Spinner label="Loading the Page Content…" />;
  } else if (state.status === 'failed') {
    body = <ErrorMessage>{state.message}</ErrorMessage>;
  } else {
    const content = state.content;
    const rows = sectionRows(content, edits, draft);
    body =
      rows.length === 0 ? (
        <p className="text-sm text-ink-soft">This page has no Sections.</p>
      ) : (
        <ol className="space-y-4">
          {rows.map((row, i) => {
            const id = `review-section-${i}`;
            const name = sectionName(row);
            const lang = textLangAttrs(row.original, content.language.primary);
            return (
              <li key={row.section.id} className="rounded-card border border-rule p-3" data-section-id={row.section.id}>
                <h3 className="font-bold">
                  {name}
                  <UnsavedTag show={row.unsaved} />
                </h3>
                {row.byRewrite && (
                  <p className="text-xs text-ink-soft">Accepted AI copy, in the Audit Documents only.</p>
                )}
                <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label htmlFor={id} className="label text-ink">
                      {`Text of ${name}`}
                    </label>
                    <textarea
                      id={id}
                      rows={6}
                      className="field w-full"
                      value={row.shown}
                      onChange={(e) => onDraft(setSectionText(draft, content.urlPath, row.section.id, e.target.value))}
                      {...lang}
                    />
                  </div>
                  {row.edited && (
                    <div>
                      <p className="label text-ink">Original text</p>
                      <p className="whitespace-pre-wrap text-base text-ink-soft" {...lang}>
                        {row.original}
                      </p>
                      <button
                        type="button"
                        className="btn-quiet btn-sm mt-2"
                        aria-label={`Reset ${name} to the original text`}
                        onClick={() => onDraft(resetSection(draft, content.urlPath, row.section.id))}
                      >
                        Reset to original
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      );
  }
  return (
    <section aria-labelledby="review-sections-title" className="space-y-3">
      <h2
        id="review-sections-title"
        ref={headingRef}
        tabIndex={-1}
        className="break-all text-xl font-bold outline-none"
      >
        {urlPath === null ? 'Page Content by Section' : `Page Content by Section: ${urlPath}`}
      </h2>
      {body}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// The whole review
// ---------------------------------------------------------------------------------------------------

export interface ReviewDocumentsViewProps {
  reply: AuditGetReply;
  /** The saved edits (the reply's, or the latest save's). */
  edits: EditOverlay;
  draft: ReviewDraft;
  /** The page whose Sections are open, and its Page Content. */
  selectedPage: string | null;
  content?: PageContentState;
  saving: boolean;
  /** The last save's outcome, in plain words. */
  message: { tone: 'pass' | 'fail'; text: string } | null;
  onDraft: (draft: ReviewDraft) => void;
  onSelectPage: (urlPath: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  /** An AI key is set up: true shows the Section rewrite, false shows how to add a key, null (not known yet) shows neither. */
  aiConfigured?: boolean | null;
  /** New copy was accepted for a Section: the stored edits are re-read. */
  onRewriteAccepted?: () => void;
  /** For tests: the requests of the Section rewrite. */
  fetchImpl?: Fetch;
}

/**
 * The review and edit view of one Website Audit version (REQ-020): the page hierarchy with remove and
 * restore, each page's Sections, the findings and the redesign-or-repair choice per Sample Page. Edits
 * change the Audit Documents only; every original is kept and shown beside its edit.
 */
export function ReviewDocumentsView({
  reply,
  edits,
  draft,
  selectedPage,
  content,
  saving,
  message,
  onDraft,
  onSelectPage,
  onSave,
  onDiscard,
  aiConfigured = null,
  onRewriteAccepted,
  fetchImpl,
}: ReviewDocumentsViewProps) {
  const result = reply.result;
  if (!result) {
    return (
      <p className="max-w-prose text-ink-soft">
        This version of the Website Audit has no results to review: it is still running, or it stopped before it
        finished.
      </p>
    );
  }
  const tree = hierarchyTree(result, edits, draft);
  const findings = findingRows(result, edits, draft);
  const recommendations = recommendationRows(result, edits, draft);
  const pending = !isDraftEmpty(draft);

  return (
    <div className="space-y-10">
      <section aria-labelledby="review-hierarchy-title" className="space-y-3">
        <h2 id="review-hierarchy-title" className="text-xl font-bold">
          Page hierarchy
        </h2>
        <p className="max-w-prose text-sm text-ink-soft">
          A removed page is left out of the exported Audit Documents. Restore it at any time.
        </p>
        <ul aria-label="Page hierarchy">
          <PageItem
            node={tree}
            selectedPage={selectedPage}
            onRemove={(urlPath, removed) => onDraft(setPageRemoved(draft, edits, urlPath, removed))}
            onSelect={onSelectPage}
          />
        </ul>
      </section>

      <SectionsEditor urlPath={selectedPage} state={content} edits={edits} draft={draft} onDraft={onDraft} />

      {content?.status === 'loaded' &&
        (aiConfigured === true ? (
          <RewriteReview
            key={content.content.urlPath}
            auditId={reply.summary.auditId}
            version={reply.version.version}
            content={content.content}
            onAccepted={onRewriteAccepted}
            fetchImpl={fetchImpl}
          />
        ) : aiConfigured === false ? (
          <Notice
            tone="stamp"
            title="Rewriting a Section needs an AI key"
            actions={
              <Link to={PATHS.settings} className="btn-link min-h-[44px]">
                Add an AI key in Settings
              </Link>
            }
          />
        ) : null)}

      <section aria-labelledby="review-findings-title" className="space-y-3">
        <h2 id="review-findings-title" className="text-xl font-bold">
          Findings
        </h2>
        <p className="max-w-prose text-sm text-ink-soft">
          {`${count(findings.length, 'finding', 'findings')}. The Findings document and the Improvement Roadmap use the text below.`}
        </p>
        {findings.length === 0 ? (
          <p className="text-sm text-ink-soft">No findings were recorded.</p>
        ) : (
          <ol className="space-y-4">
            {findings.map((row, i) => {
              const { finding } = row;
              const isAi = finding.source === 'ai' || finding.advisory === true;
              return (
                <li key={finding.id} className="rounded-card border border-rule p-3" data-finding-id={finding.id}>
                  <h3 className="font-bold">
                    {`${finding.id}: ${row.shown.title}`}
                    <UnsavedTag show={row.unsaved} />
                  </h3>
                  {isAi && (
                    <p className="mt-1 inline-flex rounded-full bg-stamp-tint px-2 text-xs font-semibold text-stamp">
                      {ADVISORY_LABEL}
                    </p>
                  )}
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                    <dt className="font-bold">Page</dt>
                    <dd className="break-all">{finding.urlPath}</dd>
                    <dt className="font-bold">Section</dt>
                    <dd>{sectionLabel(finding.sectionId)}</dd>
                    <dt className="font-bold">Impact</dt>
                    <dd>{SCALE_LABEL[finding.impact]}</dd>
                    <dt className="font-bold">Effort</dt>
                    <dd>{SCALE_LABEL[finding.effort]}</dd>
                    <dt className="font-bold">Source</dt>
                    <dd>{SOURCE_LABEL[finding.source]}</dd>
                  </dl>
                  {(['title', 'detail', 'suggestion'] as const).map((field) => {
                    const id = `review-finding-${i}-${field}`;
                    const changed = row.changed.includes(field);
                    const label = `${FIELD_LABEL[field]} of finding ${finding.id}`;
                    return (
                      <div key={field} className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor={id} className="label text-ink">
                            {label}
                          </label>
                          {field === 'title' ? (
                            <input
                              id={id}
                              type="text"
                              className="field w-full"
                              value={row.shown[field]}
                              onChange={(e) => onDraft(setFindingField(draft, finding.id, field, e.target.value))}
                            />
                          ) : (
                            <textarea
                              id={id}
                              rows={3}
                              className="field w-full"
                              value={row.shown[field]}
                              onChange={(e) => onDraft(setFindingField(draft, finding.id, field, e.target.value))}
                            />
                          )}
                        </div>
                        {changed && (
                          <div>
                            <p className="label text-ink">{`Original ${FIELD_LABEL[field].toLowerCase()}`}</p>
                            <p className="whitespace-pre-wrap text-sm text-ink-soft">{finding[field]}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {row.changed.length > 0 && (
                    <button
                      type="button"
                      className="btn-quiet btn-sm mt-3"
                      aria-label={`Reset finding ${finding.id} to the original text`}
                      onClick={() => onDraft(resetFinding(draft, finding.id))}
                    >
                      Reset to original
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="review-actions-title" className="space-y-3">
        <h2 id="review-actions-title" className="text-xl font-bold">
          Redesign or repair
        </h2>
        <p className="max-w-prose text-sm text-ink-soft">
          One choice per Sample Page. The pages its Layout Group covers follow it.
        </p>
        {recommendations.length === 0 ? (
          <p className="text-sm text-ink-soft">No Sample Page has a redesign-or-repair recommendation.</p>
        ) : (
          <ul className="space-y-4">
            {recommendations.map((row, i) => (
              <li key={row.urlPath} className="rounded-card border border-rule p-3">
                <fieldset>
                  <legend className="font-bold">
                    {`Redesign or repair: ${row.urlPath}`}
                    <UnsavedTag show={row.unsaved} />
                  </legend>
                  <p className="mt-1 text-sm text-ink-soft">
                    {`Proposed: ${ACTION_LABEL[row.proposed.action]}, ${DECIDED_BY_LABEL[row.proposed.decidedBy]}. ${row.proposed.reason}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-6">
                    {ACTIONS.map((action) => {
                      const id = `review-action-${i}-${action}`;
                      return (
                        <span key={action} className="inline-flex min-h-[44px] items-center gap-2">
                          <input
                            id={id}
                            type="radio"
                            name={`review-action-${i}`}
                            value={action}
                            checked={row.chosen === action}
                            onChange={() => onDraft(chooseAction(draft, row.urlPath, action))}
                            className="h-5 w-5 accent-stamp"
                          />
                          <label htmlFor={id} className="py-3 pr-3">
                            {ACTION_LABEL[action]}
                          </label>
                        </span>
                      );
                    })}
                  </div>
                  {row.edited && (
                    <button
                      type="button"
                      className="btn-quiet btn-sm mt-2"
                      aria-label={`Reset ${row.urlPath} to the proposed choice`}
                      onClick={() => onDraft(resetAction(draft, row.urlPath))}
                    >
                      Reset to proposed
                    </button>
                  )}
                </fieldset>
              </li>
            ))}
          </ul>
        )}
      </section>
      <BottomActionBar
        summary={
          <>
            <span aria-live="polite">
              {pending ? 'You have changes that are not saved yet.' : 'Every change is saved.'}
            </span>
            {message &&
              (message.tone === 'fail' ? (
                <span role="alert" className="mt-1 block font-semibold text-fail">
                  {message.text}
                </span>
              ) : (
                <span role="status" className="mt-1 block font-semibold text-pass">
                  {message.text}
                </span>
              ))}
          </>
        }
      >
        <button type="button" className="btn-quiet" disabled={!pending || saving} onClick={onDiscard}>
          Discard changes
        </button>
        <button type="button" className="btn-primary" disabled={!pending || saving} onClick={onSave}>
          {saving ? <Spinner label="Saving…" announce={false} /> : 'Save changes'}
        </button>
      </BottomActionBar>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// The screen
// ---------------------------------------------------------------------------------------------------

export interface ReviewDocumentsScreenProps {
  auditId: string;
  /** The version to review; the latest when not given. */
  version?: number;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: reads whether an AI key is set up. */
  aiSetup?: () => Promise<{ configured: boolean }>;
}

type Loaded =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; reply: AuditGetReply };

/** Review and edit a Website Audit version's Audit Documents before export (REQ-020). */
export function ReviewDocumentsScreen({
  auditId,
  version,
  fetchImpl,
  aiSetup = getAiSetup,
}: ReviewDocumentsScreenProps) {
  useDocumentTitle('Review the Audit Documents');
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [edits, setEdits] = useState<EditOverlay | null>(null);
  const [draft, setDraft] = useState<ReviewDraft>(emptyDraft);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, PageContentState>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<ReviewDocumentsViewProps['message']>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoaded({ status: 'loading' });
    void loadAudit(auditId, version, fetchImpl).then((outcome) => {
      if (!live) return;
      if (outcome.ok) {
        setLoaded({ status: 'loaded', reply: outcome.value });
        setEdits(outcome.value.edits);
      } else {
        setLoaded({ status: 'failed', message: outcome.message });
      }
    });
    return () => {
      live = false;
    };
  }, [auditId, version, fetchImpl, reloadKey]);

  // Whether an AI key is set up decides if the Section rewrite shows. Unknown (a failed read) shows neither.
  useEffect(() => {
    let live = true;
    void aiSetup().then(
      (setup) => live && setAiConfigured(setup.configured),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [aiSetup]);

  const reply = loaded.status === 'loaded' ? loaded.reply : null;
  const versionNumber = reply?.version.version ?? version;

  const selectPage = (urlPath: string) => {
    setSelectedPage(urlPath);
    const known = contents[urlPath];
    if (known && known.status !== 'failed') return;
    setContents((all) => ({ ...all, [urlPath]: { status: 'loading' } }));
    void loadPageContent(auditId, urlPath, versionNumber, fetchImpl).then((outcome) => {
      setContents((all) => ({
        ...all,
        [urlPath]: outcome.ok
          ? { status: 'loaded', content: outcome.value }
          : { status: 'failed', message: outcome.message },
      }));
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const outcome = await saveEdits(auditId, draftToPatch(draft), versionNumber, fetchImpl);
    if (outcome.ok) {
      setEdits(outcome.value);
      setDraft(emptyDraft());
      setMessage({ tone: 'pass', text: 'Changes saved. Exports of the Audit Documents now use them.' });
    } else {
      // Show what is stored now, so the screen never claims a change that was not saved.
      const stored = await loadEdits(auditId, versionNumber, fetchImpl);
      if (stored.ok) setEdits(stored.value);
      setMessage({ tone: 'fail', text: outcome.message });
    }
    setSaving(false);
  };

  /** An accepted rewrite is a stored edit: show what is stored now, so a later hand edit starts from it. */
  const reloadEdits = async () => {
    const stored = await loadEdits(auditId, versionNumber, fetchImpl);
    if (stored.ok) setEdits(stored.value);
  };

  const dirty = !isDraftEmpty(draft);
  const { confirm, dialog } = useConfirm();

  // Unsaved edits: the browser asks before the tab closes or reloads, and a click on a link inside the app
  // asks first (the capture listener runs before the router's own click handling).
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return;
      const href = link.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//')) return;
      e.preventDefault();
      void confirm({
        title: 'Leave without saving?',
        body: 'Your edits are not saved yet. If you leave now, they are lost.',
        confirmLabel: 'Leave and lose the edits',
        cancelLabel: 'Stay and keep editing',
        danger: true,
      }).then((leave) => {
        if (leave) navigate(href);
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm]);

  const discard = async () => {
    const yes = await confirm({
      title: 'Discard your changes?',
      body: 'Every edit you have not saved is thrown away. Saved edits stay.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    });
    if (!yes) return;
    setDraft(emptyDraft());
    setMessage(null);
  };

  return (
    <Page width="workspace">
      <PageHeader
        // Back to this audit, which a Helper may open too (the list of all audits is the owner's).
        back={{ to: PATHS.audit(auditId), label: 'Back to this Website Audit' }}
        meta={
          reply ? (
            <span className="break-all">{`${reply.summary.url}, version ${reply.version.version}`}</span>
          ) : undefined
        }
        title="Review the Audit Documents"
        lede="Change the text of Sections and findings, remove pages, and pick redesign or repair before you download. Edits change the Audit Documents only: the Website Audit keeps every original, and you can reset an edit at any time."
      />
      {/* This screen doesn't know whether the caller is a Helper, so the owner-only tabs are left out. */}
      <AuditTabs auditId={auditId} version={versionNumber} current="documents" hide={['share', 'helpers']} />

      {loaded.status === 'loading' && <Spinner label="Loading the Website Audit…" />}
      {loaded.status === 'failed' && (
        <LoadError title="The Website Audit could not be loaded" onRetry={() => setReloadKey((k) => k + 1)}>
          {loaded.message}
        </LoadError>
      )}
      {reply && edits && (
        <ReviewDocumentsView
          reply={reply}
          edits={edits}
          draft={draft}
          selectedPage={selectedPage}
          content={selectedPage === null ? undefined : contents[selectedPage]}
          saving={saving}
          message={message}
          onDraft={(next) => {
            setDraft(next);
            setMessage(null);
          }}
          aiConfigured={aiConfigured}
          onRewriteAccepted={() => void reloadEdits()}
          fetchImpl={fetchImpl}
          onSelectPage={selectPage}
          onSave={() => void save()}
          onDiscard={() => void discard()}
        />
      )}
      {dialog}
    </Page>
  );
}
