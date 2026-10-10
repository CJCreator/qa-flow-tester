export type DashStatus = 'queued' | 'active' | 'done' | 'failed'
export type StepState = DashStatus | 'blocked'
export type DashFilter = 'all' | StepState

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheCreated: number
}

export type DashAgent = {
  id: string
  type: string
  description: string
  status: DashStatus
  model: string | null
  usageModel: string | null
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  usage: Usage | null
  toolCalls: number
  error: string | null
}

export type DashStep = {
  id: string
  title: string
  state: StepState
  startedAt: string | null
  endedAt: string | null
  agent: string | null
  model: string | null
  tokens: { input: number; output: number } | null
}

export type DashSnapshot = { runId: string; idea: string; phase: string; steps: DashStep[] }

export type DashRun = {
  runId: string | null
  snapshot: DashSnapshot | null
  isStale: boolean
  note: string | null
}

export type DashboardView = {
  agents: Record<string, DashAgent>
  order: string[]
  unattributed: Usage | null
  totals: Usage & { turns: number }
  models: Record<string, number>
  history: Record<string, number[]>
  startedAt: number | null
  now: number | null
  lastUpdateAt: number | null
  run: DashRun
  filter: DashFilter
  expanded: Record<string, true>
  errors: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'agent-dashboard': { view: DashboardView }
  }
}
