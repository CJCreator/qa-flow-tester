import { Page, PageHeader } from '../components/ui';
import { useDocumentTitle } from '../lib/title';
import { PATHS } from '../lib/router';

/** Where a free Gemini key is made. */
export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey';

/** Plain-words steps for a first Check-up on the hosted copy. Exported so a test can read the words. */
export const STEPS: Array<{ title: string; text: string }> = [
  {
    title: 'Open the link you were sent',
    text: 'The first visit after a quiet spell can take up to a minute: Release check-up sleeps when nobody is using it. A “Waking up” screen shows while it starts. Keep the page open and it moves on by itself.',
  },
  {
    title: 'Sign in with Google',
    text: 'Any Google account works. It is how Release check-up knows which Check-ups, reports and limits are yours.',
  },
  {
    title: 'Paste your own AI key',
    text: 'Release check-up uses an AI to write your Plan, and it uses your key, never anyone else’s. Make a free Gemini key at Google AI Studio (see below), then paste it on the new Check-up screen or in Settings. Your key is kept in memory for your visit only, so you paste it again next time.',
  },
  {
    title: 'Enter your website address',
    text: 'Type the public address of your App’s website. Addresses on your own computer or a private network cannot be reached from here.',
  },
  {
    title: 'Review the Plan',
    text: 'Release check-up looks at your website and writes a Plan: the list of things it will test. Read it, change what you want, then approve it.',
  },
  {
    title: 'Start the Check-up',
    text: 'Only one Check-up runs at a time. If someone else is using it, you wait in a line and the page tells you your place.',
  },
  {
    title: 'Read the report',
    text: 'You get a plain-words verdict with the problems in priority order. Your reports are kept for 30 days, then deleted.',
  },
];

/**
 * The “Get started” page for testers of the hosted copy. It needs no connection to the QA Tool, so it opens
 * at once, even while the Check-up service is still waking up.
 */
export function GetStartedScreen() {
  useDocumentTitle('Get started');
  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-rule bg-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2 sm:px-6">
          <a href={PATHS.landing} className="inline-flex min-h-[44px] items-center font-bold text-ink">
            Release check-up
          </a>
          <a href={PATHS.new} className="btn-primary btn-sm">
            Start a Check-up
          </a>
        </div>
      </header>
      <main id="main">
        <Page width="prose">
          <PageHeader
            title="Get started with Release check-up"
            lede="You do not need a QA team. Follow these steps for your first Check-up: it tells you in plain words whether your website is ready to release."
          />

          <ol className="mb-10 list-decimal space-y-5 pl-6">
            {STEPS.map((step) => (
              <li key={step.title}>
                <p className="font-bold">{step.title}</p>
                <p className="mt-1 max-w-prose text-ink-soft">{step.text}</p>
              </li>
            ))}
          </ol>

          <h2 className="mb-2 text-xl font-bold">Where to get a free Gemini key</h2>
          <ol className="mb-10 list-decimal space-y-2 pl-6 text-ink-soft">
            <li>
              Open{' '}
              <a className="btn-link" href={GEMINI_KEY_URL} target="_blank" rel="noreferrer">
                Google AI Studio, API keys
              </a>{' '}
              and sign in with Google.
            </li>
            <li>Choose “Create API key”.</li>
            <li>Copy the key and paste it into Release check-up. Treat it like a password and do not share it.</li>
          </ol>

          <h2 className="mb-2 text-xl font-bold">Safe mode: what Release check-up does to your website</h2>
          <p className="mb-4 max-w-prose text-ink-soft">
            Out of the box it only looks. It reads pages and follows links, but it does not fill in or send forms, does
            not press Sensitive Actions such as Delete or Pay, and does not run Security Probes.
          </p>
          <p className="mb-10 max-w-prose text-ink-soft">
            Form, sign-in and security checks unlock only for a Verified Domain: you prove you control the website once
            by putting a small file on its exact address, and Release check-up looks for it. Then your Test Copies under
            that domain can be tested fully. The screen that starts a Check-up tells you what to put where.
          </p>

          <h2 className="mb-2 text-xl font-bold">Limits</h2>
          <ul className="mb-10 list-disc space-y-2 pl-6 text-ink-soft">
            <li>A few Check-ups per day for each Google account (5 unless the owner changes it).</li>
            <li>There is also a daily total for everyone, so on a busy day Check-ups may pause until tomorrow.</li>
            <li>One Check-up at a time; the others wait in line.</li>
            <li>Reports are kept for 30 days.</li>
            <li>Only check websites you own or have permission to check.</li>
          </ul>

          <a className="btn-primary" href={PATHS.new}>
            Start your first Check-up
          </a>
        </Page>
      </main>
    </div>
  );
}
