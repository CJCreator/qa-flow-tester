/** @type {import('claude-code').Register} */

const PIPELINE = [
  'Run the development pipeline below for this idea. Work through the phases in order. Do not skip a phase.',
  '',
  'IDEA:',
  '{{IDEA}}',
  '',
  'GROUND RULES',
  '- If a phase is blocked, stop and write REPORT.md with status BLOCKED and the reason.',
  '- Keep secrets out of files and logs.',
  '- On a design decision, ask one precise question instead of guessing.',
  '- Never claim something works without running it.',
  '- Write all pipeline artifacts (recon.md, spec.md, plan.md, progress.md, impact.md, REPORT.md) to .pipeline/<slug>/, where <slug> is a short kebab-case name for the idea.',
  '',
  'PHASE 0, RECON',
  '- Use Explore subagents (model haiku) to find: the stack; the build, test and lint commands; the modules nearest the feature; conventions; existing tests.',
  '- Run the tests once for a baseline. Record pass/fail counts and known failures.',
  '- Write recon.md.',
  '',
  'PHASE 1, ENHANCE',
  '- Write spec.md with: goal; context with file paths; numbered, testable functional requirements; non-functional requirements; out of scope; flagged assumptions; open questions (ask only if blocking); acceptance criteria.',
  '- Show me a summary.',
  '',
  'PHASE 2, PLAN',
  '- Enter plan mode.',
  '- Run these in parallel: the architect subagent; a research subagent (model sonnet) to check libraries and APIs; a test-strategist subagent (model sonnet) to map each acceptance criterion to tests; the impact-analyst subagent.',
  '- Write plan.md and present it.',
  '- STOP and wait for my approval. Do not write code before I approve.',
  '',
  'PHASE 3, IMPLEMENT (only after my approval)',
  '- Work on branch feat/<slug>.',
  '- One implementer subagent (model sonnet) per plan step. Small commits. Run tests after each step. Never disable or weaken tests.',
  '- Log each step in progress.md.',
  '',
  'PHASE 4, REVIEW',
  '- Run the code-reviewer subagent with fresh context.',
  '- Fix blocking findings. Log the rest. Rerun tests.',
  '',
  'PHASE 5, TEST',
  '- Run in order: install, lint, type-check, unit, integration, then end-to-end or smoke tests.',
  '- Mark each acceptance criterion PASS, FAIL, or NOT TESTED, with a reason.',
  '',
  'PHASE 6, REGRESSION',
  '- Run the full suite and compare against the Phase 0 baseline.',
  '- Smoke-test the dependents listed by the impact analysis.',
  '- Check migrations, config, global styles, event names, exported types and public signatures.',
  '- Confirm the build starts.',
  '- Write impact.md.',
  '',
  'PHASE 7, REPORT',
  '- Write REPORT.md with: summary; spec and assumptions; changes with commit hashes; test table; regression results; review findings; risks; run commands.',
  '- Show me the summary and the path to REPORT.md.',
].join('\n')

const USAGE = 'Usage: /build <rough idea>\nExample: /build add CSV export to the report page'

export const register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'build',
      description: 'Enhance, plan, build, test, verify regressions, and report on an idea',
      argumentHint: '<rough idea>',
    })

    return next(e)
  })

  on('command.run', { command: 'build' }, async ($, e) => {
    const idea = e.args.trim()
    if (!idea) return { text: USAGE }

    // split/join, not replace: an idea holding "$&" must stay literal.
    const text = PIPELINE.split('{{IDEA}}').join(idea)
    // The host refuses a submit made while this hook holds the turn, so let the hook return first.
    setTimeout(() => {
      $.prompt.submit({ text, asUser: true }).catch(err => {
        $.ui.toast('build: could not start the pipeline: ' + String(err))
      })
    }, 0)

    return {
      text: 'Pipeline started. It will plan first and wait for your approval after the plan is reviewed.',
    }
  })
}
