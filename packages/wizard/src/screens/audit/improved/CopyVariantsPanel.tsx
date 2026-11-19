import { useCallback, useEffect, useState } from 'react';
import type { AuditFinding, RewriteState } from '@qa/types/src/browser.js';
import { ErrorMessage, Spinner } from '../../../components/text';
import { loadVersion } from '../saved/saved-api';
import { acceptNewCopy, approveSections, listRewrites, writeDrafts, type Fetch } from '../ai/rewrite-api';

/** A Section linked to a top finding. */
export interface SuggestedSection {
  urlPath: string;
  sectionId: string;
  /** The findings that point at it. */
  findingIds: string[];
}

const keyOf = (s: { urlPath: string; sectionId: string }) => `${s.urlPath}\n${s.sectionId}`;

/** The Sections the top 10 findings point at, in finding order, each once. */
export function suggestedSections(findings: readonly AuditFinding[], top = 10): SuggestedSection[] {
  const out = new Map<string, SuggestedSection>();
  for (const f of findings.slice(0, top)) {
    if (!f.sectionId) continue;
    const key = keyOf({ urlPath: f.urlPath, sectionId: f.sectionId });
    const found = out.get(key);
    if (found) found.findingIds.push(f.id);
    else out.set(key, { urlPath: f.urlPath, sectionId: f.sectionId, findingIds: [f.id] });
  }
  return [...out.values()];
}

export interface CopyVariantsViewProps {
  sections: SuggestedSection[];
  rewrites: ReadonlyMap<string, RewriteState>;
  ticked: ReadonlySet<string>;
  busy: 'approving' | 'writing' | null;
  message: string | null;
  aiReady: boolean | null;
  onTick: (key: string) => void;
  onApprove: () => void;
  onWrite: () => void;
  onAccept: (section: SuggestedSection, text: string) => void;
}

