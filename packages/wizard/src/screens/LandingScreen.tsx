import { useEffect, useRef, useState, type ReactNode } from 'react';
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

/** Where a check-up can run: the same checks in three places. */
const WHERE_IT_RUNS: Array<{ name: string; sites: string; where: string; setup: string }> = [
  { name: 'The online copy', sites: 'Public sites', where: 'Shared, one check-up at a time. Sleeps when idle, so the first visit can take about a minute.', setup: 'None: paste an address' },
  { name: 'Your own GitHub Actions', sites: 'Any address the runner can reach', where: 'On your own Actions minutes, when you start it or a preview deployment succeeds.', setup: 'Copy one workflow file' },
  { name: 'Your own computer', sites: 'Any address your computer can reach', where: 'Everything stays on your machine.', setup: 'Run it from the source' },
];

const NAV: Array<{ href: string; label: string }> = [
  { href: '#how', label: 'How it works' },
  { href: '#checks', label: 'What it checks' },
  { href: SAMPLE_REPORT_URL, label: 'Sample report' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'Questions' },
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
      <figcaption className="mt-2 text-sm text-ink-soft">
        A real check-up of a small demo site with a few known problems.{' '}
        <a href={SAMPLE_REPORT_URL} className="btn-link text-sm">
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
const NAV_LINK = 'inline-flex min-h-[44px] items-center rounded px-2 text-sm font-bold text-ink-soft transition-colors hover:text-ink';

/**
 * The menu for narrow screens: a disclosure. The button says whether it is open, Esc and choosing a
 * link close it, and Esc hands focus back to the button. It is not a modal, so the page behind stays reachable.
 */
function MobileMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="sm:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls="landing-menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded px-2 text-sm font-bold text-ink hover:bg-panel"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M3 3l12 12M15 3L3 15" /> : <path d="M2 5h14M2 9h14M2 13h14" />}
        </svg>
        Menu
      </button>
      {open && (
        <nav id="landing-menu" aria-label="Page sections" className="absolute inset-x-0 top-full border-b border-rule bg-surface px-4 pb-3 pt-1 shadow-level-3">
          <ul>
            {NAV.map((n) => (
              <li key={n.href}>
                <a href={n.href} onClick={() => setOpen(false)} className="flex min-h-[48px] items-center border-b border-rule/60 text-base font-bold text-ink last:border-b-0">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

export function LandingScreen() {
  useDocumentTitle(LANDING_TITLE);
  const wake = useWakeOnline();

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-rule bg-surface/95 backdrop-blur-md">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-x-4 px-4 py-1 sm:px-6">
          <span className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap text-sm font-bold text-ink sm:text-base">
            <Mark />
            Release check-up
          </span>
          <div className="flex items-center gap-1 sm:gap-3">
            <nav aria-label="Main" className="hidden items-center gap-x-1 sm:flex">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className={`${NAV_LINK} hidden lg:inline-flex ${n.label === 'Sample report' || n.label === 'Pricing' ? 'sm:inline-flex' : ''}`}>
                  {n.label}
                </a>
              ))}
            </nav>
            <StartButton className="btn-primary min-h-[44px] whitespace-nowrap px-3 text-sm sm:px-4">
              <span className="sm:hidden">Run a check-up</span>
              <span className="hidden sm:inline">Run a free check-up</span>
            </StartButton>
            <MobileMenu />
          </div>
        </div>
      </header>

      <main>
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
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <a href={SAMPLE_REPORT_URL} className="btn-link text-sm">
                  See a sample report
                </a>
              </div>
              <p className="mt-3 text-sm text-ink-soft">No sign-up. On a live site it only looks: nothing is filled in, sent or changed.</p>
              <p className="mt-1 text-sm text-ink-soft">The address you type is sent with the page you go to, so it reaches whichever copy runs your check-up.</p>
              <WakeNote state={wake} />
            </div>
            <SampleReportFrame />
          </div>
        </section>

        {/* What it will and won't do, as one compact strip: the reassurance, not a section of its own. */}
        <section aria-labelledby="promise-title" className="border-b border-rule bg-surface">
          <h2 id="promise-title" className="sr-only">
            What it will and won’t do to your site
          </h2>
          <ul className="mx-auto grid max-w-6xl divide-y divide-rule sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {PROMISES.map((p) => (
              <li key={p.title} className="px-4 py-5 sm:px-6">
                <p className="font-bold text-ink">{p.title}</p>
                <p className="mt-1 text-sm text-ink-soft">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" aria-labelledby="how-title" className={`${SECTION} scroll-mt-16`}>
          <SectionTitle id="how-title" lead="You don’t write a single test. You read a plan and say yes.">
            Four steps from address to verdict
          </SectionTitle>
          <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {HOME_STEPS.map((s, i) => (
              <li key={s.name} className="border-t-2 border-ink pt-4">
                <span aria-hidden="true" className="block font-stamp text-6xl leading-none text-stamp">
                  {i + 1}
                </span>
                <p className="mt-3 text-lg font-bold text-ink">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.name}
                </p>
                <p className="mt-1 text-ink-soft">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="checks" aria-labelledby="areas-title" className="scroll-mt-16 border-y border-rule bg-panel">
          <div className={`${SECTION} grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16`}>
            <div>
              <SectionTitle id="areas-title" lead="One verdict across the things a release can get wrong, with a grade for each.">
                What it looks at
              </SectionTitle>
            </div>
            <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {AREAS.map((a) => (
                <li key={a.name} className="border-l-4 border-stamp pl-4">
                  <p className="font-bold text-ink">{a.name}</p>
                  <p className="text-ink-soft">{a.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className={`${SECTION} scroll-mt-16`}>
          <SectionTitle id="pricing-title" lead="Free check-ups, nothing to pay today. Paid plans are planned for heavier use, and we’ll say so well before anything is charged.">
            Free while we’re in beta
          </SectionTitle>
          <p className="mt-3 max-w-prose text-ink-soft">
            The AI that writes your plan uses your own key (OpenRouter’s free models work), or you can skip AI and let fixed rules write the plan.
          </p>
          <div className="mt-10 overflow-x-auto rounded-card border border-rule bg-surface">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <caption className="border-b border-rule px-5 py-3 text-left font-bold text-ink">Where it runs</caption>
              <thead>
                <tr className="border-b border-rule text-ink-soft">
                  <th scope="col" className="px-5 py-3 font-bold">
                    Option
                  </th>
                  <th scope="col" className="px-5 py-3 font-bold">
                    Sites it can check
                  </th>
                  <th scope="col" className="px-5 py-3 font-bold">
                    How it runs
                  </th>
                  <th scope="col" className="px-5 py-3 font-bold">
                    To start
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {WHERE_IT_RUNS.map((r) => (
                  <tr key={r.name} className="align-top">
                    <th scope="row" className="px-5 py-4 font-bold text-ink">
                      {r.name}
                    </th>
                    <td className="px-5 py-4 text-ink-soft">{r.sites}</td>
                    <td className="px-5 py-4 text-ink-soft">{r.where}</td>
                    <td className="px-5 py-4 text-ink-soft">{r.setup}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 border-t border-rule bg-panel">
          <div className={`${SECTION} grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16`}>
            <SectionTitle id="faq-title">Questions people ask first</SectionTitle>
            <div className="divide-y divide-rule border-y border-rule">
              {HOME_FAQ.map((item) => (
                <details key={item.q} className="py-1">
                  <summary className="min-h-[44px] cursor-pointer py-2 font-bold">{item.q}</summary>
                  <p className="mb-3 max-w-prose text-ink-soft">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="final-title" className="bg-canvas">
          <div className={`${SECTION} text-center`}>
            <h2 id="final-title" className="mx-auto max-w-prose text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
              Find out if you’re ready to ship
            </h2>
            <p className="mx-auto mt-3 max-w-prose text-ink-soft">It takes an address and a few minutes of reading.</p>
            <p className="mt-8">
              <StartButton className="btn-primary px-10">Run a free check-up</StartButton>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-rule bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-ink-soft sm:px-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 font-bold text-ink">
              <Mark size={20} />
              Release check-up
            </span>
            <p className="mt-3 max-w-xs">Source-available under FSL-1.1-MIT. Read the code and run it yourself.</p>
          </div>
          <nav aria-label="Product">
            <p className="font-bold text-ink">Product</p>
            <ul className="mt-2">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a href={n.href} className="btn-link text-sm no-underline hover:underline">
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Source">
            <p className="font-bold text-ink">Source</p>
            <ul className="mt-2">
              <li>
                <a href={REPO_URL} className="btn-link text-sm no-underline hover:underline" rel="noreferrer">
                  Source on GitHub
                </a>
              </li>
              <li>
                <a href={`${REPO_URL}/blob/main/LICENSE`} className="btn-link text-sm no-underline hover:underline" rel="noreferrer">
                  License
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="Help">
            <p className="font-bold text-ink">Help</p>
            <ul className="mt-2">
              <li>
                <a href={`${REPO_URL}/issues`} className="btn-link text-sm no-underline hover:underline" rel="noreferrer">
                  Contact & Support
                </a>
              </li>
              <li>
                <a href={`${REPO_URL}/blob/main/PRIVACY.md`} className="btn-link text-sm no-underline hover:underline" rel="noreferrer">
                  Privacy & Terms
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </>
  );
}
