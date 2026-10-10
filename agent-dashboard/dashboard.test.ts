import { read, update } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'

// @ts-expect-error the hooks module is plain JS
import * as dash from './hooks/register.js'

const usage = (input: number, output: number, model = 'claude-sonnet-x') => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: 5,
  cache_creation_input_tokens: 7,
  model,
})

const spawn = (state: any, agentId: string, type: string, at = 1000) =>
  dash.applySpawn(state, { agentId, type, description: 'task', model: 'sonnet', at })

describe('status mapping', () => {
  test('agent statuses map to the dashboard ones', () => {
    expect(dash.mapAgentStatus('pending')).toBe('queued')
    expect(dash.mapAgentStatus('running')).toBe('active')
    expect(dash.mapAgentStatus('waiting')).toBe('active')
    expect(dash.mapAgentStatus('completed')).toBe('done')
    expect(dash.mapAgentStatus('failed')).toBe('failed')
    expect(dash.mapAgentStatus('killed')).toBe('failed')
  })

  test('blocked comes only from status.json steps', () => {
    expect(dash.mapStepState('blocked')).toBe('blocked')
    expect(dash.mapStepState('nonsense')).toBe('queued')
    const parsed = dash.parseStatus(JSON.stringify({ runId: 'r', idea: 'i', phase: 'p', steps: [{ id: 'a', title: 'A', state: 'blocked' }] }))
    expect(parsed.snapshot.steps[0].state).toBe('blocked')
    for (const status of ['pending', 'running', 'waiting', 'completed', 'failed', 'killed']) {
      expect(dash.mapAgentStatus(status)).not.toBe('blocked')
    }
  })
})

describe('ETA', () => {
  test('is unknown without history', () => {
    const state = spawn(dash.initialView(), 'a1', 'Explore')
    const eta = dash.etaFor(state, state.agents.a1, 5000)
    expect(eta.text).toBe('unknown')
    expect(eta.ms).toBe(null)
    expect(dash.progressFor(state, state.agents.a1, 5000).fraction).toBe(null)
  })

  test('uses the median of earlier durations of the same type, labeled as an estimate', () => {
    let state = dash.initialView()
    for (const [i, ms] of [10000, 30000, 20000].entries()) {
      state = spawn(state, `h${i}`, 'Explore')
      state = dash.applyTurnComplete(state, { agentId: `h${i}`, usage: usage(1, 1), durationMs: ms, reason: 'answer', at: 2000 })
    }
    state = spawn(state, 'live', 'Explore', 100000)
    state = spawn(state, 'other', 'Plan', 100000)

    const eta = dash.etaFor(state, state.agents.live, 105000)
    expect(eta.ms).toBe(15000)
    expect(eta.text).toContain('estimate')
    expect(dash.etaFor(state, state.agents.other, 105000).text).toBe('unknown')
    expect(dash.progressFor(state, state.agents.live, 105000).isEstimate).toBe(true)
  })

  test('median handles even counts and empty input', () => {
    expect(dash.median([])).toBe(null)
    expect(dash.median([4, 2])).toBe(3)
  })
})

describe('token attribution', () => {
  test('sums usage per agentId', () => {
    let state = spawn(spawn(dash.initialView(), 'a1', 'Explore'), 'a2', 'Plan')
    state = dash.applyTurnComplete(state, { agentId: 'a1', usage: usage(10, 2), durationMs: 100, reason: 'answer', at: 2000 })
    state = dash.applyTurnComplete(state, { agentId: 'a1', usage: usage(5, 1), durationMs: 100, reason: 'answer', at: 3000 })
    state = dash.applyTurnComplete(state, { agentId: 'a2', usage: usage(1, 1), durationMs: 100, reason: 'answer', at: 3000 })

    expect(state.agents.a1.usage.input).toBe(15)
    expect(state.agents.a1.usage.output).toBe(3)
    expect(state.agents.a2.usage.input).toBe(1)
    expect(state.totals.input).toBe(16)
    expect(state.models['claude-sonnet-x']).toBe(3)
  })

  test('usage without an agentId is "not attributed" and counts only toward totals', () => {
    let state = spawn(dash.initialView(), 'a1', 'Explore')
    state = dash.applyTurnComplete(state, { agentId: undefined, usage: usage(100, 50), durationMs: 10, reason: 'answer', at: 2000 })

    expect(state.unattributed.input).toBe(100)
    expect(state.totals.input).toBe(100)
    expect(state.agents.a1.usage).toBe(null)
  })

  test('an agent with no reported usage reads "not reported", never a guess', () => {
    const state = dash.applyTurnComplete(spawn(dash.initialView(), 'a1', 'Explore'), {
      agentId: 'a1',
      usage: undefined,
      durationMs: 10,
      reason: 'answer',
      at: 2000,
    })
    const tokens = dash.agentTokens(state, state.agents.a1)

    expect(tokens.source).toBe('none')
    expect(tokens.input).toBe(null)
    expect(state.totals.turns).toBe(0)
  })

  test('an errored or aborted turn marks the agent failed with a reason', () => {
    const state = dash.applyTurnComplete(spawn(dash.initialView(), 'a1', 'Explore'), {
      agentId: 'a1',
      usage: undefined,
      durationMs: 10,
      reason: 'error',
      at: 2000,
    })

    expect(state.agents.a1.status).toBe('failed')
    expect(state.agents.a1.error).toContain('error')
  })

  test('tool calls count per agent', () => {
    let state = spawn(dash.initialView(), 'a1', 'Explore')
    state = dash.applyToolCall(dash.applyToolCall(state, { agentId: 'a1' }), { agentId: 'a1' })
    state = dash.applyToolCall(state, { agentId: undefined })

    expect(state.agents.a1.toolCalls).toBe(2)
  })
})