/** Copy variants in batches (T-419), without state. */
export function CopyVariantsView(props: CopyVariantsViewProps) {
  const { sections, rewrites, ticked, busy } = props;
  const approved = sections.filter((s) => rewrites.get(keyOf(s))?.approvedAt);
  const tickedUnapproved = sections.filter((s) => ticked.has(keyOf(s)) && !rewrites.get(keyOf(s))?.approvedAt);
  const noKey = props.aiReady === false;
  return (
    <section aria-labelledby="copy-variants-title" className="card-1 bg-surface p-4">
      <h2 id="copy-variants-title" className="text-xl font-bold">
        New copy for the Sections behind the top findings
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        Tick the Sections, approve them, then the AI writes 2 drafts for each (one request per 5 Sections). A draft goes
        into the documents only when you accept it, and only once it repeats no phrase from the original.
      </p>
      {sections.length === 0 ? (
        <p className="mt-3 text-ink-soft">None of the top findings points at a Section.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {sections.map((s) => {
            const key = keyOf(s);
            const state = rewrites.get(key);
            const variants = state?.proposal?.variants ?? (state?.proposal ? [state.proposal] : []);
            return (
              <li key={key}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={ticked.has(key)}
                    disabled={!!state?.approvedAt}
                    onChange={() => props.onTick(key)}
                  />
                  <span>
                    <span className="font-semibold">{`${s.urlPath} · ${s.sectionId}`}</span>
                    <span className="block text-sm text-ink-soft">
                      {`${state?.approvedAt ? 'Approved' : 'Not approved'}; findings ${s.findingIds.join(', ')}`}
                    </span>
                  </span>
                </label>
                {variants.length > 0 && (
                  <ol className="mt-2 space-y-2 pl-6">
                    {variants.map((v, i) => (
                      <li key={i}>
                        <p className="whitespace-pre-wrap text-sm">{v.text}</p>
                        {v.overlaps.length > 0 && (
                          <p className="text-sm text-ink-soft">
                            {`Repeats ${v.overlaps.length} phrase(s) from the original: reword before accepting.`}
                          </p>
                        )}
                        <button type="button" className="btn-link btn-sm" onClick={() => props.onAccept(s, v.text)}>
                          {`Accept draft ${i + 1}`}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <button
          type="button"
          className="btn-quiet"
          disabled={busy !== null || tickedUnapproved.length === 0}
          onClick={props.onApprove}
        >
          {busy === 'approving' ? <Spinner label="Approving…" /> : 'Approve these Sections'}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== null || approved.length === 0 || noKey}
          aria-describedby="copy-variants-write-reason"
          onClick={props.onWrite}
        >
          {busy === 'writing' ? <Spinner label="Writing drafts…" /> : 'Write 2 drafts for each approved Section'}
        </button>
      </div>
      <p id="copy-variants-write-reason" className="mt-2 text-sm text-ink-soft">
        {noKey
          ? 'An AI key is needed to write drafts. Add one in Settings.'
          : approved.length === 0
            ? 'Approve at least one Section first.'
            : `${approved.length} approved Section(s): ${Math.ceil(approved.length / 5)} AI request(s).`}
      </p>
      {props.message && (
        <div className="mt-3">
          <ErrorMessage>{props.message}</ErrorMessage>
        </div>
      )}
    </section>
  );
}

export interface CopyVariantsPanelProps {
  auditId: string;
  version: number;
  aiReady: boolean | null;
  fetchImpl?: Fetch;
}

/** Loads the findings and rewrites of a version and drives the batch approval and drafts. */
export function CopyVariantsPanel({ auditId, version, aiReady, fetchImpl }: CopyVariantsPanelProps) {
  const [sections, setSections] = useState<SuggestedSection[] | null>(null);
  const [rewrites, setRewrites] = useState<Map<string, RewriteState>>(new Map());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'approving' | 'writing' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const merge = useCallback((list: RewriteState[]) => {
    setRewrites((current) => {
      const next = new Map(current);
      for (const r of list) next.set(keyOf(r), r);
      return next;
    });
  }, []);

  useEffect(() => {
    let live = true;
    setSections(null);
    setRewrites(new Map());
    void Promise.all([loadVersion(auditId, version, fetchImpl), listRewrites(auditId, version, fetchImpl)]).then(
      ([got, saved]) => {
        if (!live) return;
        const found = suggestedSections(got.ok ? (got.value.result?.findings ?? []) : []);
        setSections(found);
        setTicked(new Set(found.slice(0, 5).map(keyOf)));
        if (saved.ok) merge(saved.value);
      }
    );
    return () => {
      live = false;
    };
  }, [auditId, version, fetchImpl, merge]);

  if (sections === null) return <Spinner label="Loading the Sections…" />;

  const failuresText = (failures: Array<{ urlPath: string; sectionId: string; error: string }>) =>
    failures.length === 0 ? null : failures.map((f) => `${f.urlPath} · ${f.sectionId}: ${f.error}`).join(' ');

  const approve = async () => {
    setBusy('approving');
    setMessage(null);
    const chosen = sections.filter((s) => ticked.has(keyOf(s)));
    const got = await approveSections(
      auditId,
      { version, sections: chosen.map((s) => ({ urlPath: s.urlPath, sectionId: s.sectionId })) },
      fetchImpl
    );
    setBusy(null);
    if (!got.ok) return setMessage(got.message);
    merge(got.value.rewrites);
    setMessage(failuresText(got.value.failures));
  };

  const write = async () => {
    setBusy('writing');
    setMessage(null);
    const approved = sections.filter((s) => rewrites.get(keyOf(s))?.approvedAt);
    const got = await writeDrafts(
      auditId,
      { version, sections: approved.map((s) => ({ urlPath: s.urlPath, sectionId: s.sectionId })) },
      fetchImpl
    );
    setBusy(null);
    if (!got.ok) return setMessage(got.message);
    merge(got.value.rewrites);
    setMessage(failuresText(got.value.failures));
  };

  const accept = async (s: SuggestedSection, text: string) => {
    setMessage(null);
    const got = await acceptNewCopy(auditId, { urlPath: s.urlPath, sectionId: s.sectionId, version, text }, fetchImpl);
    if (!got.ok) return setMessage(got.message);
    merge([got.value]);
  };

  return (
    <CopyVariantsView
      sections={sections}
      rewrites={rewrites}
      ticked={ticked}
      busy={busy}
      message={message}
      aiReady={aiReady}
      onTick={(key) =>
        setTicked((current) => {
          const next = new Set(current);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        })
      }
      onApprove={() => void approve()}
      onWrite={() => void write()}
      onAccept={(s, text) => void accept(s, text)}
    />
  );
}
