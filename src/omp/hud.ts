import type { PeerSnapshot, PeerSyncBroker } from '../peer-sync/broker.ts'
import type { TodoItem } from '../todos.ts'
import type { SidecarTodoWatcher } from '../watcher/watcher.ts'
import type { OmpExtensionContext, OmpTheme } from './api.ts'
import { allTasks } from '../todos.ts'

const plainTheme: OmpTheme = { fg: (_color, text) => text, strikethrough: text => text }

const maxVisibleTasks = 5

export function refreshUi(
  ctx: OmpExtensionContext,
  { broker, watcher }: { broker: PeerSyncBroker; watcher: SidecarTodoWatcher },
): void {
  if (!ctx.hasUI) return
  const lines = renderHudLines(watcher, broker.listOtherPeers(watcher.peerId), ctx.ui.theme)
  ctx.ui.setWidget('sidecar-todo-watcher', lines.length > 0 ? lines : undefined, { placement: 'aboveEditor' })
  ctx.ui.setStatus('sidecar-todo', renderStatusText(watcher))
}

/**
 * Renders a multi-line TUI widget showing managed Todos (with checkboxes & theme colors) + Peer Team activity.
 */
export function renderHudLines(
  watcher: SidecarTodoWatcher,
  peers: readonly PeerSnapshot[],
  theme: OmpTheme = plainTheme,
): string[] {
  const tasks = allTasks(watcher.phases)
  const lines: string[] = []
  if (tasks.length > 0) {
    const done = tasks.filter(task => task.status === 'completed').length
    const active = watcher.activeTask
    const pauseBadge = watcher.paused ? theme.fg('warning', ' [PAUSED]') : ''
    const { telemetry } = watcher
    const telemetryBadge =
      telemetry.calls > 0
        ? theme.fg(
            'dim',
            ` · Watcher(${telemetry.lastModelId ?? telemetry.mode}): ${telemetry.calls} calls, ${telemetry.totalTokens} tok, ${(telemetry.cacheHitRate * 100).toFixed(1)}% cache ($${telemetry.totalCostUsd.toFixed(4)})`,
          )
        : ''
    lines.push(
      `${theme.fg('accent', '[Sidecar Todo]')} ${done}/${tasks.length} done${pauseBadge}${
        active ? ` · Active (${active.id}): ${active.content}` : ` · ${theme.fg('success', 'All complete ✓')}`
      }${telemetryBadge}`,
    )
    for (const task of tasks.slice(0, maxVisibleTasks)) {
      lines.push(`  ${renderTask(task, theme)}`)
    }
    if (tasks.length > maxVisibleTasks) {
      lines.push(`  ${theme.fg('dim', `… +${tasks.length - maxVisibleTasks} more todo(s)`)}`)
    }
  }

  if (peers.length > 0) {
    const peerSummary = peers
      .map(
        peer =>
          `@${peer.peerId}(${peer.completedCount}/${peer.totalCount}${peer.activeTask === null ? '' : `: ${peer.activeTask}`})`,
      )
      .join(' | ')
    lines.push(`${theme.fg('accent', '[Peers]')} ${peerSummary}`)
  }
  return lines
}

function renderStatusText(watcher: SidecarTodoWatcher): string | undefined {
  const tasks = allTasks(watcher.phases)
  if (tasks.length === 0) return undefined
  const done = tasks.filter(task => task.status === 'completed').length
  const active = watcher.activeTask
  return `Todo ${done}/${tasks.length}${watcher.paused ? ' (paused)' : active ? ` (${active.id})` : ' ✓'}`
}

function renderTask(task: TodoItem, theme: OmpTheme): string {
  switch (task.status) {
    case 'completed':
      return theme.fg('success', `[x] ${task.id} ${theme.strikethrough(task.content)}`)
    case 'in_progress':
      return theme.fg('accent', `[>] ${task.id} ${task.content}`)
    case 'abandoned':
      return theme.fg('dim', `[-] ${task.id} ${theme.strikethrough(task.content)}`)
    case 'blocked':
      return theme.fg('warning', `[!] ${task.id} ${task.content} (blocked)`)
    case 'pending':
      return theme.fg('muted', `[ ] ${task.id} ${task.content}`)
  }
}
