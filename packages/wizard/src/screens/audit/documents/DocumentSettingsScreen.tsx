import { useEffect, useState, type ReactNode } from 'react';
import type { AuditSettingsReply, AuditSettingsUpdate, CompanyDetails } from '@qa/types/src/browser.js';
import { useConfirm } from '../../../components/ConfirmDialog';
import { Spinner } from '../../../components/text';
import { BottomActionBar, LoadError, Page, PageHeader } from '../../../components/ui';
import { PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import {
  COMPANY_FIELDS,
  MAX_REWRITE_OVERLAP_WORDS,
  overlapWordsValue,
  removePagespeedKey,
  OPT_OUT_LANGUAGES,
  PROPOSAL_PLACEHOLDERS,
  draftFrom,
  isUpdateEmpty,
  loadSettings,
  resetOptOutText,
  resetProposalTemplate,
  saveSettings,
  settingsUpdate,
  type Fetch,
  type OptOutLanguage,
  type SettingsDraft,
} from './settings-api';

const LANGUAGE_LABEL: Readonly<Record<OptOutLanguage, string>> = { en: 'English', ta: 'Tamil' };

const COMPANY_LABEL: Readonly<Record<keyof CompanyDetails, string>> = {
  name: 'Company name',
  address: 'Address',
  phone: 'Phone',
  email: 'Email address',
  website: 'Website',
  terms: 'Terms and conditions',
};

const COMPANY_INPUT_TYPE: Partial<Record<keyof CompanyDetails, string>> = {
  phone: 'tel',
  email: 'email',
  website: 'url',
};
const COMPANY_MULTILINE: ReadonlySet<keyof CompanyDetails> = new Set(['address', 'terms']);

export type SettingsMessage = { tone: 'pass' | 'fail'; text: string } | null;

export interface DocumentSettingsViewProps {
  reply: AuditSettingsReply;
  draft: SettingsDraft;
  saving: boolean;
  message: SettingsMessage;
  onDraft: (draft: SettingsDraft) => void;
  onSave: () => void;
  onDiscard: () => void;
  /** Saves a "put the default back" change at once. */
  onReset: (update: AuditSettingsUpdate) => void;
}

/** The document settings without state: Proposal template, opt-out text per language, company details. */
export function DocumentSettingsView({
  reply,
  draft,
  saving,
  message,
  onDraft,
  onSave,
  onDiscard,
  onReset,
}: DocumentSettingsViewProps) {
  const pending = !isUpdateEmpty(settingsUpdate(reply, draft));
  const { confirm, dialog } = useConfirm();
  /** Put-the-default-back and remove save at once, so they ask first. */
  const ask = async (what: string, body: string, update: AuditSettingsUpdate) => {
    const yes = await confirm({
      title: what === '' ? 'Remove the PageSpeed key?' : `Put ${what} back?`,
      body,
      confirmLabel: what === '' ? 'Remove the key' : 'Put the default back',
      danger: true,
    });
    if (yes) onReset(update);
  };
  const discard = async () => {
    const yes = await confirm({
      title: 'Discard your changes?',
      body: 'Every edit you have not saved is thrown away. Saved settings stay.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true,
    });
    if (yes) onDiscard();
  };
  return (
    <div className="space-y-10">
      <h2 id="settings-documents-title" className="-mb-4 text-xl font-bold">
        Audit Documents
      </h2>

      <section aria-labelledby="settings-proposal-title" className="space-y-3">
        <h3 id="settings-proposal-title" className="text-lg font-bold">
          Proposal template
        </h3>
        <p className="max-w-prose text-sm text-ink-soft">
          Every Proposal is filled from this Markdown template. Write a placeholder in double braces, such as{' '}
          <code>{'{{price}}'}</code>, where its value goes.
        </p>
        <div>
          <label htmlFor="settings-proposal-template" className="label text-ink">
            Proposal template (Markdown)
          </label>
          <textarea
            id="settings-proposal-template"
            rows={16}
            className="field w-full font-mono"
            value={draft.proposalTemplate}
            onChange={(e) => onDraft({ ...draft, proposalTemplate: e.target.value })}
          />
        </div>
        <button
          type="button"
          className="btn-quiet btn-sm"
          disabled={saving}
          aria-label="Put the default Proposal template back"
          onClick={() =>
            void ask(
              'the default Proposal template',
              'Your own template is replaced and this saves at once.',
              resetProposalTemplate()
            )
          }
        >
          Put the default back
        </button>
        <h4 id="settings-placeholders-title" className="font-bold">
          Placeholders you can use
        </h4>
        <dl
          aria-labelledby="settings-placeholders-title"
          className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]"
        >
          {PROPOSAL_PLACEHOLDERS.map((p) => (
            <div key={p.name} className="contents">
              <dt>
                <code>{`{{${p.name}}}`}</code>
              </dt>
              <dd className="text-ink-soft">{p.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="settings-optout-title" className="space-y-3">
        <h3 id="settings-optout-title" className="text-lg font-bold">
          Opt-out text
        </h3>
        <p className="max-w-prose text-sm text-ink-soft">
          The Pitch Glimpse ends with this text, in its language. The tool ships default text in English and Tamil as a
          starting point. You own checking it: make sure it is right and true for you before you hand a Pitch Glimpse
          over.
        </p>
        {OPT_OUT_LANGUAGES.map((language) => {
          const id = `settings-optout-${language}`;
          const fallback = reply.defaults.optOutText[language] ?? '';
          return (
            <div key={language} className="rounded-card border border-rule p-3" data-language={language}>
              <label htmlFor={id} className="label text-ink">
                {`Opt-out text in ${LANGUAGE_LABEL[language]}`}
              </label>
              <textarea
                id={id}
                rows={4}
                lang={language}
                className="field w-full"
                value={draft.optOutText[language]}
                onChange={(e) => onDraft({ ...draft, optOutText: { ...draft.optOutText, [language]: e.target.value } })}
              />
              <p className="label mt-2 text-ink">{`Default text in ${LANGUAGE_LABEL[language]}`}</p>
              <p className="whitespace-pre-wrap text-sm text-ink-soft" lang={language}>
                {fallback === '' ? 'The tool has no default text for this language.' : fallback}
              </p>
              <button
                type="button"
                className="btn-quiet btn-sm mt-2"
                disabled={saving}
                aria-label={`Put the default ${LANGUAGE_LABEL[language]} opt-out text back`}
                onClick={() =>
                  void ask(
                    `the default ${LANGUAGE_LABEL[language]} opt-out text`,
                    'Your own text is replaced and this saves at once.',
                    resetOptOutText(language)
                  )
                }
              >
                Put the default back
              </button>
            </div>
          );
        })}
      </section>

      <section aria-labelledby="settings-company-title" className="space-y-3">
        <h3 id="settings-company-title" className="text-lg font-bold">
          Company details
        </h3>
        <p className="max-w-prose text-sm text-ink-soft">Saved once and put in every Proposal.</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {COMPANY_FIELDS.map((field) => {
            const id = `settings-company-${field}`;
            const onChange = (value: string) => onDraft({ ...draft, company: { ...draft.company, [field]: value } });
            return (
              <div key={field} className={COMPANY_MULTILINE.has(field) ? 'md:col-span-2' : undefined}>
                <label htmlFor={id} className="label text-ink">
                  {COMPANY_LABEL[field]}
                </label>
                {COMPANY_MULTILINE.has(field) ? (
                  <textarea
                    id={id}
                    rows={field === 'terms' ? 6 : 3}
                    className="field w-full"
                    value={draft.company[field]}
                    onChange={(e) => onChange(e.target.value)}
                  />
                ) : (
                  <input
                    id={id}
                    type={COMPANY_INPUT_TYPE[field] ?? 'text'}
                    className="field w-full"
                    value={draft.company[field]}
                    onChange={(e) => onChange(e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="settings-rewrite-title" className="space-y-3">
        <h2 id="settings-rewrite-title" className="text-xl font-bold">
          Section rewrite
        </h2>
        <div>
          <label htmlFor="settings-rewrite-overlap" className="label text-ink">
            Copied phrase length (words)
          </label>
          <input
            id="settings-rewrite-overlap"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_REWRITE_OVERLAP_WORDS}
            className="field w-32"
            aria-describedby="settings-rewrite-overlap-hint"
            value={draft.rewriteOverlapWords}
            onChange={(e) => onDraft({ ...draft, rewriteOverlapWords: e.target.value })}
          />
          <p id="settings-rewrite-overlap-hint" className="mt-1 max-w-prose text-sm text-ink-soft">
            {`New copy that repeats this many words in a row from the original cannot be accepted. Default ${reply.defaults.rewriteOverlapWords}.`}
          </p>
          {overlapWordsValue(draft.rewriteOverlapWords) === null && (
            <p role="alert" className="mt-1 text-sm font-semibold text-fail">
              {`Enter a whole number from 1 to ${MAX_REWRITE_OVERLAP_WORDS}.`}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="settings-pagespeed-title" className="space-y-3">
        <h2 id="settings-pagespeed-title" className="text-xl font-bold">
          PageSpeed key
        </h2>
        <p className="max-w-prose text-sm text-ink-soft">
          Used to measure speed in a Website Audit. The key is kept with your AI keys and never shown again.
        </p>
        <p
          className="text-sm font-semibold"
          data-pagespeed-key={reply.settings.pagespeedKeySaved ? 'saved' : 'not-saved'}
        >
          {reply.settings.pagespeedKeySaved ? 'A PageSpeed key is saved.' : 'No PageSpeed key is saved.'}
        </p>
        <div>
          <label htmlFor="settings-pagespeed-key" className="label text-ink">
            {reply.settings.pagespeedKeySaved ? 'Replace the PageSpeed key' : 'PageSpeed key'}
          </label>
          <input
            id="settings-pagespeed-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="field w-full max-w-md"
            value={draft.pagespeedKey}
            onChange={(e) => onDraft({ ...draft, pagespeedKey: e.target.value })}
          />
        </div>
        {reply.settings.pagespeedKeySaved && (
          <button
            type="button"
            className="btn-quiet btn-sm"
            disabled={saving}
            aria-label="Remove the saved PageSpeed key"
            onClick={() =>
              void ask('', 'The saved PageSpeed key is deleted and this saves at once.', removePagespeedKey())
            }
          >
            Remove the key
          </button>
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
        <button type="button" className="btn-quiet" disabled={!pending || saving} onClick={() => void discard()}>
          Discard changes
        </button>
        <button type="button" className="btn-primary" disabled={!pending || saving} onClick={onSave}>
          {saving ? <Spinner label="Saving…" announce={false} /> : 'Save document settings'}
        </button>
      </BottomActionBar>
      {dialog}
    </div>
  );
}

export interface DocumentSettingsScreenProps {
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** More settings shown below, inside the same page column (the AI models panel). */
  children?: ReactNode;
}

type Loaded =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; reply: AuditSettingsReply };

/** Edit the Proposal template, the opt-out text and the company details (REQ-027, REQ-019, REQ-018). */
export function DocumentSettingsScreen({ fetchImpl, children }: DocumentSettingsScreenProps) {
  useDocumentTitle('Audit settings');
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<SettingsMessage>(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoaded({ status: 'loading' });
    void loadSettings(fetchImpl).then((outcome) => {
      if (!live) return;
      if (outcome.ok) {
        setLoaded({ status: 'loaded', reply: outcome.value });
        setDraft(draftFrom(outcome.value));
      } else {
        setLoaded({ status: 'failed', message: outcome.message });
      }
    });
    return () => {
      live = false;
    };
  }, [fetchImpl, attempt]);

  const reply = loaded.status === 'loaded' ? loaded.reply : null;

  const save = async (update: AuditSettingsUpdate, keepOtherChanges: boolean) => {
    setSaving(true);
    setMessage(null);
    const outcome = await saveSettings(update, fetchImpl);
    if (outcome.ok) {
      const fresh = draftFrom(outcome.value);
      setLoaded({ status: 'loaded', reply: outcome.value });
      setDraft((current) => {
        if (!keepOtherChanges || !current) return fresh;
        // A "put the default back" saves one field: the other unsaved changes stay in the fields.
        return {
          ...current,
          ...(update.proposalTemplate !== undefined ? { proposalTemplate: fresh.proposalTemplate } : {}),
          ...(update.pagespeedKey !== undefined ? { pagespeedKey: '' } : {}),
          optOutText: {
            en: update.optOutText?.en !== undefined ? fresh.optOutText.en : current.optOutText.en,
            ta: update.optOutText?.ta !== undefined ? fresh.optOutText.ta : current.optOutText.ta,
          },
        };
      });
      setMessage({ tone: 'pass', text: 'Document settings saved. New exports use them.' });
    } else {
      setMessage({ tone: 'fail', text: outcome.message });
    }
    setSaving(false);
  };

  return (
    <Page width="form">
      <PageHeader
        back={{ to: PATHS.audits, label: 'All Website Audits' }}
        title="Audit settings"
        lede="The Proposal template, the opt-out text of the Pitch Glimpse, your company details and the keys used by every Website Audit you run or download."
      />
      {loaded.status === 'loading' && <Spinner label="Loading the document settings…" />}
      {loaded.status === 'failed' && (
        <LoadError title="The settings could not be loaded" onRetry={() => setAttempt((n) => n + 1)}>
          {loaded.message}
        </LoadError>
      )}
      {reply && draft && (
        <DocumentSettingsView
          reply={reply}
          draft={draft}
          saving={saving}
          message={message}
          onDraft={(next) => {
            setDraft(next);
            setMessage(null);
          }}
          onSave={() => void save(settingsUpdate(reply, draft), false)}
          onDiscard={() => {
            setDraft(draftFrom(reply));
            setMessage(null);
          }}
          onReset={(update) => void save(update, true)}
        />
      )}
      {children && <div className="mt-14">{children}</div>}
    </Page>
  );
}
