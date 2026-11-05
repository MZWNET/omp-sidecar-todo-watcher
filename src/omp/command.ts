import type { PeerSyncBroker } from '../peer-sync/broker.ts'
import type { SidecarTodoWatcher } from '../watcher/watcher.ts'
import type { OmpExtensionContext } from './api.ts'
import type { SidecarSettings } from './runner.ts'
import { renderHudLines } from './hud.ts'
import { isWatcherMode, resolveDetachedModel } from './runner.ts'

export const peerTodosDescription =
  'Manage Sidecar Watcher todos & peer sync: /peer-todos [status|model <spec>|mode <auto|detached|ephemeral>|add <task>|done <#id>|reset|pause|resume|broadcast <msg>]'

export interface PeerTodosOutcome {
  message: string
  level: 'info' | 'warning'
  /** `todos` asks the caller to persist the list and refresh the HUD, `hud` only to refresh it */
  changed?: 'todos' | 'hud'
}

export function runPeerTodosCommand(
  rawArgs: string,
  session: { broker: PeerSyncBroker; watcher: SidecarTodoWatcher; settings: SidecarSettings },
  ctx: OmpExtensionContext,
): PeerTodosOutcome {
  const { broker, watcher, settings } = session
  const trimmed = rawArgs.trim()
  const spaceIndex = trimmed.indexOf(' ')
  const subcommand = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase()
  const rest = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim()

  switch (subcommand) {
    case 'model': {
      if (rest) settings.modelSpec = rest
      const model = resolveDetachedModel(ctx, settings)
      const modelName = model === undefined ? undefined : `${model.provider}/${model.id}`
      if (!rest) {
        return {
          message: `Current Watcher model: ${modelName ?? (settings.mode === 'detached' ? 'none' : 'session model (ephemeral)')}`,
          level: 'info',
        }
      }
      return modelName === undefined
        ? { message: `Could not resolve "${rest}", will fallback to default chain`, level: 'warning' }
        : { message: `Watcher model set to ${modelName}`, level: 'info' }
    }
    case 'mode': {
      if (!isWatcherMode(rest)) {
        return { message: 'Usage: /peer-todos mode <auto|detached|ephemeral>', level: 'warning' }
      }
      settings.mode = rest
      return { message: `Watcher mode set to ${rest}`, level: 'info' }
    }
    case 'add': {
      const added = watcher.addManualTask(rest)
      return added
        ? { message: `Added ${added.id}: ${added.content}`, level: 'info', changed: 'todos' }
        : { message: 'Usage: /peer-todos add <task description>', level: 'warning' }
    }
    case 'done': {
      const completed = watcher.markTaskCompleted(rest)
      return completed
        ? { message: `Completed ${completed.id}: ${completed.content}`, level: 'info', changed: 'todos' }
        : { message: `No open todo matching "${rest}"`, level: 'warning' }
    }
    case 'reset': {
      watcher.resetTodos()
      return { message: 'Sidecar todos archived and reset.', level: 'info', changed: 'todos' }
    }
    case 'pause':
    case 'resume': {
      watcher.paused = subcommand === 'pause'
      return {
        message: `Sidecar Todo Watcher ${watcher.paused ? 'paused' : 'resumed'}.`,
        level: 'info',
        changed: 'hud',
      }
    }
    case 'broadcast': {
      if (!rest) return { message: 'Usage: /peer-todos broadcast <technical message>', level: 'warning' }
      const queued = broker.broadcastPeerNote(watcher.peerId, rest)
      return { message: `Broadcast queued for ${queued} active peer(s).`, level: 'info' }
    }
    default: {
      const lines = renderHudLines(watcher, broker.listOtherPeers(watcher.peerId))
      return { message: lines.length > 0 ? lines.join('\n') : 'No active todos or peers.', level: 'info' }
    }
  }
}
