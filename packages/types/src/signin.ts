/** Why a sign-in test failed. Browser-safe: the runner and the wizard both import this. */
export const SIGN_IN_FAILURE_REASONS = ['wrong-details', 'no-form', 'unreachable', 'needs-more'] as const;

export type SignInFailureReason = (typeof SIGN_IN_FAILURE_REASONS)[number];

/** Fixed plain words per reason. Never built from typed details, so no credential can end up in them. */
export const SIGN_IN_REASON_TEXT: Record<SignInFailureReason, string> = {
  'wrong-details': 'The username or password was not accepted. Check them and try again.',
  'no-form': 'No sign-in form was found on that page. Check the sign-in page address.',
  unreachable: 'The site could not be reached, or took too long to answer. Check it is up and try again.',
  'needs-more':
    'This sign-in needs more than a password (a code, a CAPTCHA or a single sign-on). That is not supported yet.',
};

export function signInReasonText(reason: SignInFailureReason): string {
  return SIGN_IN_REASON_TEXT[reason];
}

export function isSignInFailureReason(value: unknown): value is SignInFailureReason {
  return typeof value === 'string' && (SIGN_IN_FAILURE_REASONS as readonly string[]).includes(value);
}