describe('self-reported fallback and mismatch', () => {
  const withRun = (state: any, tokens: any) => ({
    ...state,
    run: {
      runId: 'r1',
      isStale: false,
      note: null,
      snapshot: { runId: 'r1', idea: 'i', phase: 'p', steps: [{ id: 's1', title: 'Explore', state: 'done', startedAt: null, endedAt: null, agent: 'Explore', model: null, tokens }] },
    },
  })

  test('shows status.json tokens, labeled, when the hooks saw none', () => {
    const state = withRun(spawn(dash.initialView(), 'a1', 'Explore'), { input: 40, output: 9 })
    const tokens = dash.agentTokens(state, state.agents.a1)

    expect(tokens).toEqual({ input: 40, output: 9, source: 'self-reported', mismatch: false })
    expect(dash.stepTokens(state, state.run.snapshot.steps[0]).source).toBe('self-reported')
  })

  test('the hook value wins, never averaged, and a disagreement raises the mismatch flag', () => {
    let state = withRun(spawn(dash.initialView(), 'a1', 'Explore'), { input: 40, output: 9 })
    state = dash.applyTurnComplete(state, { agentId: 'a1', usage: usage(10, 2), durationMs: 5, reason: 'answer', at: 2000 })

    const tokens = dash.agentTokens(state, state.agents.a1)
    expect(tokens).toEqual({ input: 10, output: 2, source: 'observed', mismatch: true })
    expect(dash.stepTokens(state, state.run.snapshot.steps[0])).toEqual({ input: 10, output: 2, source: 'observed', mismatch: true })
  })

  test('no mismatch flag when both sources agree', () => {
    let state = withRun(spawn(dash.initialView(), 'a1', 'Explore'), { input: 10, output: 2 })
    state = dash.applyTurnComplete(state, { agentId: 'a1', usage: usage(10, 2), durationMs: 5, reason: 'answer', at: 2000 })

    expect(dash.agentTokens(state, state.agents.a1).mismatch).toBe(false)
  })
})

describe('reading the run', () => {
  const fakeFs = (files: Record<string, string | Error>) => ({
    fs: {
      exists: async (path: string) => path in files,
      read: async (path: string) => {
        const file = files[path]
        if (file instanceof Error) throw file
        if (file === undefined) throw new Error('ENOENT')

        return file
      },
    },
  })
  const good = JSON.stringify({ runId: 'r1', idea: 'i', phase: 'plan', steps: [{ id: 's', title: 'T', state: 'active', tokens: null }] })
  const empty = { runId: null, snapshot: null, isStale: false, note: null }

  test('reads CURRENT then status.json', async () => {
    const run = await dash.readRun(fakeFs({ '.claude/build-runs/CURRENT': 'r1\n', '.claude/build-runs/r1/status.json': good }), empty)

    expect(run.runId).toBe('r1')
    expect(run.snapshot.steps[0].state).toBe('active')
    expect(run.isStale).toBe(false)
  })

  test('no CURRENT means no run, and no Markdown file is ever read', async () => {
    const reads: string[] = []
    const $ = fakeFs({ '.claude/build-runs/CURRENT': 'r1', '.claude/build-runs/r1/status.json': good })
    const spy = { fs: { exists: $.fs.exists, read: async (path: string) => (reads.push(path), $.fs.read(path)) } }
    await dash.readRun(spy, empty)
    expect(reads.every(path => !path.endsWith('.md'))).toBe(true)

    const none = await dash.readRun(fakeFs({}), empty)
    expect(none.note).toBe('no run yet')
  })

  test('a parse failure keeps the last good snapshot and marks it stale', async () => {
    const last = (await dash.readRun(fakeFs({ '.claude/build-runs/CURRENT': 'r1', '.claude/build-runs/r1/status.json': good }), empty))
    const run = await dash.readRun(fakeFs({ '.claude/build-runs/CURRENT': 'r1', '.claude/build-runs/r1/status.json': '{"runId": "r1", "ste' }), last)

    expect(run.isStale).toBe(true)
    expect(run.snapshot).toEqual(last.snapshot)
    expect(run.note).toContain('did not parse')
  })

  test('a read error also keeps the last good snapshot', async () => {
    const last = await dash.readRun(fakeFs({ '.claude/build-runs/CURRENT': 'r1', '.claude/build-runs/r1/status.json': good }), empty)
    const run = await dash.readRun(fakeFs({ '.claude/build-runs/CURRENT': 'r1', '.claude/build-runs/r1/status.json': new Error('EBUSY') }), last)

    expect(run.isStale).toBe(true)
    expect(run.snapshot).toEqual(last.snapshot)
  })

  test('a CURRENT that is not a plain run id is refused', async () => {
    const run = await dash.readRun(fakeFs({ '.claude/build-runs/CURRENT': '../../secrets' }), empty)

    expect(run.snapshot).toBe(null)
    expect(run.note).toContain('not a valid run id')
  })
})

