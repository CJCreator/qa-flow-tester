import { useEffect, useState } from 'react';
import {
  isDocumentLanguage,
  sectionText,
  type DocumentLanguage,
  type OverlapFlag,
  type PageContent,
  type RewriteState,
  type Section,
} from '@qa/types/src/browser.js';
import { ErrorMessage, Spinner } from '../../../components/text';
import { SECTION_KIND_LABEL, textLangAttrs } from '../results/analysis-text';
import {
  acceptNewCopy,
  approveRewrite,
  listRewrites,
  markCopiedPhrases,
  wordCountText,
  writeNewCopy,
  type Fetch,
} from './rewrite-api';

export const AUDIT_DOCUMENTS_ONLY = 'New copy goes into the Audit Documents only, never onto the site.';
export const APPROVE_FIRST = 'Approve the rewrite first. Nothing is sent to the AI before that.';
export const NO_COPIED_PHRASES = 'No phrases copied from the original.';

/** What a Section's controls are doing now. */
export type RewriteBusy = 'approving' | 'writing' | 'accepting';

/** The last outcome for a Section, in plain words; a refused accept carries the phrases still copied. */
export interface RewriteMessage {
  tone: 'pass' | 'fail';
  text: string;
  overlaps?: OverlapFlag[];
}

function sectionName(section: Section): string {
  const heading = section.heading?.trim();
  return `Section ${section.id}: ${heading ? heading : SECTION_KIND_LABEL[section.kind]}`;
}

/** The text with its copied phrases in mark elements, so they are announced and not shown by colour alone. */
function MarkedText({
  text,
  overlaps,
  lang,
}: {
  text: string;
  overlaps: readonly OverlapFlag[];
  lang: ReturnType<typeof textLangAttrs>;
}) {
  return (
    <p className="whitespace-pre-wrap text-base text-ink" {...lang}>
      {markCopiedPhrases(text, overlaps).map((piece, i) =>
        piece.copied ? (
          <mark
            key={i}
            className="rounded-control bg-warn-tint font-semibold text-ink underline decoration-2"
            aria-label={`Copied phrase: ${piece.text}`}
          >
            {piece.text}
          </mark>
        ) : (
          <span key={i}>{piece.text}</span>
        )
      )}
    </p>
  );
}

