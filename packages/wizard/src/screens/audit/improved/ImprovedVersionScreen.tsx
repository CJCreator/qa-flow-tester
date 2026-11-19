import { useCallback, useEffect, useState } from 'react';
import type { AuditVersion } from '@qa/types/src/browser.js';
import { getAiSetup } from '../../../api';
import { ErrorMessage, Notice, Spinner } from '../../../components/text';
import { LoadError, Page, PageHeader } from '../../../components/ui';
import { formatWhen } from '../../../lib/format';
import { Link, PATHS } from '../../../lib/router';
import { useDocumentTitle } from '../../../lib/title';
import { AuditTabs } from '../AuditTabs';
import { CompetitorsPanel } from './CompetitorsPanel';
import { loadVersion, versionsOldestFirst } from '../saved/saved-api';
import {
  SHARE_LANGUAGES,
  createPreview,
  languageName,
  previewUrl,
  type Fetch,
  type ShareLanguage,
} from '../saved/share-api';

/** The Improved version panel: idle, being written, written, or refused. */
export type PreviewState =
  | { status: 'idle' }
  | { status: 'making' }
  | { status: 'made'; createdAt: string }
  | { status: 'failed'; message: string; noAiKey: boolean };

/** Why the make button is disabled when no AI key works (W20). */
export const NO_AI_KEY_REASON = 'An AI key is needed to make the Improved version. Add one in Settings.';

export interface ImprovedVersionViewProps {
  auditId: string;
  /** Finished versions, oldest first. */
  versions: AuditVersion[];
  version: number;
  language: ShareLanguage;
  preview: PreviewState;
  /** Whether a working AI key is set up; null while unknown. */
  aiReady: boolean | null;
  onVersion: (version: number) => void;
  onLanguage: (language: ShareLanguage) => void;
  onMake: () => void;
}

function readLanguage(value: string): ShareLanguage {
  return (SHARE_LANGUAGES as readonly string[]).includes(value) ? (value as ShareLanguage) : 'en';
}

