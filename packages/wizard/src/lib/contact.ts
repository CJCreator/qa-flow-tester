/** Contact and email-updates targets for the landing page (T-13). Public values set at build time. */

export const ISSUES_URL = 'https://github.com/CJCreator/qa-flow-tester/issues';

export interface ContactEnv {
  email?: string;
  signupUrl?: string;
}

export interface ContactLinks {
  contactHref: string;
  contactIsEmail: boolean;
  /** Form-post endpoint for the email control, or null (then the page offers a feedback link). */
  signupAction: string | null;
  feedbackHref: string;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function validEmail(raw?: string): string | null {
  const text = raw?.trim();
  if (!text || text.length > 254 || !EMAIL.test(text)) return null;
  return text;
}

function validSignupUrl(raw?: string): string | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function contactLinks(
  env: ContactEnv = {
    email: import.meta.env.VITE_CONTACT_EMAIL as string | undefined,
    signupUrl: import.meta.env.VITE_SIGNUP_URL as string | undefined,
  }
): ContactLinks {
  const email = validEmail(env.email);
  return {
    contactHref: email ? `mailto:${email}` : ISSUES_URL,
    contactIsEmail: email !== null,
    signupAction: validSignupUrl(env.signupUrl),
    feedbackHref: ISSUES_URL,
  };
}