describe('filter and clearing', () => {
  test('the filter cycles and narrows agents and steps', () => {
    let state = spawn(spawn(dash.initialView(), 'a1', 'Explore'), 'a2', 'Plan')
    state = dash.applyTurnComplete(state, { agentId: 'a1', usage: undefined, durationMs: 1, reason: 'answer', at: 2000 })

    expect(dash.nextFilter('all')).toBe('queued')
    expect(dash.visibleAgents({ ...state, filter: 'done' }).map((a: any) => a.id)).toEqual(['a1'])
    expect(dash.visibleAgents({ ...state, filter: 'active' }).map((a: any) => a.id)).toEqual(['a2'])
    expect(dash.visibleAgents({ ...state, filter: 'all' }).length).toBe(2)
  })

  test('clear finished drops done and failed rows but keeps running ones and history', () => {
    let state = spawn(spawn(dash.initialView(), 'a1', 'Explore'), 'a2', 'Plan')
    state = dash.applyTurnComplete(state, { agentId: 'a1', usage: undefined, durationMs: 50, reason: 'answer', at: 2000 })
    const cleared = dash.clearFinished(state)

    expect(cleared.order).toEqual(['a2'])
    expect(cleared.agents.a1).toBeUndefined()
    expect(cleared.history.Explore).toEqual([50])
  })
})

describe('error recovery', () => {
  const fakeState = () => {
    const values = new Map<string, unknown>()
    let version = 0
    const key = (ref: any) => `${ref.plugin}/${ref.key}`

    return {
      state: {
        get: async (ref: any) => ({ value: values.get(key(ref)), version }),
        set: async (ref: any, value: unknown) => {
          values.set(key(ref), value)
          version += 1

          return { isSet: true, version }
        },
      },
    }
  }

  test('a throwing handler body is recorded in the pane state and not rethrown', async () => {
    const $ = fakeState()
    const result = await dash.guard($, 'turn.complete', async () => {
      throw new Error('boom')
    })
    const state = await read($ as any, dash.view)

    expect(result).toBe(undefined)
    expect(state.errors[0]).toContain('turn.complete: boom')
  })

  test('a failing pane write inside guard is swallowed too, so the session never sees it', async () => {
    const $ = { state: { get: async () => { throw new Error('state down') }, set: async () => { throw new Error('state down') } } }
    const result = await dash.guard($, 'tool.call', async () => {
      throw new Error('first failure')
    })

    expect(result).toBe(undefined)
  })

  test('after an error the next handler run still works', async () => {
    const $ = fakeState()
    await dash.guard($, 'a', async () => { throw new Error('x') })
    await dash.guard($, 'b', async () => {
      await update($ as any, dash.view, (s: any) => ({ ...s, filter: 'done' }))
    })
    const state = await read($ as any, dash.view)

    expect(state.filter).toBe('done')
    expect(state.errors.length).toBe(1)
  })

  test('only the last few errors are kept, each clipped', () => {
    let state = dash.initialView()
    for (let i = 0; i < 9; i++) state = dash.recordError(state, 'x', new Error('e'.repeat(500)))

    expect(state.errors.length).toBe(5)
    expect(state.errors[0].length).toBeLessThan(220)
  })
})

describe('observing only', () => {
  test('stored agents never keep prompt text', () => {
    const state = dash.applySpawn(dash.initialView(), {
      agentId: 'a1',
      type: 'Explore',
      description: 'short task',
      model: 'haiku',
      at: 1,
      prompt: 'SECRET PROMPT TEXT',
    })

    expect(JSON.stringify(state)).not.toContain('SECRET PROMPT TEXT')
  })
})

describe('the pane', () => {
  test('draws on the terminal, shows an active filter, and a button press changes it', async $ => {
    const ui = await $.ui.mount({
      plugin: 'agent-dashboard',
      surface: 'terminal',
      component: 'Pane',
      props: {} as any,
      requestId: 'agent-dashboard',
      viewport: { columns: 160, rows: 40 },
    })

    expect(await ui.find({ type: 'Text', text: 'Agent dashboard' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Showing: all statuses' })).toBeDefined()
    await ui.press({ key: 'filter' })
    expect(await ui.find({ type: 'Text', text: /FILTER ACTIVE: only queued/ })).toBeDefined()
    await ui.unmount()
  })
})