/** The Improved version panel, without state. */
export function ImprovedVersionView(props: ImprovedVersionViewProps) {
  const { auditId, versions, version, preview, aiReady } = props;
  if (versions.length === 0) {
    return (
      <p className="max-w-prose text-ink-soft">
        This Website Audit has no finished version yet. Come back when a version has finished.
      </p>
    );
  }
  const noKey = aiReady === false;
  const making = preview.status === 'making';
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="improved-version" className="label text-ink">
            Version
          </label>
          <select
            id="improved-version"
            className="field mt-1"
            value={String(version)}
            onChange={(e) => props.onVersion(Number(e.target.value))}
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {`Version ${v.version}, ${formatWhen(v.startedAt)}`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="improved-language" className="label text-ink">
            Language
          </label>
          <select
            id="improved-language"
            className="field mt-1"
            value={props.language}
            onChange={(e) => props.onLanguage(readLanguage(e.target.value))}
          >
            {SHARE_LANGUAGES.map((language) => (
              <option key={language} value={language}>
                {languageName(language)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section aria-labelledby="improved-title" className="card-1 bg-surface p-4">
        <h2 id="improved-title" className="text-xl font-bold">
          Improved homepage
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-soft">
          The AI writes an improved homepage from this version's findings. It is a suggestion for the site owner:
          nothing on the live site changes.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <button
            type="button"
            className="btn-primary"
            disabled={noKey || making}
            aria-describedby={noKey ? 'improved-make-reason' : undefined}
            onClick={props.onMake}
          >
            {making ? <Spinner label="Making the Improved version…" /> : 'Make the Improved version'}
          </button>
          {/* Always a link: a page made in an earlier visit can still be opened. */}
          <a
            href={previewUrl(auditId, version)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-quiet"
            aria-label={`Open the Improved version of version ${version} (opens in a new tab)`}
            aria-describedby={preview.status !== 'made' ? 'improved-open-reason' : undefined}
          >
            Open it
          </a>
        </div>
        {noKey && (
          <p id="improved-make-reason" className="mt-2 text-sm text-ink-soft">
            {NO_AI_KEY_REASON}{' '}
            <Link to={PATHS.settings} className="btn-link">
              Open Settings
            </Link>
          </p>
        )}
        {preview.status !== 'made' && (
          <p id="improved-open-reason" className="mt-2 text-sm text-ink-soft">
            Opens the last one made for this version. If there isn’t one yet, make it first.
          </p>
        )}
        {preview.status === 'made' && (
          <p role="status" className="mt-3 text-sm font-semibold text-pass">
            {`The Improved version is ready (${formatWhen(preview.createdAt)}). Open it to check it.`}
          </p>
        )}
        {preview.status === 'failed' && (
          <div className="mt-3">
            {preview.noAiKey ? (
              <Notice
                title="An AI key is needed"
                actions={
                  <Link to={PATHS.settings} className="btn-link">
                    Add an AI key in Settings
                  </Link>
                }
              >
                {preview.message}
              </Notice>
            ) : (
              <ErrorMessage>{preview.message}</ErrorMessage>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export interface ImprovedVersionScreenProps {
  auditId: string;
  /** For tests: the requests. */
  fetchImpl?: Fetch;
  /** For tests: whether an AI key is set up. */
  aiSetup?: () => Promise<{ configured: boolean }>;
}

type Versions =
  { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; versions: AuditVersion[] };

/** The Improved version of a Website Audit (ADR 0049): the AI-written improved pages of one version. */
export function ImprovedVersionScreen({ auditId, fetchImpl, aiSetup = getAiSetup }: ImprovedVersionScreenProps) {
  const [versions, setVersions] = useState<Versions>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const [language, setLanguage] = useState<ShareLanguage>('en');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle('Improved version');

  useEffect(() => {
    let live = true;
    setVersions({ status: 'loading' });
    void loadVersion(auditId, undefined, fetchImpl).then((loaded) => {
      if (!live) return;
      if (!loaded.ok) return setVersions({ status: 'failed', message: loaded.message });
      const done = versionsOldestFirst(loaded.value.summary).filter((v) => v.status === 'done');
      setVersions({ status: 'loaded', versions: done });
      setVersion((current) =>
        done.some((v) => v.version === current) ? current : (done[done.length - 1]?.version ?? 0)
      );
    });
    return () => {
      live = false;
    };
  }, [auditId, fetchImpl, attempt]);

  // Unknown (a failed read) leaves the button on: the runner answers with its own reason.
  useEffect(() => {
    let live = true;
    void aiSetup().then(
      (setup) => live && setAiReady(setup.configured),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [aiSetup]);

  const make = useCallback(async () => {
    setPreview({ status: 'making' });
    const outcome = await createPreview(auditId, version, language, fetchImpl);
    setPreview(
      outcome.ok
        ? { status: 'made', createdAt: outcome.value.createdAt }
        : { status: 'failed', message: outcome.message, noAiKey: outcome.code === 'ERR_NO_AI_KEY' }
    );
  }, [auditId, version, language, fetchImpl]);

  return (
    <Page width="workspace">
      <PageHeader
        back={{ to: PATHS.audit(auditId), label: 'Back to this Website Audit' }}
        title="Improved version"
        lede="AI-written improvements of this Website Audit's pages, each citing the findings it answers. A suggestion for the site owner: the live site never changes."
      />
      <AuditTabs
        auditId={auditId}
        version={version > 0 ? version : undefined}
        current="improved"
        hide={['share', 'helpers']}
      />
      {versions.status === 'loading' && <Spinner label="Loading the Website Audit…" />}
      {versions.status === 'failed' && (
        <LoadError title="The Website Audit could not be loaded" onRetry={() => setAttempt((n) => n + 1)}>
          {versions.message}
        </LoadError>
      )}
      {versions.status === 'loaded' && (
        <ImprovedVersionView
          auditId={auditId}
          versions={versions.versions}
          version={version}
          language={language}
          preview={preview}
          aiReady={aiReady}
          onVersion={(next) => {
            setVersion(next);
            setPreview({ status: 'idle' });
          }}
          onLanguage={setLanguage}
          onMake={() => void make()}
        />
      )}
      {versions.status === 'loaded' && version > 0 && (
        <div className="mt-10">
          <CompetitorsPanel auditId={auditId} version={version} aiReady={aiReady} fetchImpl={fetchImpl} />
        </div>
      )}
    </Page>
  );
}
