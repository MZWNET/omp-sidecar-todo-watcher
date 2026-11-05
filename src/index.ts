import type { OmpExtensionAPI, OmpExtensionContext } from './omp/api.ts'
import type { SidecarSettings } from './omp/runner.ts'
import { join } from 'node:path'
import process from 'node:process'
import { appendStateEntry, findLatestTodoPhases } from './omp/branch.ts'
import { peerTodosDescription, runPeerTodosCommand } from './omp/command.ts'
import { readEnvironment } from './omp/environment.ts'
import { refreshUi } from './omp/hud.ts'
import { createSidecarRunner } from './omp/runner.ts'
import { PeerSyncBroker } from './peer-sync/broker.ts'
import { isSensitiveFilePath, redactSecrets } from './privacy.ts'
import { writeToolNames } from './watcher/tool-evidence.ts'
import { SidecarTodoWatcher } from './watcher/watcher.ts'

const readOnlyAgentNames = new Set(['advisor', 'scout', 'seance', 'reviewer', 'security-reviewer'])

interface Session {
  broker: PeerSyncBroker
  watcher: SidecarTodoWatcher
  /** Aborted when the session ends, so a pass still running for it changes nothing */
  ended: AbortController
  inFlightPass?: Promise<void>
  rerunRequested: boolean
}

/**
 * OMP Extension: Sidecar Todo Watcher & Peer Sync Broker
 */
