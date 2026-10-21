import { useEffect, useRef, useState, type ReactNode } from 'react';
import { contactLinks } from '../lib/contact';
import { COUNTER_EVENTS, sendCounterEvent, sendCounterEventOnce } from '../lib/counter';
import { HOME_FAQ, HOME_STEPS } from '../lib/faq';
import { Mark } from '../components/TopBar';
import { WakeNote } from '../components/WakeNote';
import { useWakeOnline } from '../hooks/useWakeOnline';
import { startAddress } from '../lib/online';
import { applyTheme, readTheme, saveTheme, toggled, type Theme } from '../lib/theme';
import { LANDING_TITLE, useDocumentTitle } from '../lib/title';

export const REPO_URL = 'https://github.com/CJCreator/qa-flow-tester';
export const SAMPLE_REPORT_URL = '/sample-report.html';

export const AREAS: Array<{ name: string; text: string }> = [
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
  {
    title: 'Test copies only for forms',
    text: 'Filling in and sending forms is for a test copy of your site, and only if you choose it.',
  },
];

/** Where a check-up can run: the same checks in three places. */
const WHERE_IT_RUNS: Array<{ name: string; sites: string; where: string; setup: string }> = [
  {
    name: 'The online copy',
    sites: 'Public sites',
    where: 'Shared, one check-up at a time. Sleeps when idle, so the first visit can take about a minute.',
    setup: 'None: paste an address',
  },
  {
    name: 'Your own GitHub Actions',
    sites: 'Any address the runner can reach',
    where: 'On your own Actions minutes, when you start it or a preview deployment succeeds.',
    setup: 'Copy one workflow file',
  },
  {
    name: 'Your own computer',
    sites: 'Any address your computer can reach',
    where: 'Everything stays on your machine.',
    setup: 'Run it from the source',
  },
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
    <a href={startAddress()} className={className} onClick={() => sendCounterEvent(COUNTER_EVENTS.startCheckup)}>
      {children}
    </a>
  );
}

/**
 * Light or dark, for this page only. A plain token swap (see tailwind.config.js); the app's working
 * screens stay dark, so the attribute is removed when this page goes away.
 */
function ThemeToggle({ className }: { className: string }) {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  useEffect(() => {
    applyTheme(theme, document.documentElement);
    saveTheme(theme);
    return () => applyTheme('dark', document.documentElement);
  }, [theme]);
  return (
    <button
      type="button"
      aria-pressed={theme === 'light'}
      className={className}
      onClick={() => setTheme(toggled(theme))}
    >
      Light theme
    </button>
  );
}

/** The real sample report in a browser-style frame. Not a mock-up: the report shows its own verdict stamp. */
function SampleReportFrame() {
  return (
    <figure className="relative">
      <div className="overflow-hidden rounded-panel border border-rule/80 bg-canvas shadow-level-4 ring-1 ring-stamp/20 transition-all duration-300 hover:shadow-[0_0_25px_rgba(108,155,242,0.15)]">
        <div className="flex items-center justify-between border-b border-rule bg-panel px-4 py-2 font-mono text-xs text-ink-soft">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-fail/60" />
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-warn/60" />
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-pass/60" />
            <span className="ml-2 font-mono text-[11px] text-ink-soft">Sample report</span>
          </div>
          <span className="badge-tech text-[10px] py-0 px-2">
            <span className="h-1.5 w-1.5 rounded-full bg-pass" />
            VERDICT PREVIEW
          </span>
        </div>
        <iframe
          src={SAMPLE_REPORT_URL}
          title="A real sample report"
          loading="lazy"
          className="block h-[24rem] w-full bg-canvas sm:h-[28rem] lg:h-[34rem]"
        />
      </div>
      <figcaption className="mt-2.5 flex items-center justify-between text-xs text-ink-soft">
        <span>Real check-up of a demo site with known findings.</span>
        <a href={SAMPLE_REPORT_URL} className="btn-link text-xs">
          Open full size ↗
        </a>
      </figcaption>
    </figure>
  );
}

