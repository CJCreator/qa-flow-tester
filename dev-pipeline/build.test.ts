import { expect, test } from 'claude-code/testing'

test('/build inserts the idea into the submitted pipeline prompt', async ($, on) => {
  const submitted: string[] = []
  on('ui.toast', async (_$, e) => { throw new Error('TOAST:' + e.text) })
  on('prompt.submit', async (_$, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  const idea = 'add CSV export $& to the report page'
  const answer = await $.command.run({ command: 'build', args: idea })
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(answer.text).toContain('Pipeline started')
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain(idea)
  expect(submitted[0]).not.toContain('{{IDEA}}')
  expect(submitted[0]).toContain('PHASE 7, REPORT')
})

test('/build prompt uses the build-runs folder, CURRENT pointer and status.json', async ($, on) => {
  const submitted: string[] = []
  on('prompt.submit', async (_$, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  await $.command.run({ command: 'build', args: 'small idea' })
  await new Promise(resolve => setTimeout(resolve, 50))
  const prompt = submitted[0] ?? ''

  expect(prompt).toContain('.claude/build-runs/<YYYYMMDD-HHMMSS>/')
  expect(prompt).toContain('.claude/build-runs/CURRENT')
  expect(prompt).not.toContain('.pipeline/')
  for (const file of ['recon.md', 'spec.md', 'plan.md', 'progress.md', 'impact.md', 'REPORT.md', 'status.json']) {
    expect(prompt).toContain(file)
  }
  for (const field of ['"runId"', '"idea"', '"phase"', '"steps"', '"startedAt"', '"endedAt"', '"agent"', '"model"', '"tokens"']) {
    expect(prompt).toContain(field)
  }
  expect(prompt).toContain('queued|active|done|failed|blocked')
  expect(prompt).toContain('Use null for any value you cannot know')
})

test('/build with no idea returns the usage message and submits nothing', async ($, on) => {
  const submitted: string[] = []
  on('ui.toast', async (_$, e) => { throw new Error('TOAST:' + e.text) })
  on('prompt.submit', async (_$, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  const answer = await $.command.run({ command: 'build', args: '   ' })
  await new Promise(resolve => setTimeout(resolve, 50))

  expect(answer.text).toContain('Usage: /build <rough idea>')
  expect(submitted.length).toBe(0)
})
