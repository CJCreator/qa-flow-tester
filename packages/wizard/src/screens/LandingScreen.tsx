import type { ReactNode } from 'react';
import { HOME_FAQ, HOME_STEPS } from '../lib/faq';
import { Mark } from '../components/TopBar';
import { WakeNote } from '../components/WakeNote';
import { useWakeOnline } from '../hooks/useWakeOnline';
import { startAddress } from '../lib/online';
import { LANDING_TITLE, useDocumentTitle } from '../lib/title';

export const REPO_URL = 'https://github.com/CJCreator/qa-flow-tester';
export const SAMPLE_REPORT_URL = '/sample-report.html';

const AREAS: Array<{ name: string; text: string }> = [
  { name: 'It works', text: 'Sign-ups, forms and the journeys people take across pages.' },
  { name: 'Everyone can use it', text: 'Contrast, labels, keyboard use and structure.' },
  { name: 'It’s fast enough', text: 'Load timing and heavy pages.' },
  { name: 'Risky patterns', text: 'Exposed secrets, missing protections and risky patterns we can spot.' },
  { name: 'People can find it', text: 'Titles, descriptions, sitemaps and structured data.' },
  { name: 'AI assistants can read it', text: 'Question-style headings, llms.txt and crawler access.' },
];

const PROMISES: Array<{ title: string; text: string }> = [
  { title: 'Looks, never touches', text: 'On a live site nothing is filled in, sent or changed.' },
  { title: 'You approve every test', text: 'Nothing is tested until you have read and approved the plan.' },
  { title: 'Test copies only for forms', text: 'Filling in and sending forms is for a test copy of your site, and only if you choose it.' },
];

/**
 * The primary action, to the app's new check-up screen wherever it is served from. A plain link on
 * purpose: the landing page can be shown without the app's code (see main.tsx), so leaving it is a
 * page load, and that is when the app's code is fetched.
 */
function StartButton({ className, children }: { className: string; children: ReactNode }) {
  return (
    <a href={startAddress()} className={className}>
      {children}
    </a>
  );
}

/** The real sample report in a browser-style frame. Not a mock-up: the report shows its own verdict stamp. */
function SampleReportFrame() {
  return (
    <figure>
      <div className="overflow-hidden rounded-panel border border-rule bg-canvas shadow-level-3">
        <div className="flex items-center gap-2 border-b border-rule bg-panel px-4 py-2 font-mono text-xs text-ink-soft">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-edge" />
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-edge" />
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-edge" />
          <span className="ml-2">Example report</span>
        </div>
        <iframe src={SAMPLE_REPORT_URL} title="A real sample report" loading="lazy" className="block h-[24rem] w-full bg-canvas sm:h-[28rem] lg:h-[34rem]" />
      </div>
      <figcaption className="mt-3 text-sm text-ink-soft">
        A real check-up of a small demo site with a few known problems.{' '}
        <a href={SAMPLE_REPORT_URL} className="btn-link min-h-0 text-sm">
          Open it full size
        </a>
      </figcaption>
    </figure>
  );
}

/** The one action: a real form that navigates to the new check-up screen with the address, so it needs no script and loads no app code. */
function AddressForm() {
  return (
    <form action={startAddress()} method="get" className="flex flex-col gap-3 sm:flex-row">
      <label htmlFor="hero-url" className="sr-only">
        Your site’s address
      </label>
      <input id="hero-url" name="url" type="text" inputMode="url" autoComplete="url" placeholder="https://your-site.com" className="field min-h-[48px] flex-1" />
      <button type="submit" className="btn-primary whitespace-nowrap px-8">
        Run a free check-up
      </button>
    </form>
  );
}

function SectionTitle({ id, children, lead }: { id: string; children: ReactNode; lead?: string }) {
  return (
    <>
      <h2 id={id} className="max-w-prose text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        {children}
      </h2>
      {lead && <p className="mt-3 max-w-prose text-ink-soft">{lead}</p>}
    </>
  );
}

const SECTION = 'mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20';