/** The one action: a real form that navigates to the new check-up screen with the address, so it needs no script and loads no app code. */
function AddressForm() {
  return (
    <form
      action={startAddress()}
      method="get"
      onSubmit={() => sendCounterEvent(COUNTER_EVENTS.startCheckup)}
      className="flex flex-col gap-3 sm:flex-row"
    >
      <label htmlFor="hero-url" className="sr-only">
        Your site’s address
      </label>
      <input
        id="hero-url"
        name="url"
        type="text"
        inputMode="url"
        autoComplete="url"
        placeholder="https://your-site.com"
        className="field min-h-[52px] flex-1 font-mono text-base placeholder:font-sans focus:border-stamp focus:ring-2 focus:ring-stamp/40 shadow-level-1"
      />
      <button
        type="submit"
        className="btn-primary min-h-[52px] whitespace-nowrap px-8 font-bold shadow-level-2 hover:shadow-level-3"
      >
        Start a free check-up
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
const NAV_LINK =
  'inline-flex min-h-[44px] items-center rounded px-2 text-sm font-bold text-ink-soft transition-colors hover:text-ink';

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
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          {open ? <path d="M3 3l12 12M15 3L3 15" /> : <path d="M2 5h14M2 9h14M2 13h14" />}
        </svg>
        Menu
      </button>
      {open && (
        <nav
          id="landing-menu"
          aria-label="Page sections"
          className="absolute inset-x-0 top-full border-b border-rule bg-surface px-4 pb-3 pt-1 shadow-level-3"
        >
          <ul>
            {NAV.map((n) => (
              <li key={n.href}>
                <a
                  href={n.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[48px] items-center border-b border-rule/60 text-base font-bold text-ink last:border-b-0"
                >
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
  const contact = contactLinks();

  useEffect(() => {
    sendCounterEventOnce(COUNTER_EVENTS.landingView);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-rule bg-surface/95 backdrop-blur-md">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-x-2 px-4 py-1 sm:gap-x-4 sm:px-6">
          <span className="inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap text-sm font-bold text-ink sm:text-base">
            <Mark />
            Release check-up
          </span>
          <div className="flex items-center gap-1 sm:gap-3">
            <nav aria-label="Main" className="hidden items-center gap-x-1 sm:flex">
              {NAV.map((n) => (
                <a
                  key={n.href}
                  href={n.href}
                  className={`${NAV_LINK} hidden lg:inline-flex ${n.label === 'Sample report' || n.label === 'Pricing' ? 'sm:inline-flex' : ''}`}
                >
                  {n.label}
                </a>
              ))}
              <ThemeToggle className={`${NAV_LINK} rounded border border-rule`} />
            </nav>
            <StartButton className="btn-primary min-h-[44px] whitespace-nowrap px-2.5 text-xs sm:px-4 sm:text-sm">
              <span className="sm:hidden">
                Start<span className="sr-only"> a free check-up</span>
              </span>
              <span className="hidden sm:inline">Start a free check-up</span>
            </StartButton>
            <MobileMenu />
          </div>
        </div>
      </header>

      <div className="overflow-x-clip">
        <section
          aria-labelledby="hero-title"
          className="border-b border-rule/80 bg-canvas bg-blueprint-grid relative overflow-hidden"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-canvas/80" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-control border border-stamp/40 bg-stamp-tint/80 px-3 py-1 font-mono text-xs font-bold text-stamp shadow-level-1">
                <span className="h-1.5 w-1.5 rounded-full bg-stamp animate-pulse" />
                <span>Release check-up · free during the beta</span>
              </div>
              <h1
                id="hero-title"
                className="text-[clamp(2.5rem,1.6rem+4vw,4.25rem)] font-bold leading-[1.05] tracking-tight text-ink"
              >
                QA without a QA team.
              </h1>
              <p className="mb-8 mt-5 max-w-prose text-xl text-ink-soft leading-relaxed">
                Paste your site's address. Release check-up opens it in a real browser and tells you in plain words
                whether it is ready to release, with the problems listed in priority order.
              </p>
              <AddressForm />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <span>Not ready to try it on your site?</span>
                <a href={SAMPLE_REPORT_URL} className="btn-link text-sm">
                  See a sample report
                </a>
              </div>
              <p className="mt-3 text-sm text-ink-soft">
                No sign-up. On a live site it only looks: nothing is filled in, sent or changed.
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                The address you type is sent with the page you go to, so it reaches whichever copy runs your check-up.
              </p>
              <WakeNote state={wake} />
            </div>
            <SampleReportFrame />
          </div>
        </section>

        {/* What it will and won't do, as one compact strip: the reassurance, not a section of its own. */}
        <section aria-labelledby="promise-title" className="border-b border-rule/80 bg-surface/90 backdrop-blur-sm">
          <h2 id="promise-title" className="sr-only">
            What it will and won’t do to your site
          </h2>
          <ul className="mx-auto grid max-w-6xl divide-y divide-rule/80 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {PROMISES.map((p) => (
              <li key={p.title} className="corner-ticks px-6 py-6 transition-colors hover:bg-panel/40">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-pass" />
                  <p className="font-bold text-ink">{p.title}</p>
                </div>
                <p className="mt-2 text-sm text-ink-soft leading-relaxed">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="how" aria-labelledby="how-title" className={`${SECTION} scroll-mt-16`}>
          <SectionTitle id="how-title" lead="You don’t write a single test. You read a plan and say yes.">
            Four steps from address to verdict
          </SectionTitle>
          <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {HOME_STEPS.map((s, i) => (
              <li
                key={s.name}
                className="blueprint-card p-6 flex flex-col justify-between hover:border-stamp/60 transition-all duration-200"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span aria-hidden="true" className="block font-stamp text-6xl leading-none text-stamp/90">
                      {i + 1}
                    </span>
                    <span className="badge-tech font-mono text-[10px]">STEP 0{i + 1}</span>
                  </div>
                  <p className="mt-4 text-lg font-bold text-ink">
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.name}
                  </p>
                  <p className="mt-2 text-sm text-ink-soft leading-relaxed">{s.text}</p>
                </div>
                {i < 3 && <div className="mt-4 hidden lg:block text-right font-mono text-xs text-edge/40">──────→</div>}
              </li>
            ))}
          </ol>
        </section>

        <section id="checks" aria-labelledby="areas-title" className="scroll-mt-16 border-y border-rule/80 bg-panel/70">
          <div className={`${SECTION} grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16`}>
            <div>
              <SectionTitle
                id="areas-title"
                lead="One verdict across the things a release can get wrong, with a grade for each."
              >
                What it looks at
              </SectionTitle>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {AREAS.map((a) => (
                <li
                  key={a.name}
                  className="blueprint-card p-5 border-l-4 border-l-stamp transition-all duration-200 hover:-translate-y-0.5 hover:shadow-level-3"
                >
                  <p className="font-bold text-ink">
                    <a
                      href={SAMPLE_REPORT_URL}
                      className="btn-link min-h-0 font-bold text-ink hover:text-stamp transition-colors"
                    >
                      {a.name}
                      <span className="sr-only">, in the sample report</span>
                    </a>
                  </p>
                  <p className="mt-1 text-sm text-ink-soft leading-relaxed">{a.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className={`${SECTION} scroll-mt-16`}>
          <SectionTitle
            id="pricing-title"
            lead="Free check-ups, nothing to pay today. Paid plans are planned for heavier use, and we’ll say so well before anything is charged."
          >
            Free while we’re in beta
          </SectionTitle>
          <p className="mt-3 max-w-prose text-ink-soft leading-relaxed">
            The AI that writes your plan uses your own key (OpenRouter’s free models work), or you can skip AI and let
            fixed rules write the plan.
          </p>
          <div
            tabIndex={0}
            role="region"
            aria-label="Where it runs"
            className="mt-10 max-w-full overflow-x-auto rounded-panel border border-rule/80 bg-surface/80 shadow-level-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stamp focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          >
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <caption className="border-b border-rule/80 bg-panel/50 px-5 py-3 text-left font-bold text-ink">
                Where it runs
              </caption>
              <thead>
                <tr className="border-b border-rule/80 text-ink-soft font-mono text-xs">
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
              <tbody className="divide-y divide-rule/60">
                {WHERE_IT_RUNS.map((r) => (
                  <tr key={r.name} className="align-top hover:bg-panel/30 transition-colors">
                    <th scope="row" className="px-5 py-4 font-bold text-ink">
                      {r.name}
                    </th>
                    <td className="px-5 py-4 text-ink-soft">{r.sites}</td>
                    <td className="px-5 py-4 text-ink-soft leading-relaxed">{r.where}</td>
                    <td className="px-5 py-4 text-ink font-mono text-xs">{r.setup}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 border-t border-rule/80 bg-panel/60">
          <div className={`${SECTION} grid gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16`}>
            <SectionTitle id="faq-title">Questions people ask first</SectionTitle>
            <div className="space-y-3">
              {HOME_FAQ.map((item, i) => (
                <details
                  key={item.q}
                  className="rounded-control border border-rule/80 bg-surface/60 px-5 py-2.5 transition-colors hover:border-edge"
                >
                  <summary className="min-h-[44px] cursor-pointer py-1 font-bold text-ink flex items-center">
                    <span className="badge-tech mr-3 text-[10px] font-mono shrink-0">FAQ-0{i + 1}</span>
                    <span>{item.q}</span>
                  </summary>
                  <p className="mb-2 mt-2 max-w-prose text-ink-soft text-sm leading-relaxed border-t border-rule/40 pt-3">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="final-title"
          className="border-t border-rule/80 bg-canvas bg-blueprint-grid relative overflow-hidden"
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-transparent to-canvas/60" />
          <div className={`${SECTION} relative text-center`}>
            <div className="mb-4 inline-flex items-center gap-2 rounded-control border border-stamp/40 bg-stamp-tint/80 px-3 py-1 font-mono text-xs font-bold text-stamp shadow-level-1">
              <span className="h-1.5 w-1.5 rounded-full bg-stamp animate-pulse" />
              <span>READY TO SHIP?</span>
            </div>
            <h2
              id="final-title"
              className="mx-auto max-w-prose text-3xl font-bold leading-tight tracking-tight sm:text-5xl text-ink"
            >
              Find out if you’re ready to ship
            </h2>
            <p className="mx-auto mt-4 max-w-prose text-ink-soft text-lg">
              It takes an address and a few minutes of reading.
            </p>
            <p className="mt-8">
              <StartButton className="btn-primary px-10 shadow-level-3 hover:shadow-level-4 font-bold">
                Start a free check-up
              </StartButton>
            </p>
          </div>
        </section>
      </div>

      <footer className="border-t border-rule bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm text-ink-soft sm:px-6 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 font-bold text-ink">
              <Mark size={20} />
              Release check-up
            </span>
            <p className="mt-3 max-w-xs">Source-available under FSL-1.1-MIT. Read the code and run it yourself.</p>
          </div>
          <nav aria-label="Tool">
            <p className="font-bold text-ink">Tool</p>
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
                <a
                  href={`${REPO_URL}/blob/main/LICENSE`}
                  className="btn-link text-sm no-underline hover:underline"
                  rel="noreferrer"
                >
                  License
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="Help">
            <p className="font-bold text-ink">Help</p>
            <ul className="mt-2">
              <li>
                <a
                  href={contact.contactHref}
                  className="btn-link text-sm no-underline hover:underline"
                  rel="noreferrer"
                >
                  Contact & Support
                </a>
              </li>
              <li>
                <a
                  href={`${REPO_URL}/blob/main/PRIVACY.md`}
                  className="btn-link text-sm no-underline hover:underline"
                  rel="noreferrer"
                >
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
