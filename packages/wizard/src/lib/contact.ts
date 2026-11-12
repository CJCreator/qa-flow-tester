/** Contact targets for the landing page (T-13). Public values set at build time. */

/** The project's public repository. */
export const REPO_URL = 'https://github.com/CJCreator/qa-flow-tester';

export const ISSUES_URL = `${REPO_URL}/issues`;

export interface ContactEnv {
  email?: string;
}

export interface ContactLinks {
  contactHref: string;
  contactIsEmail: boolean;
  feedbackHref: string;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function validEmail(raw?: string): string | null {
  const text = raw?.trim();
  if (!text || text.length > 254 || !EMAIL.test(text)) return null;
  return text;
}

export function contactLinks(
  env: ContactEnv = {
    email: import.meta.env.VITE_CONTACT_EMAIL as string | undefined,
  }
): ContactLinks {
  const email = validEmail(env.email);
  return {
    contactHref: email ? `mailto:${email}` : ISSUES_URL,
    contactIsEmail: email !== null,
    feedbackHref: ISSUES_URL,
  };
}
