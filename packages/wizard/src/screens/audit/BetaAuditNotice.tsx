import { Notice } from '../../components/text';
import { Page, PageHeader } from '../../components/ui';
import { REPO_URL } from '../../lib/contact';
import { Link, PATHS, type Route } from '../../lib/router';

type Name = Route['name'];

/** Every Website Audit route, the sign-in for Helpers included. */
export const AUDIT_ROUTE_NAMES: readonly Name[] = [
  'audit-new',
  'audits',
  'audit',
  'audit-version',
  'audit-review',
  'audit-export',
  'audit-share',
  'audit-helpers',
  'audit-settings',
  'audit-shortlist',
  'helper-sign-in',
];

/** The routes only the owner of a copy can use: starting, listing, settings, Shortlist, Shared Links, Helpers. */
const OWNER_ONLY: readonly Name[] = [
  'audit-new',
  'audits',
  'audit-settings',
  'audit-shortlist',
  'audit-share',
  'audit-helpers',
];

/**
 * Whether the shared (beta) copy shows the notice instead of this screen. A signed-in Helper still opens the
 * Website Audits given to them; everyone else on the shared copy gets the notice on every audit screen
 * except the Helper sign-in.
 */
export function showsBetaAuditNotice(name: Name, beta: boolean, helper: boolean): boolean {
  if (!beta || name === 'helper-sign-in' || !AUDIT_ROUTE_NAMES.includes(name)) return false;
  return helper ? OWNER_ONLY.includes(name) : true;
}

export function BetaAuditNotice() {
  return (
    <Page width="prose">
      <PageHeader
        title="Website Audits run on your own copy of Release check-up"
        actions={
          <Link to={PATHS.new} className="btn-primary">
            Start a check-up
          </Link>
        }
      />
      <Notice tone="stamp" title="This shared copy has no Website Audits of its own">
        This shared copy opens Shared Links and Website Audits given to a Helper, and it runs check-ups. To run Website
        Audits, run your own copy of Release check-up. The steps for hosting it are in{' '}
        <a
          href={`${REPO_URL}/blob/main/docs/DEPLOYMENT.md`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-link"
        >
          docs/DEPLOYMENT.md
        </a>
        .
      </Notice>
    </Page>
  );
}