export default function sidecarTodoWatcherExtension(pi: OmpExtensionAPI): void {
  const environment = readEnvironment(process.env)
  const settings: SidecarSettings = { modelSpec: environment.OMP_WATCHER_MODEL, mode: environment.OMP_WATCHER_MODE }
  let session: Session | undefined

  /** Excludes `advisor` internal tool sessions, read-only subagents, and sessions that cannot write */
  function isManaged(ctx: OmpExtensionContext): boolean {
    const { name, id } = ctx.agent
    if (readOnlyAgentNames.has(name.toLowerCase()) || readOnlyAgentNames.has(id.toLowerCase())) {
      return false
    }
    const activeTools = pi.getActiveTools()
    return (
      activeTools.length === 0 ||
      activeTools.some(tool => writeToolNames.has(tool) || tool === 'bash' || tool === 'eval')
    )
  }

  function sessionFor(ctx: OmpExtensionContext): Session {
    const peerId = (environment.OMP_PEER_ID ?? ctx.sessionManager.getSessionId()).slice(0, 24)
    if (session?.watcher.peerId === peerId) return session
    const broker =
      session?.broker ??
      new PeerSyncBroker(environment.OMP_PEER_BROKER_DB ?? join(ctx.cwd, '.omp', 'peer-sync.sqlite'), ctx.cwd)
    // The previous session of this process is gone
    if (session) endSession(session)
    const watcher = new SidecarTodoWatcher(peerId, broker)
    watcher.restore(findLatestTodoPhases(ctx.sessionManager.getBranch()))
    session = { broker, watcher, ended: new AbortController(), rerunRequested: false }
    return session
  }

  function endSession({ broker, watcher, ended }: Session): void {
    ended.abort()
    broker.unregisterPeer(watcher.peerId)
  }

  function persistAndRefreshUi(ctx: OmpExtensionContext, current: Session): void {
    appendStateEntry(pi, current.watcher)
    refreshUi(ctx, current)
  }

  async function collectGitDiff(ctx: OmpExtensionContext, files: readonly string[]): Promise<string | undefined> {
    const safeFiles = files.filter(file => !isSensitiveFilePath(file)).slice(0, 10)
    if (safeFiles.length === 0) return undefined
    try {
      const result = await pi.exec('git', ['diff', '-U2', '--', ...safeFiles], { cwd: ctx.cwd, timeout: 2000 })
      const diff = result.code === 0 ? result.stdout.trim() : ''
      return diff ? redactSecrets(diff) : undefined
    } catch {
      // git could not be spawned
      return undefined
    }
  }

  async function syncFromSessionBranch(_event: unknown, ctx: OmpExtensionContext): Promise<void> {
    if (!isManaged(ctx)) return
    const current = sessionFor(ctx)
    const activeTools = pi.getActiveTools()
    if (activeTools.includes('todo')) {
      await pi.setActiveTools(activeTools.filter(tool => tool !== 'todo'))
    }
    current.watcher.restore(findLatestTodoPhases(ctx.sessionManager.getBranch()))
    refreshUi(ctx, current)
  }

  /** Runs watcher passes off the turn's critical path, one at a time, coalescing requests made meanwhile */
  function launchWatcherPass(ctx: OmpExtensionContext, current: Session): void {
    if (current.inFlightPass) {
      current.rerunRequested = true
      return
    }
    const { watcher, ended } = current
    const runner = createSidecarRunner(ctx, settings)
    const drain = async (): Promise<void> => {
      do {
        current.rerunRequested = false
        const gitDiff = await collectGitDiff(ctx, watcher.pendingTouchedFiles)
        if (await watcher.runPass(runner, { gitDiff, signal: ended.signal })) persistAndRefreshUi(ctx, current)
      } while (current.rerunRequested && watcher.isPassDue)
    }
    current.inFlightPass = new Promise<void>(resolve => ctx.setTimeout(resolve, 0))
      .then(drain)
      // Non-fatal: sidecar errors are isolated from main session
      .catch(() => {})
      .finally(() => {
        current.inFlightPass = undefined
      })
  }

  pi.setLabel('Sidecar Todo Watcher & Peer Sync')

  pi.on('session_start', syncFromSessionBranch)
  pi.on('session_switch', syncFromSessionBranch)
  pi.on('session_branch', syncFromSessionBranch)
  pi.on('session_tree', syncFromSessionBranch)

  pi.on('input', async (event, ctx) => {
    if (!isManaged(ctx)) return
    const current = sessionFor(ctx)
    if (current.watcher.onUserInput(event.text).clearedFinishedList) persistAndRefreshUi(ctx, current)
  })

  pi.on('tool_result', async (event, ctx) => {
    if (!isManaged(ctx)) return undefined
    const additionalContext = sessionFor(ctx).watcher.onToolResult({
      toolName: event.toolName,
      input: event.input,
      output: outputText(event.content),
      isError: event.isError,
    })
    return additionalContext === undefined ? undefined : { additionalContext }
  })

  pi.on('turn_end', async (event, ctx) => {
    if (!isManaged(ctx)) return
    const current = sessionFor(ctx)
    current.watcher.onTurnEnd(event.message.content)
    if (current.watcher.isPassDue) launchWatcherPass(ctx, current)
  })

  pi.on('session_stop', async (event, ctx) => {
    if (!isManaged(ctx)) return undefined
    const current = sessionFor(ctx)
    if (current.watcher.paused) return undefined
    try {
      await current.inFlightPass
      const gitDiff = await collectGitDiff(ctx, current.watcher.pendingTouchedFiles)
      const reason = await current.watcher.evaluateStopGate(createSidecarRunner(ctx, settings), {
        gitDiff,
        signal: event.signal,
      })
      persistAndRefreshUi(ctx, current)
      return reason === undefined ? undefined : { decision: 'block', reason }
    } catch {
      // Fail open on unexpected transport error during shutdown
      return undefined
    }
  })

  pi.on('session_shutdown', async () => {
    if (!session) return
    endSession(session)
    session.broker.close()
    session = undefined
  })

  pi.registerCommand('peer-todos', {
    description: peerTodosDescription,
    handler: async (args, ctx) => {
      const current = sessionFor(ctx)
      const outcome = runPeerTodosCommand(args, { ...current, settings }, ctx)
      if (outcome.changed === 'todos') persistAndRefreshUi(ctx, current)
      if (outcome.changed === 'hud') refreshUi(ctx, current)
      ctx.ui.notify(outcome.message, outcome.level)
    },
  })
}

/** A tool's text output, kept whole: the watcher scrubs secrets before cutting it down and reads declarations line by line */
function outputText(content: readonly { type: string; text?: string }[]): string | undefined {
  const text = content
    .map(block => (block.type === 'text' ? (block.text ?? '').trim() : ''))
    .filter(Boolean)
    .join('\n')
  return text || undefined
}