export function LandingScreen() {
  useDocumentTitle(LANDING_TITLE);
  const wake = useWakeOnline();
  const link = 'inline-flex min-h-[44px] items-center rounded px-2 text-sm font-bold text-ink-soft transition-colors hover:text-ink';

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-rule bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-1 sm:px-6">
          <span className="inline-flex min-h-[44px] items-center gap-2 font-bold text-ink">
            <Mark />
            Release check-up
          </span>
          <nav aria-label="Main" className="flex flex-wrap items-center gap-x-1 sm:gap-x-3">
            <a href="#how" className={`${link} hidden sm:inline-flex`}>
              How it works
            </a>
            <a href={SAMPLE_REPORT_URL} className={`${link} hidden sm:inline-flex`}>
              Sample report
            </a>
            <a href="#pricing" className={`${link} hidden sm:inline-flex`}>
              Pricing
            </a>
            <StartButton className="btn-primary min-h-[44px] whitespace-nowrap px-4 text-sm">
              <span className="sm:hidden">Run a check-up</span>
              <span className="hidden sm:inline">Run a free check-up</span>
            </StartButton>
          </nav>
        </div>
      </header>

      <section aria-labelledby="hero-title" className="border-b border-rule bg-canvas">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
          <div>
            <p className="mb-4 font-mono text-sm text-stamp">Release check-up · free during the beta</p>
            <h1 id="hero-title" className="text-[clamp(2.5rem,1.6rem+4vw,4.25rem)] font-bold leading-[1.05] tracking-tight">
              QA without a QA team.
            </h1>
            <p className="mb-8 mt-5 max-w-prose text-xl text-ink-soft">
              Find out whether your site is ready to release before your users do. Paste its address and get a plain-words verdict, with the problems in priority order.
            </p>
            <AddressForm />
            <p className="mt-3 text-sm text-ink-soft">No sign-up. On a live site it only looks: nothing is filled in, sent or changed.</p>
            <WakeNote state={wake} />
          </div>
          <SampleReportFrame />
        </div>
      </section>

      <section aria-labelledby="promise-title" className={SECTION}>
        <h2 id="promise-title" className="sr-only">
          What it will and won’t do to your site
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {PROMISES.map((p) => (
            <li key={p.title} className="rounded-card border border-rule bg-surface px-5 py-4">
              <p className="font-bold text-ink">{p.title}</p>
              <p className="mt-1 text-ink-soft">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="how" aria-labelledby="how-title" className={`${SECTION} pt-0 sm:pt-0`}>
        <SectionTitle id="how-title" lead="You don’t write a single test. You read a plan and say yes.">
          Four steps from address to verdict
        </SectionTitle>
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {HOME_STEPS.map((s, i) => (
            <li key={s.name} className="rounded-card border border-rule bg-surface px-5 py-4">
              <span className="font-mono text-xs font-bold text-stamp">0{i + 1}</span>
              <p className="mt-1 font-bold text-ink">{s.name}</p>
              <p className="mt-1 text-ink-soft">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="areas-title" className="border-y border-rule bg-panel">
        <div className={SECTION}>
          <SectionTitle id="areas-title" lead="One verdict across the things a release can get wrong, with a grade for each.">
            What it looks at
          </SectionTitle>
          <ul className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((a) => (
              <li key={a.name} className="border-l-4 border-stamp pl-4">
                <p className="font-bold text-ink">{a.name}</p>
                <p className="text-ink-soft">{a.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="sample-title" className={SECTION}>
        <SectionTitle id="sample-title" lead="A real check-up of a small demo site we built with a few known problems. Nothing here is mocked up.">
          See a real report before you run anything
        </SectionTitle>
        <p className="mt-6">
          <a href={SAMPLE_REPORT_URL} className="btn-quiet px-8">
            Open the sample report
          </a>
        </p>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="border-y border-rule bg-panel">
        <div className={SECTION}>
          <SectionTitle id="pricing-title">Free while we’re in beta</SectionTitle>
          <p className="mt-3 max-w-prose text-ink-soft">
            Free check-ups, nothing to pay today. Paid plans are planned for heavier use, and we’ll say so well before anything is charged. The AI that writes your plan uses your own key (OpenRouter’s free models work), or you can skip AI and let fixed rules write the plan.
          </p>
          <p className="mt-4 max-w-prose text-ink-soft">
            The online copy is shared and runs one check-up at a time on public sites. It sleeps when idle, so the first visit can take about a minute. For private sites, or to keep everything on your own machine, run it yourself from the source.
          </p>
        </div>
      </section>

      <section aria-labelledby="faq-title" className={SECTION}>
        <SectionTitle id="faq-title">Questions people ask first</SectionTitle>
        <div className="mt-8 max-w-3xl divide-y divide-rule rounded-lg border border-rule bg-surface/60">
          {HOME_FAQ.map((item) => (
            <details key={item.q} className="px-4 py-3">
              <summary className="min-h-[44px] cursor-pointer py-2 font-bold">{item.q}</summary>
              <p className="mb-2 text-ink-soft">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="final-title" className="border-t border-rule bg-canvas">
        <div className={`${SECTION} text-center`}>
          <h2 id="final-title" className="mx-auto max-w-prose text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Find out if you’re ready to ship
          </h2>
          <p className="mx-auto mt-3 max-w-prose text-ink-soft">It takes an address and a few minutes of reading.</p>
          <p className="mt-8">
            <StartButton className="btn-primary px-10">Run a free check-up</StartButton>
          </p>
        </div>
      </section>

      <footer className="border-t border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-6 text-sm text-ink-soft sm:px-6">
          <span className="inline-flex items-center gap-2 font-bold text-ink">
            <Mark size={20} />
            Release check-up
          </span>
          <span>Source-available under FSL-1.1-MIT. Read the code and run it yourself.</span>
          <span className="flex flex-wrap gap-x-5">
            <a href={REPO_URL} className="btn-link text-sm" rel="noreferrer">
              Source on GitHub
            </a>
            <a href={`${REPO_URL}/blob/main/LICENSE`} className="btn-link text-sm" rel="noreferrer">
              License
            </a>
          </span>
        </div>
      </footer>
    </>
  );
}
