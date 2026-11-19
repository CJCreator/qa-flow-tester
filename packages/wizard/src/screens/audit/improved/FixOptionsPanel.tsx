import { useEffect, useState } from 'react';
import { AUDIT_API, auditPath, type AuditFinding, type FixOptionsReply } from '@qa/types/src/browser.js';
// A leaf module with type-only imports: rule text only, no Node code.
import {
  DECIDED_BY_RULE,
  ruleFixOptions,
  topFindingsForOptions,
  type FixOption,
} from '@qa/core/src/audit/improve/fix-rules.js';
import { Spinner } from '../../../components/text';
import { loadVersion } from '../saved/saved-api';
import type { Fetch } from '../saved/share-api';

const EFFORT_LABEL: Record<FixOption['effort'], string> = { S: 'small', M: 'medium', L: 'large' };

export interface FixOptionsViewProps {
  /** The version's findings, ranked (the order the version stores them in). */
  findings: readonly AuditFinding[];
  /** By finding id; default the rule options. */
  options?: ReadonlyMap<string, readonly FixOption[]>;
}

/** Fix options for the top 10 findings (T-417), without state. */
export function FixOptionsView({ findings, options }: FixOptionsViewProps) {
  const top = topFindingsForOptions(findings);
  const byFinding = options ?? ruleFixOptions(top);
  return (
    <section aria-labelledby="fix-options-title" className="card-1 bg-surface p-4">
      <h2 id="fix-options-title" className="text-xl font-bold">
        Ways to fix the top findings
      </h2>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">
        Two or three ways to fix each of the top findings, each with its effort and what it costs you. Options marked “
        {DECIDED_BY_RULE}” are fixed text that needs no AI key.
      </p>
      {top.length === 0 ? (
        <p className="mt-3 text-ink-soft">This version has no findings.</p>
      ) : (
        <ol className="mt-4 space-y-4">
          {top.map((finding) => (
            <li key={finding.id}>
              <p className="font-semibold">{`${finding.id}: ${finding.title}`}</p>
              <p className="text-sm text-ink-soft">{finding.urlPath}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {(byFinding.get(finding.id) ?? []).map((opt) => (
                  <li key={opt.id}>
                    <span className="font-semibold">{opt.title}</span>
                    {` (${opt.source === 'rule' ? DECIDED_BY_RULE : 'AI suggestion'}, ${EFFORT_LABEL[opt.effort]} effort): ${opt.tradeOff}`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The runner's options (AI ones when a key worked), or null: the screen then shows the rule options. */
async function loadFixOptions(
  auditId: string,
  version: number,
  fetchImpl: Fetch | undefined
): Promise<Map<string, FixOption[]> | null> {
  const doFetch: Fetch = fetchImpl ?? ((input, init) => fetch(input, init));
  try {
    const res = await doFetch(`${auditPath(AUDIT_API.fixOptions.path, { id: auditId })}?version=${version}`, {
      method: 'GET',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<FixOptionsReply> | null;
    if (!body || typeof body.options !== 'object' || body.options === null) return null;
    return new Map(Object.entries(body.options)) as Map<string, FixOption[]>;
  } catch {
    return null;
  }
}

/** Loads the version's findings and shows their fix options. */
export function FixOptionsPanel({
  auditId,
  version,
  fetchImpl,
}: {
  auditId: string;
  version: number;
  fetchImpl?: Fetch;
}) {
  const [findings, setFindings] = useState<AuditFinding[] | null>(null);
  const [options, setOptions] = useState<Map<string, FixOption[]> | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setFindings(null);
    setOptions(undefined);
    void Promise.all([loadVersion(auditId, version, fetchImpl), loadFixOptions(auditId, version, fetchImpl)]).then(
      ([got, fromRunner]) => {
        if (!live) return;
        setOptions(fromRunner ?? undefined);
        setFindings(got.ok ? (got.value.result?.findings ?? []) : []);
      }
    );
    return () => {
      live = false;
    };
  }, [auditId, version, fetchImpl]);
  if (findings === null) return <Spinner label="Loading the findings…" />;
  return <FixOptionsView findings={findings} options={options} />;
}