function PhraseList({ overlaps, title }: { overlaps: readonly OverlapFlag[]; title: string }) {
  if (overlaps.length === 0) return <p className="text-sm text-ink-soft">{NO_COPIED_PHRASES}</p>;
  return (
    <div>
      <p className="label text-ink">{`${title} (${overlaps.length})`}</p>
      <ul className="list-disc pl-5 text-sm">
        {overlaps.map((flag, i) => (
          <li key={i}>
            <mark className="rounded-control bg-warn-tint font-semibold text-ink underline decoration-2">
              {flag.words}
            </mark>
            {`: ${wordCountText(flag.wordCount)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface RewriteReviewViewProps {
  content: PageContent;
  /** The saved rewrite of each Section, by Section id. */
  rewrites: Readonly<Record<string, RewriteState>>;
  /** The edited copy of each Section, by Section id; the proposal when not edited. */
  drafts: Readonly<Record<string, string>>;
  busy: Readonly<Record<string, RewriteBusy>>;
  messages: Readonly<Record<string, RewriteMessage>>;
  onApprove: (sectionId: string) => void;
  onWrite: (sectionId: string) => void;
  onDraft: (sectionId: string, text: string) => void;
  onAccept: (sectionId: string) => void;
}

/**
 * The Section rewrite of one page (REQ-030): per Section the original text, the approval, the AI's new copy
 * with every copied phrase marked and listed, an editable copy and the accept. New copy goes into the Audit
 * Documents only.
 */
export function RewriteReviewView({
  content,
  rewrites,
  drafts,
  busy,
  messages,
  onApprove,
  onWrite,
  onDraft,
  onAccept,
}: RewriteReviewViewProps) {
  return (
    <section aria-labelledby="rewrite-title" className="space-y-3">
      <h2 id="rewrite-title" className="text-xl font-bold">
        {`Rewrite Sections: ${content.urlPath}`}
      </h2>
      <p className="max-w-prose text-sm text-ink-soft">
        {`The AI writes new copy for a Section, after you approve it. To change a Section by hand, use its text box above. ${AUDIT_DOCUMENTS_ONLY}`}
      </p>
      {content.sections.length === 0 ? (
        <p className="text-sm text-ink-soft">This page has no Sections.</p>
      ) : (
        <ol className="space-y-4">
          {content.sections.map((section, i) => {
            const id = `rewrite-section-${i}`;
            const name = sectionName(section);
            const original = sectionText(content, section);
            const lang = textLangAttrs(original, content.language.primary);
            const rewrite = rewrites[section.id];
            const approved = Boolean(rewrite?.approvedAt);
            const proposal = rewrite?.proposal ?? null;
            const working = busy[section.id];
            const message = messages[section.id];
            const draft = drafts[section.id] ?? proposal?.text ?? '';
            const hasText = original.trim() !== '';
            return (
              <li key={section.id} className="rounded-card border border-rule p-3" data-section-id={section.id}>
                <h3 className="font-bold">{name}</h3>
                <p className="label mt-2 text-ink">Original text</p>
                {hasText ? (
                  <p className="whitespace-pre-wrap text-base text-ink-soft" {...lang}>
                    {original}
                  </p>
                ) : (
                  <p className="text-sm text-ink-soft">This Section has no text to rewrite.</p>
                )}

                {hasText && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {approved ? (
                      <span className="text-sm font-semibold text-pass">Approved for a rewrite</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-quiet btn-sm"
                        aria-label={`Approve rewrite of ${name}`}
                        disabled={working !== undefined}
                        onClick={() => onApprove(section.id)}
                      >
                        Step 1: Approve the rewrite
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-quiet btn-sm"
                      aria-label={`Write new copy for ${name}`}
                      aria-describedby={approved ? undefined : `${id}-approve-first`}
                      disabled={!approved || working !== undefined}
                      onClick={() => {
                        if (approved) onWrite(section.id);
                      }}
                    >
                      Step 2: Write new copy
                    </button>
                    {!approved && (
                      <span id={`${id}-approve-first`} className="text-sm text-ink-soft">
                        {APPROVE_FIRST}
                      </span>
                    )}
                    {working === 'approving' && <Spinner label="Approving…" />}
                    {working === 'writing' && <Spinner label="Writing new copy…" />}
                  </div>
                )}

                {proposal && (
                  <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <p className="label text-ink">Proposed copy</p>
                      <MarkedText text={proposal.text} overlaps={proposal.overlaps} lang={lang} />
                      <PhraseList overlaps={proposal.overlaps} title="Copied phrases" />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor={id} className="label text-ink">
                        {`New copy for ${name}`}
                      </label>
                      <textarea
                        id={id}
                        rows={6}
                        className="field w-full"
                        value={draft}
                        onChange={(e) => onDraft(section.id, e.target.value)}
                        {...lang}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          className="btn-quiet btn-sm"
                          aria-label={`Accept new copy for ${name}`}
                          disabled={working !== undefined || draft.trim() === ''}
                          onClick={() => onAccept(section.id)}
                        >
                          Accept
                        </button>
                        {working === 'accepting' && <Spinner label="Accepting…" />}
                      </div>
                      {rewrite?.acceptedAt && (
                        <p className="text-sm text-ink-soft">Accepted copy is in the Audit Documents.</p>
                      )}
                    </div>
                  </div>
                )}

                {message &&
                  (message.tone === 'fail' ? (
                    <div>
                      <ErrorMessage>{message.text}</ErrorMessage>
                      {message.overlaps && message.overlaps.length > 0 && (
                        <div className="mt-2 space-y-2">
                          <MarkedText text={draft} overlaps={message.overlaps} lang={lang} />
                          <PhraseList overlaps={message.overlaps} title="Phrases still copied" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <p role="status" className="mt-2 text-sm font-semibold text-pass">
                      {message.text}
                    </p>
                  ))}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------
// The stateful view
// ---------------------------------------------------------------------------------------------------

export interface RewriteReviewProps {
  auditId: string;
  /** The version; the latest when not given. */
  version?: number;
  /** The page whose Sections are rewritten. */
  content: PageContent;
  /** The language of the new copy; the page's own when it is a listed language. */
  language?: DocumentLanguage;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
}

type Loaded = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded' };

/** Rewrite a page's Sections after approval (REQ-030). Mounted in the Website Audit result screen. */
export function RewriteReview({ auditId, version, content, language, fetchImpl }: RewriteReviewProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [rewrites, setRewrites] = useState<Record<string, RewriteState>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, RewriteBusy>>({});
  const [messages, setMessages] = useState<Record<string, RewriteMessage>>({});

  useEffect(() => {
    let live = true;
    setLoaded({ status: 'loading' });
    void listRewrites(auditId, version, fetchImpl).then((outcome) => {
      if (!live) return;
      if (outcome.ok) {
        const mine: Record<string, RewriteState> = {};
        for (const rewrite of outcome.value) if (rewrite.urlPath === content.urlPath) mine[rewrite.sectionId] = rewrite;
        setRewrites(mine);
        setLoaded({ status: 'loaded' });
      } else {
        setLoaded({ status: 'failed', message: outcome.message });
      }
    });
    return () => {
      live = false;
    };
  }, [auditId, version, content.urlPath, fetchImpl]);

  const target = (sectionId: string) => ({ urlPath: content.urlPath, sectionId, version });
  const writeLanguage =
    language ?? (isDocumentLanguage(content.language.primary) ? content.language.primary : undefined);

  const setFor = <T,>(
    set: (fn: (all: Record<string, T>) => Record<string, T>) => void,
    sectionId: string,
    value: T | undefined
  ) =>
    set((all) => {
      const next = { ...all };
      if (value === undefined) delete next[sectionId];
      else next[sectionId] = value;
      return next;
    });

  const approve = async (sectionId: string) => {
    setFor(setBusy, sectionId, 'approving');
    setFor<RewriteMessage>(setMessages, sectionId, undefined);
    const outcome = await approveRewrite(auditId, target(sectionId), fetchImpl);
    if (outcome.ok) setFor(setRewrites, sectionId, outcome.value);
    else setFor<RewriteMessage>(setMessages, sectionId, { tone: 'fail', text: outcome.message });
    setFor<RewriteBusy>(setBusy, sectionId, undefined);
  };

  const write = async (sectionId: string) => {
    const current = rewrites[sectionId];
    if (!current?.approvedAt) return;
    setFor(setBusy, sectionId, 'writing');
    setFor<RewriteMessage>(setMessages, sectionId, undefined);
    const outcome = await writeNewCopy(auditId, current, { ...target(sectionId), language: writeLanguage }, fetchImpl);
    if (outcome.ok) {
      setFor(setRewrites, sectionId, outcome.value);
      setFor<string>(setDrafts, sectionId, undefined);
    } else {
      setFor<RewriteMessage>(setMessages, sectionId, { tone: 'fail', text: outcome.message });
    }
    setFor<RewriteBusy>(setBusy, sectionId, undefined);
  };

  const accept = async (sectionId: string) => {
    const text = drafts[sectionId] ?? rewrites[sectionId]?.proposal?.text ?? '';
    setFor(setBusy, sectionId, 'accepting');
    setFor<RewriteMessage>(setMessages, sectionId, undefined);
    const outcome = await acceptNewCopy(auditId, { ...target(sectionId), text }, fetchImpl);
    if (outcome.ok) {
      setFor(setRewrites, sectionId, outcome.value);
      setFor<RewriteMessage>(setMessages, sectionId, {
        tone: 'pass',
        text: 'Accepted. The new copy is in the Audit Documents.',
      });
    } else {
      // The edited copy stays as typed, so the marked phrases can be reworded.
      setFor<string>(setDrafts, sectionId, text);
      setFor<RewriteMessage>(setMessages, sectionId, {
        tone: 'fail',
        text: outcome.message,
        overlaps: outcome.overlaps,
      });
    }
    setFor<RewriteBusy>(setBusy, sectionId, undefined);
  };

  if (loaded.status === 'loading') return <Spinner label="Loading the saved rewrites…" />;
  return (
    <div className="space-y-3">
      {loaded.status === 'failed' && <ErrorMessage>{loaded.message}</ErrorMessage>}
      <RewriteReviewView
        content={content}
        rewrites={rewrites}
        drafts={drafts}
        busy={busy}
        messages={messages}
        onApprove={(id) => void approve(id)}
        onWrite={(id) => void write(id)}
        onDraft={(id, text) => setFor<string>(setDrafts, id, text)}
        onAccept={(id) => void accept(id)}
      />
    </div>
  );
}
