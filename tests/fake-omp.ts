import type { OmpEventHandlers, OmpExtensionAPI, OmpExtensionContext } from '../src/omp/api.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, vi } from 'vitest'
import sidecarTodoWatcherExtension from '../src/index.ts'
import { zeroUsage } from './fake-sidecar.ts'

/** Loads the extension into an in-memory omp host whose session lives in a fresh temporary directory, with the entries the extension appends as its branch. The sidecar answers ephemeral turns from `sidecarReplies` in order */
export interface FakeOmp {
  sessionId: string
  activeTools: string[]
  entries: { type: 'custom'; customType: string; data: unknown }[]
  widget: string[] | undefined
  sidecarReplies: string[]
  prompts: string[]
  emit: <E extends keyof OmpEventHandlers>(
    event: E,
    payload: Parameters<OmpEventHandlers[E]>[0],
  ) => Promise<Awaited<ReturnType<OmpEventHandlers[E]>>>
  command: (args: string) => Promise<void>
}

export function createFakeOmp(
  options: { agent?: OmpExtensionContext['agent']; activeTools?: string[]; gitDiff?: string } = {},
): FakeOmp {
  for (const name of ['OMP_PEER_ID', 'OMP_PEER_BROKER_DB', 'OMP_WATCHER_MODEL', 'OMP_WATCHER_MODE']) {
    vi.stubEnv(name, undefined)
  }
  const cwd = mkdtempSync(join(tmpdir(), 'sidecar-todo-watcher-'))
  const host: Omit<FakeOmp, 'emit' | 'command'> = {
    sessionId: 'session-alpha-001',
    activeTools: options.activeTools ?? ['read', 'edit', 'bash', 'todo'],
    entries: [],
    widget: undefined,
    sidecarReplies: [],
    prompts: [],
  }
  const handlers: Partial<OmpEventHandlers> = {}
  const commands = new Map<string, (args: string, ctx: OmpExtensionContext) => Promise<void>>()

  const ctx: OmpExtensionContext = {
    cwd,
    hasUI: true,
    ui: {
      theme: { fg: (_color, text) => text, strikethrough: text => text },
      setWidget: (_key, lines) => {
        host.widget = lines
      },
      setStatus: () => {},
      notify: () => {},
    },
    agent: options.agent ?? { kind: 'main', id: 'Main', name: 'main' },
    models: { resolve: () => undefined },
    modelRegistry: { getApiKey: async () => undefined, resolveModelHeaders: async () => undefined },
    sessionManager: { getSessionId: () => host.sessionId, getBranch: () => host.entries },
    runEphemeralTurn: async ({ promptText, signal }) => {
      signal?.throwIfAborted()
      host.prompts.push(promptText)
      return {
        replyText: host.sidecarReplies.shift() ?? '{}',
        assistantMessage: { model: 'sidecar', provider: 'test', usage: zeroUsage },
      }
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
  }

  const pi: OmpExtensionAPI = {
    setLabel: () => {},
    getActiveTools: () => host.activeTools,
    setActiveTools: async names => {
      host.activeTools = names
    },
    appendEntry: (customType, data) => {
      host.entries.push({ type: 'custom', customType, data })
    },
    exec: async () => ({ stdout: options.gitDiff ?? '', code: 0 }),
    on: (event, handler) => {
      handlers[event] = handler
    },
    registerCommand: (name, command) => {
      commands.set(name, command.handler)
    },
  }

  sidecarTodoWatcherExtension(pi)
  onTestFinished(async () => {
    await handlers.session_shutdown?.({}, ctx)
    rmSync(cwd, { recursive: true, force: true })
    vi.unstubAllEnvs()
  })

  return Object.assign(host, {
    async emit<E extends keyof OmpEventHandlers>(
      event: E,
      payload: Parameters<OmpEventHandlers[E]>[0],
    ): Promise<Awaited<ReturnType<OmpEventHandlers[E]>>> {
      const handler = handlers[event] as (
        event: Parameters<OmpEventHandlers[E]>[0],
        ctx: OmpExtensionContext,
      ) => Promise<Awaited<ReturnType<OmpEventHandlers[E]>>>
      return handler(payload, ctx)
    },
    async command(args: string): Promise<void> {
      await commands.get('peer-todos')!(args, ctx)
    },
  })
}
