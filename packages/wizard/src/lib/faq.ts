/**
 * The home page's public explanation: what the tool is, how it works, and the questions people (and
 * answer engines) ask. This visible text mirrors the FAQPage / HowTo structured data in index.html,
 * so what a search or AI engine reads is what a visitor sees. Keep the two in step.
 */
export const HOME_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'What is Release check-up?',
    a: 'Release check-up is QA for teams without a QA person. It scans a web app, drafts a test plan, runs real-browser tests and tells you in plain words whether the app is ready to release, covering functionality, accessibility, performance, security and search readiness.',
  },
  {
    q: 'Will it change or break my site?',
    a: 'Not unless you allow it. On a live site it only looks: nothing is filled in, sent or changed. Filling in and sending forms is only for a test copy of your site, and you choose that yourself.',
  },
  {
    q: 'Where does my check-up run, and who can see it?',
    a: "On the free online copy, the check-up runs on our server, one at a time, and only public sites can be checked. Your AI key and any sign-in details are kept in memory for your visit only (up to 24 hours) and never written to disk. It is a shared beta copy: each visitor sees only their own check-ups and reports, but everyone shares one server, so don't check anything you would not want on shared hardware. To check a site on your own computer or network, run Release check-up yourself, and nothing leaves your machine.",
  },
  {
    q: 'Do I need to write tests?',
    a: 'No. The tool discovers your pages and proposes the tests; you only review and approve the plan.',
  },
  {
    q: 'How is it different from Lighthouse or my own Playwright tests?',
    a: 'Lighthouse and accessibility extensions look at one page at a time, and your own scripts only cover what you have written. Release check-up maps the whole site, plans the journeys that matter, tests them in a real browser and combines the results into one verdict. You can still keep both.',
  },
  {
    q: 'Does it check SEO, AEO and GEO?',
    a: 'Yes. It checks classic SEO (titles, descriptions, canonicals, structured data), answer-engine optimization (AEO: question-style headings, FAQ and HowTo markup, concise answers) and generative-engine optimization (GEO: entity clarity, llms.txt, AI-crawler access and citable facts).',
  },
  {
    q: 'What does it cost?',
    a: 'It is free during the beta and nothing is charged today. Paid plans are planned for heavier use. The AI that writes your plan uses your own key (OpenRouter’s free models work), or you can skip AI and let fixed rules write the plan.',
  },
];

/** The four steps, as the landing page shows them. They mirror the HowTo structured data in index.html. */
export const HOME_STEPS: Array<{ name: string; text: string }> = [
  {
    name: 'Paste your address',
    text: 'The site or test copy you want checked. You choose how much the tool may touch it.',
  },
  {
    name: 'Review the plan',
    text: 'It maps your pages and drafts the journeys that matter. Edit the plan, then approve it.',
  },
  { name: 'Watch it test', text: 'Real-browser tests run the approved plan and watch for problems as they go.' },
  {
    name: 'Read the verdict',
    text: 'A plain-language answer, the fixes in priority order, and evidence such as screenshots.',
  },
];
