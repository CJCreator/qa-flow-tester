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
