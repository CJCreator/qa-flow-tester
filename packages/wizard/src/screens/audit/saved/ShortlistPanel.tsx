import { useEffect, useState } from 'react';
import { SHORTLIST_OUTCOMES, type ShortlistEntry, type ShortlistMark } from '@qa/types/src/browser.js';
import { formatWhen } from '../../../lib/format';
import {
  MARK_LABEL,
  SHORTLIST_MARKS,
  draftFromEntry,
  readOutcomeFilter,
  saveShortlistEntry,
  shortlistUpdate,
  type Fetch,
  type ShortlistDraft,
} from './saved-api';

export interface ShortlistPanelViewProps {
  /** The saved entry; null when this Website Audit has none yet. */
  saved: ShortlistEntry | null;
  draft: ShortlistDraft;
  saving: boolean;
  message: { tone: 'pass' | 'fail'; text: string } | null;
  onDraft: (draft: ShortlistDraft) => void;
  onSave: () => void;
}

const NO_MARK = 'none';

/** The saved values in words, so the person sees what is stored, not only what is typed. */
function savedLine(saved: ShortlistEntry | null): string {
  if (!saved) return 'Nothing saved yet.';
  const mark = saved.mark ? MARK_LABEL[saved.mark] : 'no mark';
  const outcome = saved.outcome ?? 'no outcome';
  return `Saved: ${mark}, ${outcome}. Last changed ${formatWhen(saved.updatedAt)}.`;
}

/** The mark, notes, outcome and outcome note of one Website Audit (REQ-023 AC-1, AC-2). */
export function ShortlistPanelView({ saved, draft, saving, message, onDraft, onSave }: ShortlistPanelViewProps) {
  const changed = Object.keys(shortlistUpdate(saved, draft)).length > 0;
  const marks: Array<ShortlistMark | typeof NO_MARK> = [...SHORTLIST_MARKS, NO_MARK];
  return (
    <section aria-labelledby="shortlist-panel-title" className="card-1 bg-surface p-4">
      <h2 id="shortlist-panel-title" className="text-xl font-bold">
        Shortlist
      </h2>
      <p className="text-sm text-ink-soft">
        Notes can hold the owner&apos;s personal details. Deleting the Website Audit deletes its Shortlist entry.
      </p>
      <p className="mt-2 text-sm text-ink">{savedLine(saved)}</p>

      <fieldset className="mt-4">
        <legend className="label text-ink">Mark</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {marks.map((mark) => {
            const id = `shortlist-mark-${mark}`;
            const value = mark === NO_MARK ? null : mark;
            return (
              <span
                key={mark}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-edge bg-surface pl-3 has-[:checked]:border-stamp has-[:checked]:bg-stamp-tint"
              >
                <input
                  id={id}
                  type="radio"
                  name="shortlist-mark"
                  value={mark}
                  className="h-5 w-5 accent-stamp"
                  checked={draft.mark === value}
                  onChange={() => onDraft({ ...draft, mark: value })}
                />
                <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-center pr-4">
                  {mark === NO_MARK ? 'No mark' : MARK_LABEL[mark]}
                </label>
              </span>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor="shortlist-notes" className="label text-ink">
          Notes
        </label>
        <textarea
          id="shortlist-notes"
          rows={4}
          className="field w-full text-sm"
          value={draft.notes}
          onChange={(e) => onDraft({ ...draft, notes: e.target.value })}
        />
      </div>

      <div className="mt-4">
        <label htmlFor="shortlist-outcome" className="label text-ink">
          Outcome
        </label>
        <select
          id="shortlist-outcome"
          className="field min-h-[44px] py-2 text-sm"
          value={draft.outcome ?? ''}
          onChange={(e) => {
            const outcome = readOutcomeFilter(e.target.value);
            onDraft({ ...draft, outcome: outcome === 'all' ? null : outcome });
          }}
        >
          <option value="">No outcome yet</option>
          {SHORTLIST_OUTCOMES.map((outcome) => (
            <option key={outcome} value={outcome}>
              {outcome}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <label htmlFor="shortlist-outcome-note" className="label text-ink">
          Outcome note
        </label>
        <textarea
          id="shortlist-outcome-note"
          rows={2}
          className="field w-full text-sm"
          value={draft.outcomeNote}
          onChange={(e) => onDraft({ ...draft, outcomeNote: e.target.value })}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-quiet btn-sm" disabled={!changed || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save the Shortlist entry'}
        </button>
        {message && (
          <p
            role={message.tone === 'fail' ? 'alert' : 'status'}
            className={`text-sm ${message.tone === 'fail' ? 'text-fail' : 'text-pass'}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}

export interface ShortlistPanelProps {
  auditId: string;
  /** The entry as the Website Audit's summary has it. */
  entry: ShortlistEntry | null;
  /** Called with the saved entry, so the screen around the panel shows the new mark. */
  onSaved?: (entry: ShortlistEntry) => void;
  /** For tests; the browser's fetch otherwise. */
  fetchImpl?: Fetch;
}

/** Saves through `PUT /api/audits/:id/shortlist` and shows the values the runner saved (REQ-023). */
export function ShortlistPanel({ auditId, entry, onSaved, fetchImpl }: ShortlistPanelProps) {
  const [saved, setSaved] = useState<ShortlistEntry | null>(entry);
  const [draft, setDraft] = useState<ShortlistDraft>(() => draftFromEntry(entry));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<ShortlistPanelViewProps['message']>(null);

  useEffect(() => {
    setSaved(entry);
    setDraft(draftFromEntry(entry));
  }, [entry]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    const outcome = await saveShortlistEntry(auditId, shortlistUpdate(saved, draft), fetchImpl);
    if (outcome.ok) {
      setSaved(outcome.value);
      setDraft(draftFromEntry(outcome.value));
      setMessage({ tone: 'pass', text: 'Shortlist entry saved.' });
      onSaved?.(outcome.value);
    } else {
      setMessage({ tone: 'fail', text: outcome.message });
    }
    setSaving(false);
  };

  return (
    <ShortlistPanelView
      saved={saved}
      draft={draft}
      saving={saving}
      message={message}
      onDraft={(next) => {
        setDraft(next);
        setMessage(null);
      }}
      onSave={() => void save()}
    />
  );
}
