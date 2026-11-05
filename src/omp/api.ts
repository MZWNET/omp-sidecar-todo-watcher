import type { ModelTokenUsage } from '../watcher/telemetry.ts'

export interface OmpResolvedModel {
  id: string
  provider: string
  api: string
}

export interface OmpTheme {
  fg: (color: 'success' | 'accent' | 'warning' | 'error' | 'muted' | 'dim', text: string) => string
  strikethrough: (text: string) => string
}

export interface OmpExtensionContext {
  cwd: string
  hasUI: boolean
  ui: {
    theme: OmpTheme
    setWidget: (
      key: string,
      lines: string[] | undefined,
      options?: { placement?: 'aboveEditor' | 'belowEditor' },
    ) => void
    setStatus: (key: string, text: string | undefined) => void
    notify: (message: string, type?: 'info' | 'warning' | 'error') => void
  }
  agent: {
    kind: 'main' | 'sub'
    id: string
    name: string
  }
  models: {
    resolve: (spec: string) => OmpResolvedModel | undefined
  }
  modelRegistry: {
    getApiKey: (model: OmpResolvedModel) => Promise<string | undefined>
    resolveModelHeaders: (model: OmpResolvedModel, signal?: AbortSignal) => Promise<Record<string, string> | undefined>
  }
  sessionManager: {
    getSessionId: () => string
    getBranch: () => unknown[]
  }
  /** Absent in hosts without side turns */
  runEphemeralTurn?: (options: { promptText: string; minimizeEffort?: boolean; signal?: AbortSignal }) => Promise<{
    replyText: string
    assistantMessage: { model: string; provider: string; usage: ModelTokenUsage }
  }>
  setTimeout: (callback: () => void, ms?: number) => unknown
}

export interface OmpToolResultEvent {
  toolName: string
  input: Record<string, unknown>
  content: { type: string; text?: string }[]
  isError: boolean
}

export interface OmpTurnEndEvent {
  message: {
    content: { type: string; text?: string; name?: string; intent?: string }[]
  }
}

export interface OmpInputEvent {
  text: string
}

export interface OmpSessionStopEvent {
  signal: AbortSignal
}

export interface OmpEventHandlers {
  session_start: (event: unknown, ctx: OmpExtensionContext) => Promise<void>
  session_switch: (event: unknown, ctx: OmpExtensionContext) => Promise<void>
  session_branch: (event: unknown, ctx: OmpExtensionContext) => Promise<void>
  session_tree: (event: unknown, ctx: OmpExtensionContext) => Promise<void>
  session_shutdown: (event: unknown, ctx: OmpExtensionContext) => Promise<void>
  input: (event: OmpInputEvent, ctx: OmpExtensionContext) => Promise<void>
  turn_end: (event: OmpTurnEndEvent, ctx: OmpExtensionContext) => Promise<void>
  tool_result: (
    event: OmpToolResultEvent,
    ctx: OmpExtensionContext,
  ) => Promise<{ additionalContext: string } | undefined>
  session_stop: (
    event: OmpSessionStopEvent,
    ctx: OmpExtensionContext,
  ) => Promise<{ decision: 'block'; reason: string } | undefined>
}

export interface OmpExtensionAPI {
  setLabel: (label: string) => void
  getActiveTools: () => string[]
  setActiveTools: (names: string[]) => Promise<void>
  appendEntry: (customType: string, data: unknown) => void
  exec: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<{ stdout: string; code: number }>
  on: <E extends keyof OmpEventHandlers>(event: E, handler: OmpEventHandlers[E]) => void
  registerCommand: (
    name: string,
    command: { description: string; handler: (args: string, ctx: OmpExtensionContext) => Promise<void> },
  ) => void
}
