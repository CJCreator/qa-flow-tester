import { atom, read, update } from 'claude-code'

// Observe only: every hook below calls next(e) with e untouched and returns its result.
// Stored: ids, agent types, short descriptions, model ids, counts and times.
// Never stored: prompt text, file contents, tool arguments, secrets.

const PANE = 'agent-dashboard'
const RUNS_DIR = '.claude/build-runs'
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/
const MAX_AGENTS = 200
const MAX_HISTORY = 50
const MAX_ERRORS = 5
const MAX_TEXT = 120
const REFRESH_GAP_MS = 500
const FILTERS = ['all', 'queued', 'active', 'done', 'failed', 'blocked']

export const initialView = () => ({
  agents: {},
  order: [],
  unattributed: null,
  totals: { input: 0, output: 0, cacheRead: 0, cacheCreated: 0, turns: 0 },
  models: {},
  history: {},
  startedAt: null,
  now: null,
  lastUpdateAt: null,
  run: { runId: null, snapshot: null, isStale: false, note: null },
  filter: 'all',
  expanded: {},
  errors: [],
})

export const view = atom({ plugin: 'agent-dashboard', key: 'view' }, initialView())

// ---------- pure helpers ----------

const clip = (value, max = MAX_TEXT) => String(value ?? '').slice(0, max)
const num = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

/** Agent status from the engine (AgentStatus) to the dashboard's. */
export const mapAgentStatus = status => {
  switch (status) {
    case 'pending':
      return 'queued'
    case 'running':
    case 'waiting':
    case 'idle':
      return 'active'
    case 'completed':
      return 'done'
    case 'failed':
    case 'killed':
      return 'failed'
    default:
      return 'queued'
  }
}

/** A step's state from status.json. Anything unknown reads as queued. */
export const mapStepState = state =>
  ['queued', 'active', 'done', 'failed', 'blocked'].includes(state) ? state : 'queued'

export const median = values => {
  if (!values || values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export const fmtDuration = ms => {
  if (ms === null || ms === undefined) return '-'
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export const fmtCount = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

export const fmtClock = ms => (ms === null || ms === undefined ? '-' : new Date(ms).toTimeString().slice(0, 8))

export const bar = (fraction, width = 10) => {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** Elapsed ms: a finished agent's own turn time, a running one's time since spawn. */
export const elapsedMs = (agent, now) => {
  if (agent.status === 'done' || agent.status === 'failed') {
    if (agent.durationMs !== null) return agent.durationMs
    if (agent.startedAt !== null && agent.endedAt !== null) return agent.endedAt - agent.startedAt
    return null
  }
  if (agent.startedAt === null || now === null) return null
  return Math.max(0, now - agent.startedAt)
}

/** ETA from the median of earlier durations of the same agent type. Always an estimate. */
export const etaFor = (state, agent, now) => {
  if (agent.status === 'done' || agent.status === 'failed') return { ms: null, text: '-' }
  const typical = median(state.history[agent.type])
  if (typical === null) return { ms: null, text: 'unknown' }
  const elapsed = elapsedMs(agent, now) ?? 0
  const ms = Math.max(0, typical - elapsed)
  return { ms, text: `~${fmtDuration(ms)} (estimate)` }
}

/** Progress 0..1, or null when nothing honest can be said. Running: an estimate from history. */
export const progressFor = (state, agent, now) => {
  if (agent.status === 'done') return { fraction: 1, isEstimate: false }
  if (agent.status === 'failed') return { fraction: null, isEstimate: false }
  const typical = median(state.history[agent.type])
  const elapsed = elapsedMs(agent, now)
  if (typical === null || typical <= 0 || elapsed === null) return { fraction: null, isEstimate: true }
  return { fraction: Math.min(0.95, elapsed / typical), isEstimate: true }
}

const addUsage = (base, usage) => ({
  input: (base?.input ?? 0) + num(usage.input_tokens),
  output: (base?.output ?? 0) + num(usage.output_tokens),
  cacheRead: (base?.cacheRead ?? 0) + num(usage.cache_read_input_tokens),
  cacheCreated: (base?.cacheCreated ?? 0) + num(usage.cache_creation_input_tokens),
})

const newAgent = (id, patch) => ({
  id,
  type: 'unknown',
  description: '',
  status: 'queued',
  model: null,
  usageModel: null,
  startedAt: null,
  endedAt: null,
  durationMs: null,
  usage: null,
  toolCalls: 0,
  error: null,
  ...patch,
})

const withAgent = (state, agent) => {
  const known = state.agents[agent.id] !== undefined
  let order = known ? state.order : [...state.order, agent.id]
  let agents = { ...state.agents, [agent.id]: agent }
  if (order.length > MAX_AGENTS) {
    const drop = order.find(id => agents[id].status === 'done' || agents[id].status === 'failed')
    if (drop !== undefined) {
      order = order.filter(id => id !== drop)
      const { [drop]: _gone, ...rest } = agents
      agents = rest
    }
  }
  return { ...state, agents, order }
}

/** agent.spawn resolved: the agent exists and runs now. The prompt is never read. */
export const applySpawn = (state, { agentId, type, description, model, at }) => {
  if (!agentId) return state
  const agent = newAgent(agentId, {
    type: clip(type, 64) || 'unknown',
    description: clip(description),
    status: 'active',
    model: model ? clip(model, 80) : null,
    startedAt: at,
  })

  return { ...withAgent(state, agent), lastUpdateAt: at, now: at }
}

/** turn.complete: usage per agentId; no agentId (main loop) is "not attributed". */
export const applyTurnComplete = (state, { agentId, usage, durationMs, reason, at }) => {
  let next = { ...state, lastUpdateAt: at, now: at }
  if (usage) {
    const model = clip(usage.model, 80)
    next = {
      ...next,
      totals: { ...addUsage(next.totals, usage), turns: next.totals.turns + 1 },
      models: model ? { ...next.models, [model]: (next.models[model] ?? 0) + 1 } : next.models,
    }
  }
  if (!agentId) {
    return usage ? { ...next, unattributed: addUsage(next.unattributed, usage) } : next
  }

  const agent = next.agents[agentId] ?? newAgent(agentId, {})
  const ms = typeof durationMs === 'number' && durationMs >= 0 ? durationMs : 0
  const isDone = reason === 'answer'
  const finished = {
    ...agent,
    status: isDone ? 'done' : 'failed',
    endedAt: at,
    durationMs: (agent.durationMs ?? 0) + ms,
    usage: usage ? addUsage(agent.usage, usage) : agent.usage,
    usageModel: usage?.model ? clip(usage.model, 80) : agent.usageModel,
    error: isDone ? null : `turn ended: ${clip(reason, 40)}`,
  }
  next = withAgent(next, finished)
  if (isDone && finished.durationMs > 0) {
    const past = [...(next.history[finished.type] ?? []), finished.durationMs].slice(-MAX_HISTORY)
    next = { ...next, history: { ...next.history, [finished.type]: past } }
  }

  return next
}

export const applyToolCall = (state, { agentId }) => {
  const agent = agentId ? state.agents[agentId] : undefined
  if (!agent) return state

  return { ...state, agents: { ...state.agents, [agentId]: { ...agent, toolCalls: agent.toolCalls + 1 } } }
}

/** $.agent.list() rows: the engine's status wins; unseen agents are added without times. */
export const applyListing = (state, infos, at) => {
  let next = { ...state, now: at, lastUpdateAt: at }
  for (const info of infos ?? []) {
    if (!info || typeof info.id !== 'string') continue
    const known = next.agents[info.id]
    const status = mapAgentStatus(info.status)
    const agent = known
      ? { ...known, status }
      : newAgent(info.id, { type: clip(info.type, 64) || 'unknown', description: clip(info.description), status })
    next = withAgent(next, agent)
  }

  return next
}

export const recordError = (state, where, err) => {
  const message = clip(err && err.message ? err.message : err, 160)

  return { ...state, errors: [...state.errors, `${clip(where, 40)}: ${message}`].slice(-MAX_ERRORS) }
}

export const clearFinished = state => {
  const keep = state.order.filter(id => state.agents[id].status === 'active' || state.agents[id].status === 'queued')
  const agents = {}
  const expanded = {}
  for (const id of keep) {
    agents[id] = state.agents[id]
    if (state.expanded[id]) expanded[id] = true
  }

  return { ...state, agents, order: keep, expanded }
}

export const nextFilter = filter => FILTERS[(FILTERS.indexOf(filter) + 1) % FILTERS.length]

export const visibleAgents = state =>
  state.order.map(id => state.agents[id]).filter(a => state.filter === 'all' || a.status === state.filter)

export const visibleSteps = state =>
  (state.run.snapshot?.steps ?? []).filter(s => state.filter === 'all' || s.state === state.filter)

export const countsByStatus = state => {
  const counts = { queued: 0, active: 0, done: 0, failed: 0 }
  for (const id of state.order) counts[state.agents[id].status] += 1

  return counts
}

const sameAgent = (step, agent) => step.agent !== null && (step.agent === agent.type || step.agent === agent.id)

/**
 * Tokens for an agent row. Hook-observed usage always wins; status.json tokens are a
 * labeled fallback and are never blended with it. A disagreement raises `mismatch`.
 */
export const agentTokens = (state, agent) => {
  const step = (state.run.snapshot?.steps ?? []).find(s => sameAgent(s, agent) && s.tokens !== null)
  if (agent.usage) {
    const mismatch = step ? step.tokens.input !== agent.usage.input || step.tokens.output !== agent.usage.output : false

    return { input: agent.usage.input, output: agent.usage.output, source: 'observed', mismatch }
  }
  if (step) return { ...step.tokens, source: 'self-reported', mismatch: false }

  return { input: null, output: null, source: 'none', mismatch: false }
}

/** Tokens for a status.json step: observed usage of agents that match its `agent`, else its own. */
export const stepTokens = (state, step) => {
  const matches = Object.values(state.agents).filter(a => a.usage && sameAgent(step, a))
  if (matches.length > 0) {
    const input = matches.reduce((sum, a) => sum + a.usage.input, 0)
    const output = matches.reduce((sum, a) => sum + a.usage.output, 0)
    const mismatch = step.tokens !== null && (step.tokens.input !== input || step.tokens.output !== output)

    return { input, output, source: 'observed', mismatch }
  }
  if (step.tokens) return { ...step.tokens, source: 'self-reported', mismatch: false }

  return { input: null, output: null, source: 'none', mismatch: false }
}

/** Validates status.json text. Keeps only the known fields; clips every string. */
export const parseStatus = text => {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false }
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.steps)) return { ok: false }
  const steps = raw.steps
    .filter(s => s && typeof s === 'object')
    .map(s => ({
      id: clip(s.id, 64),
      title: clip(s.title),
      state: mapStepState(s.state),
      startedAt: typeof s.startedAt === 'string' ? clip(s.startedAt, 40) : null,
      endedAt: typeof s.endedAt === 'string' ? clip(s.endedAt, 40) : null,
      agent: typeof s.agent === 'string' && s.agent ? clip(s.agent, 64) : null,
      model: typeof s.model === 'string' && s.model ? clip(s.model, 80) : null,
      tokens:
        s.tokens && typeof s.tokens === 'object' && typeof s.tokens.input === 'number' && typeof s.tokens.output === 'number'
          ? { input: num(s.tokens.input), output: num(s.tokens.output) }
          : null,
    }))

  return {
    ok: true,
    snapshot: { runId: clip(raw.runId, 64), idea: clip(raw.idea), phase: clip(raw.phase, 64), steps },
  }
}

/**
 * Reads CURRENT then status.json through $.fs. A read or parse failure keeps the last good
 * snapshot of the same run and marks it stale. Never reads the Markdown files.
 */
export const readRun = async ($, last) => {
  const keep = (runId, note) => ({
    runId,
    snapshot: last.runId === runId ? last.snapshot : null,
    isStale: last.runId === runId && last.snapshot !== null,
    note,
  })
  try {
    const pointer = `${RUNS_DIR}/CURRENT`
    if (!(await $.fs.exists(pointer))) return { runId: null, snapshot: null, isStale: false, note: 'no run yet' }
    const runId = String(await $.fs.read(pointer)).split(/\r?\n/)[0].trim()
    if (!RUN_ID.test(runId)) return keep(last.runId, 'CURRENT is not a valid run id')
    const file = `${RUNS_DIR}/${runId}/status.json`
    if (!(await $.fs.exists(file))) return keep(runId, 'status.json not written yet')
    const parsed = parseStatus(await $.fs.read(file))
    if (!parsed.ok) return keep(runId, 'status.json did not parse')

    return { runId, snapshot: parsed.snapshot, isStale: false, note: null }
  } catch (err) {
    return keep(last.runId, `read failed: ${clip(err && err.message ? err.message : err, 80)}`)
  }
}

/** Runs fn; a failure is recorded in the pane and never thrown into the session. */
export const guard = async ($, where, fn) => {
  try {
    return await fn()
  } catch (err) {
    try {
      await update($, view, state => recordError(state, where, err))
    } catch {
      // the pane itself is unreachable; nothing more to do
    }

    return undefined
  }
}

let lastRefreshAt = 0

export const refresh = async ($, isForced) => {
  const at = await $.clock.now()
  if (!isForced && at - lastRefreshAt < REFRESH_GAP_MS) return
  lastRefreshAt = at
  const state = await read($, view)
  const infos = await $.agent.list().catch(() => [])
  const run = await readRun($, state.run)
  await update($, view, current => ({ ...applyListing(current, infos, at), run }))
}

const refreshQuietly = ($, where) => {
  void guard($, where, () => refresh($, false))
}

// ---------- hooks ----------

export const register = on => {
  let timer = null

  on('session.start', async ($, e, next) => {
    await guard($, 'session.start', async () => {
      await $.command.register({ name: 'dashboard', description: 'Open the agent dashboard pane' })
      const at = await $.clock.now()
      await update($, view, state => (state.startedAt === null ? { ...state, startedAt: at, now: at, lastUpdateAt: at } : state))
      if (timer) timer.cancel()
      // Moves "now" once a second, and only while an agent runs. Elapsed times read it.
      timer = $.clock.every(1000, () => {
        void guard($, 'tick', async () => {
          const state = await read($, view)
          if (!state.order.some(id => state.agents[id].status === 'active')) return
          const at = await $.clock.now()
          await update($, view, current => ({ ...current, now: at }))
        })
      })
    })

    return next(e)
  })

  on('command.run', { command: 'dashboard' }, async $ => {
    try {
      const opened = await $.ui.open({ id: PANE, title: 'Agents' })
      refreshQuietly($, 'command.run')

      return {
        text: opened.isPlaced
          ? 'Agent dashboard opened.'
          : `Agent dashboard is open but not drawn yet: ${opened.reason}`,
      }
    } catch (err) {
      return { text: `Agent dashboard could not open: ${clip(err && err.message ? err.message : err, 120)}` }
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    await guard($, 'agent.spawn', async () => {
      const at = await $.clock.now()
      const spawned = { agentId: result.agentId, type: e.subagentType, description: e.description, model: result.model, at }
      await update($, view, state => applySpawn(state, spawned))
    })
    refreshQuietly($, 'agent.spawn')

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await guard($, 'turn.complete', async () => {
      const at = await $.clock.now()
      const done = { agentId: e.agentId, usage: e.usage, durationMs: e.durationMs, reason: e.reason, at }
      await update($, view, state => applyTurnComplete(state, done))
    })
    refreshQuietly($, 'turn.complete')

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await guard($, 'tool.call', () => update($, view, state => applyToolCall(state, { agentId: e.agentId })))
    refreshQuietly($, 'tool.call')

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    try {
      return await draw($, e)
    } catch (err) {
      return next(e)
    }
  })
}

// ---------- drawing ----------

const STATUS_ICON = { queued: '○', active: '▶', done: '✔', failed: '✘', blocked: '■' }
const STATUS_COLOR = { queued: 'subtle', active: 'warning', done: 'success', failed: 'error', blocked: 'error' }

const tokenText = tokens =>
  tokens.source === 'none' ? 'not reported' : `${fmtCount(tokens.input)} in / ${fmtCount(tokens.output)} out`

const draw = async ($, e) => {
  const { Box, Text, Button } = $.ui.resolve(e)
  const state = await read($, view)
  const now = state.now
  const press = (where, fn) => () => {
    void guard($, where, fn)
  }
  const toggle = id => s => {
    const expanded = { ...s.expanded }
    if (expanded[id]) delete expanded[id]
    else expanded[id] = true

    return { ...s, expanded }
  }
  const agents = visibleAgents(state)
  const steps = visibleSteps(state)
  const counts = countsByStatus(state)
  const room = Math.max(8, (e.viewport?.rows ?? 30) - 14)
  const shownAgents = agents.slice(-Math.max(3, Math.floor(room / 2)))
  const isFiltered = state.filter !== 'all'

  const stepRow = step => {
    const tokens = stepTokens(state, step)
    const parts = [`${STATUS_ICON[step.state]} ${step.title}`]
    if (step.state === 'blocked') parts.push(' (blocked, self-reported)')
    if (tokens.source !== 'none') {
      parts.push(`  ${tokenText(tokens)}${tokens.source === 'self-reported' ? ' (self-reported)' : ''}`)
    }
    if (tokens.mismatch) parts.push('  ⚠ mismatch with status.json')

    return h(Text, { key: `step-${step.id}`, color: STATUS_COLOR[step.state] }, parts.join(''))
  }

  const agentRow = agent => {
    const isOpen = state.expanded[agent.id] === true
    const tokens = agentTokens(state, agent)
    const progress = progressFor(state, agent, now)
    const eta = etaFor(state, agent, now)
    const model = agent.usageModel ?? agent.model
    const barText = progress.fraction === null ? '[ ····· ]' : bar(progress.fraction) + (progress.isEstimate ? ' est.' : '')
    const tokenLine = `${tokenText(tokens)}${tokens.source === 'self-reported' ? ' (self-reported)' : ''}${tokens.mismatch ? ' ⚠ mismatch' : ''}`

    const header = h(
      Button,
      { key: `row-${agent.id}`, onPress: press('row', () => update($, view, toggle(agent.id))) },
      h(Text, { color: STATUS_COLOR[agent.status] }, `${isOpen ? '▾' : '▸'} ${STATUS_ICON[agent.status]} ${agent.type} ${agent.status}`),
      h(Text, null, ` ${barText}`),
      h(Text, { dimColor: true }, ` ${fmtDuration(elapsedMs(agent, now))} ETA ${eta.text}`),
      h(Text, null, ` ${tokenLine}`),
      h(Text, { dimColor: true }, ` ${model ?? 'model not reported'}`),
    )
    if (!isOpen) return h(Box, { key: `agent-${agent.id}`, flexDirection: 'column' }, header)

    const cache = agent.usage ? `  (cache read ${fmtCount(agent.usage.cacheRead)}, cache written ${fmtCount(agent.usage.cacheCreated)})` : ''

    return h(
      Box,
      { key: `agent-${agent.id}`, flexDirection: 'column' },
      header,
      h(
        Box,
        { flexDirection: 'column', paddingX: 4 },
        h(Text, null, `description: ${agent.description || '-'}`),
        h(Text, null, `started: ${fmtClock(agent.startedAt)}   ended: ${fmtClock(agent.endedAt)}`),
        h(Text, null, `model: ${model ?? 'not reported'}`),
        h(Text, null, `tokens: ${tokenText(tokens)}${cache}`),
        h(Text, null, `tool calls: ${agent.toolCalls}`),
        agent.error && h(Text, { color: 'error' }, `error: ${agent.error}`),
        h(Button, { key: `collapse-${agent.id}`, label: 'Collapse', onPress: press('collapse', () => update($, view, toggle(agent.id))) }),
      ),
    )
  }

  const modelList = Object.keys(state.models).length === 0
    ? 'not reported'
    : Object.entries(state.models).map(([m, n]) => `${m} x${n}`).join(', ')

  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { gap: 2 },
      h(Text, { bold: true }, 'Agent dashboard'),
      h(Text, { dimColor: true }, `as of ${fmtClock(now)}`),
      state.run.isStale && h(Text, { color: 'warning' }, 'stale, retrying'),
    ),
    h(
      Box,
      { gap: 1 },
      h(Button, { key: 'refresh', label: 'Refresh', onPress: press('refresh', () => refresh($, true)) }),
      h(Button, { key: 'filter', label: `Filter: ${state.filter}`, onPress: press('filter', () => update($, view, s => ({ ...s, filter: nextFilter(s.filter) }))) }),
      h(Button, { key: 'clear', label: 'Clear finished', onPress: press('clear', () => update($, view, clearFinished)) }),
      h(Button, { key: 'collapse-all', label: 'Collapse all', onPress: press('collapse-all', () => update($, view, s => ({ ...s, expanded: {} }))) }),
    ),
    h(
      Text,
      { color: isFiltered ? 'warning' : undefined, bold: isFiltered, dimColor: !isFiltered },
      isFiltered ? `FILTER ACTIVE: only ${state.filter} (press Filter to cycle)` : 'Showing: all statuses',
    ),
    h(Text, { bold: true }, `Run ${state.run.runId ?? '-'}${state.run.snapshot ? `  phase: ${state.run.snapshot.phase || '-'}` : ''}`),
    state.run.note && h(Text, { dimColor: true }, state.run.note),
    steps.length === 0 && h(Text, { dimColor: true }, 'No steps to show.'),
    ...steps.slice(0, 12).map(stepRow),
    steps.length > 12 && h(Text, { dimColor: true }, `+${steps.length - 12} more steps`),
    h(Text, { bold: true }, 'Agents'),
    agents.length === 0 && h(Text, { dimColor: true }, 'No agents yet.'),
    agents.length > shownAgents.length && h(Text, { dimColor: true }, `${agents.length - shownAgents.length} older rows hidden (Clear finished)`),
    ...shownAgents.map(agentRow),
    h(Text, { bold: true }, 'Session totals'),
    h(Text, null, `tokens: ${fmtCount(state.totals.input)} in / ${fmtCount(state.totals.output)} out${state.totals.turns === 0 ? '  (none reported yet)' : ''}`),
    h(Text, null, `models: ${modelList}`),
    h(Text, null, `time: ${state.startedAt === null || now === null ? '-' : fmtDuration(now - state.startedAt)}   agents: ${counts.queued} queued, ${counts.active} running, ${counts.done} done, ${counts.failed} failed`),
    state.unattributed && h(Text, { dimColor: true }, `not attributed (main loop): ${fmtCount(state.unattributed.input)} in / ${fmtCount(state.unattributed.output)} out`),
    ...state.errors.map((line, i) => h(Text, { key: `err-${i}`, color: 'error' }, `handler error: ${line}`)),
  )
}
