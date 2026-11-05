import type { PeerSyncBroker } from '../peer-sync/broker.ts'
import type { TodoItem, TodoPhase, TodoPhaseDraft } from '../todos.ts'
import type { ModelTokenUsage, SidecarMode } from './telemetry.ts'
import type { ToolInput } from './tool-evidence.ts'
import type { SidecarVerdict } from './verdict.ts'
import { formatPeerSyncNotices } from '../peer-sync/notices.ts'
import { redactSecrets } from '../privacy.ts'
import { allTasks, isIncomplete, isOpen, matchesTodo, normalizePhases } from '../todos.ts'
import { Burst } from './burst.ts'
import { buildDeltaPrompt, buildInitPrompt } from './prompts.ts'
import { createUsageTelemetry, recordSidecarCall } from './telemetry.ts'
import {
  extractFilePaths,
  parseToolInput,
  readToolNames,
  summarizeCodeChange,
  summarizeReadEvidence,
  summarizeVerification,
  verifyToolNames,
  writeToolNames,
} from './tool-evidence.ts'
import { parseSidecarVerdict } from './verdict.ts'

export interface SidecarReply {
  replyText: string
  mode: SidecarMode
  modelId: string
  usage: ModelTokenUsage
}

/** Rejects once `signal` aborts, so an aborted pass changes nothing */
export type SidecarRunner = (promptText: string, signal?: AbortSignal) => Promise<SidecarReply>

export interface ToolResult {
  toolName: string
  input: Record<string, unknown>
  output?: string
  isError: boolean
}

const maxStopBlocks = 3

const verificationTaskPattern =
  /\b(?:bun\s+test|npm\s+test|pnpm\s+test|vitest|jest|pytest|cargo\s+test|go\s+test|tsc|typecheck|lint)\b|运行.*测试|跑通.*测试|验证通过/i

const investigationTaskPattern =
  /\b(?:investigate|analyze|audit|inspect|research|locate|find|diagnose|review|check|understand)\b|调研|分析|排查|审计|定位|检查|阅读|梳理|诊断/i

/**
 * Core state machine for a single Peer Session's Sidecar Todo Watcher.
 */
export class SidecarTodoWatcher {
  readonly peerId: string
  readonly telemetry = createUsageTelemetry()
  paused = false
  readonly #broker: PeerSyncBroker
  #phases: TodoPhase[] = []
  #burst = new Burst()
  readonly #cumulativeReadFiles = new Set<string>()
  readonly #cumulativeTouchedFiles = new Set<string>()
  #turnLedger: string[] = []
  #turnCount = 0
  #userGoal = ''
  #pendingTailNotices: string[] = []
  #stopBlockCount = 0

  constructor(peerId: string, broker: PeerSyncBroker) {
    this.peerId = peerId
    this.#broker = broker
    broker.registerPeer(peerId)
  }

  get phases(): readonly TodoPhase[] {
    return this.#phases
  }

  /** Whether `runPass` without `force` would consult the sidecar */
  get isPassDue(): boolean {
    return !this.paused && (this.#phases.length === 0 || this.#burst.hasPendingActivity)
  }

  get pendingTouchedFiles(): string[] {
    return [...this.#burst.touchedFiles]
  }

  get activeTask(): TodoItem | undefined {
    return allTasks(this.#phases).find(task => task.status === 'in_progress')
  }

  get incompleteTasks(): TodoItem[] {
    return allTasks(this.#phases).filter(isIncomplete)
  }

  /**
   * Restores state from branch entries on `/resume`, `/branch`, `/tree`, or `session_switch`.
   */
  restore(phases: readonly TodoPhaseDraft[]): void {
    this.#startList(normalizePhases(phases))
  }

  resetTodos(): void {
    this.#startList([])
  }

  /**
   * Handles a new user prompt (`input` event):
   * - If all existing todos were already completed/abandoned, clears the list so Turn 1 of the new prompt extracts a fresh Todo list (solving #41359)
   * - Otherwise flags the prompt so mid-task scope additions can be extracted
   */
  onUserInput(text: string): { clearedFinishedList: boolean } {
    const prompt = text.trim()
    if (!prompt || prompt.startsWith('/')) return { clearedFinishedList: false }
    const clearedFinishedList = this.#phases.length > 0 && this.incompleteTasks.length === 0
    if (clearedFinishedList) this.#startList([])
    this.#stopBlockCount = 0
    this.#burst.userPrompted = true
    this.#userGoal = redactSecrets(prompt).slice(0, 1200)
    return { clearedFinishedList }
  }

  /**
   * Records assistant message text / tool-call intents from `turn_end` so a detached
   * small model without full conversation history still sees the main model's reasoning & actions.
   */
  onTurnEnd(content: readonly { type: string; text?: string; name?: string; intent?: string }[]): void {
    const parts: string[] = []
    let textLength = 0
    for (const block of content) {
      const text = block.type === 'text' ? (block.text ?? '').trim() : ''
      if (text) {
        textLength += text.length
        parts.push(redactSecrets(text).slice(0, 900))
      } else if (block.type === 'toolCall' && block.name !== undefined) {
        const intent = block.intent ?? ''
        parts.push(redactSecrets(`ToolCall: ${block.name}${intent ? ` (${intent})` : ''}`))
      }
    }
    if (parts.length === 0) return
    this.#burst.substantiveTextLength = Math.max(this.#burst.substantiveTextLength, textLength)
    this.#burst.addAssistantNote(parts.join(' | ').slice(0, 1200))
  }

  addManualTask(content: string): TodoItem | undefined {
    const phases: TodoPhase[] = this.#phases.length > 0 ? this.#phases : [{ name: 'Tasks', tasks: [] }]
    const [added] = appendNewTasks(phases, phases.find(phase => phase.name === 'Tasks') ?? phases[0], [content])
    if (added === undefined) return undefined
    this.#updatePhases(normalizePhases(phases))
    return allTasks(this.#phases).find(task => task.content === added)
  }

  markTaskCompleted(token: string): TodoItem | undefined {
    const task = allTasks(this.#phases).find(
      candidate => candidate.status !== 'completed' && matchesTodo(candidate, token),
    )
    if (!task) return undefined
    task.status = 'completed'
    this.#updatePhases(normalizePhases(this.#phases))
    return task
  }

  /**
   * Records tool execution results, updates ReadSet/WriteSet in the broker,
   * and returns any `additionalContext` to inject at the tool boundary.
   */
  onToolResult({ toolName, input: rawInput, output, isError }: ToolResult): string | undefined {
    const input = parseToolInput(rawInput)
    const filePaths = extractFilePaths(this.#broker.cwd, input)
    if (!isError && readToolNames.has(toolName)) this.#recordRead(toolName, filePaths, input, output)
    if (!isError && writeToolNames.has(toolName)) this.#recordWrite(toolName, filePaths, input)
    if (verifyToolNames.has(toolName)) {
      this.#recordVerification(toolName, filePaths, input, output, isError)
    }
    return this.#takePendingContext()
  }

  /**
   * Runs the Sidecar Watcher and resolves to whether the todo list changed:
   * - If no todos exist yet (Turn 1), extracts the structured Todo plan from the main model's exploration
   * - If todos exist and activity accumulated (or `force`), evaluates completed/appended/dropped todos, advances the active cursor, and publishes `<peer-sync>`
   */
  async runPass(
    runner: SidecarRunner,
    options: { force?: boolean; gitDiff?: string; signal?: AbortSignal } = {},
  ): Promise<boolean> {
    const { force = false } = options
    if (!force && !this.isPassDue) return false
    this.#turnCount++
    const initializing = this.#phases.length === 0

    // Snapshot and reset BEFORE awaiting network I/O so concurrent tool completions
    // in the next turn are never overwritten (preventing Lost Update anomaly).
    const burst = this.#burst
    this.#burst = new Burst()
    const diff = [...burst.codeSnippets, options.gitDiff ?? ''].filter(Boolean).join('\n')
    const promptText = initializing
      ? buildInitPrompt({ userGoal: this.#userGoal, burst, diff })
      : buildDeltaPrompt({
          userGoal: this.#userGoal,
          phases: this.#phases,
          turnLedger: this.#turnLedger,
          cumulativeReadFiles: this.#cumulativeReadFiles,
          cumulativeTouchedFiles: this.#cumulativeTouchedFiles,
          burst,
          diff,
        })
    const verdict = await this.#askSidecar(runner, initializing ? 'init' : 'delta', promptText, options.signal)
    if (!verdict) return false

    const initTasks = initializing ? (verdict.initTasks ?? []) : []
    if (initializing) {
      if (initTasks.length === 0) return false
      this.#phases = normalizePhases([
        { name: 'Tasks', tasks: initTasks.map(content => ({ content, status: 'pending' })) },
      ])
    }
    const completed = this.#transitionOpenTasks(
      verdict.completedTasks,
      'completed',
      task => !isCompletionVetoed(task, burst, force),
    )
    this.#appendLedgerEntry(burst, completed)
    const dropped = initializing ? [] : this.#transitionOpenTasks(verdict.dropTasks, 'abandoned')
    const appended = initializing ? [] : appendNewTasks(this.#phases, this.#phases.at(-1)!, verdict.appendTasks ?? [])

    const changed = initializing || completed.length > 0 || dropped.length > 0 || appended.length > 0
    if (changed) {
      this.#updatePhases(normalizePhases(this.#phases))
      this.#stopBlockCount = 0
      this.#pendingTailNotices.push(
        initializing
          ? initStatusNotice(initTasks.length, completed, this.activeTask)
          : progressStatusNotice(completed, appended, dropped, this.activeTask),
      )
    }
    this.#broker.publishMilestoneSync({
      fromPeerId: this.peerId,
      completedTasks: completed,
      summary: verdict.milestoneSummary,
      touchedFiles: [...burst.touchedFiles],
      exportedSymbols: verdict.exportedSymbolsChanged ?? [],
    })
    return changed
  }

  /**
   * Evaluates `session_stop`: blocks premature stop if open todos remain after flushing any pending write-burst.
   * Resolves to the reason for blocking the stop, or undefined to allow it
   */
  async evaluateStopGate(
    runner: SidecarRunner,
    options: { gitDiff?: string; signal?: AbortSignal } = {},
  ): Promise<string | undefined> {
    if (this.paused || this.#phases.length === 0) return undefined
    if (this.incompleteTasks.length > 0 && this.#burst.hasToolActivity) {
      await this.runPass(runner, { ...options, force: true })
    }

    const incomplete = this.incompleteTasks
    if (incomplete.length === 0) {
      this.#stopBlockCount = 0
      return undefined
    }
    if (this.#stopBlockCount >= maxStopBlocks) return undefined

    this.#stopBlockCount++
    const taskList = incomplete.map(task => `  - [${task.id}] ${task.content}`).join('\n')
    return `[Sidecar Todo Gate (${this.#stopBlockCount}/${maxStopBlocks})] You stopped with ${incomplete.length} unverified/incomplete todo item(s):\n${taskList}\nPlease complete the remaining implementation and verification before stopping.`
  }

  #startList(phases: TodoPhase[]): void {
    this.#burst = new Burst()
    this.#cumulativeReadFiles.clear()
    this.#cumulativeTouchedFiles.clear()
    this.#turnLedger = []
    this.#stopBlockCount = 0
    this.#updatePhases(phases)
  }

  #updatePhases(phases: TodoPhase[]): void {
    this.#phases = phases
    this.#broker.updatePeerTodos(this.peerId, phases)
  }

  #recordRead(toolName: string, filePaths: string[], input: ToolInput, output: string | undefined): void {
    this.#burst.reads++
    this.#broker.recordFileAccess(this.peerId, filePaths, 'read')
    for (const filePath of filePaths) this.#cumulativeReadFiles.add(filePath)
    this.#burst.addReadEvidence(summarizeReadEvidence(toolName, filePaths, input, output))
  }

  #recordWrite(toolName: string, filePaths: string[], input: ToolInput): void {
    this.#burst.writes++
    for (const filePath of filePaths) {
      this.#burst.touchedFiles.add(filePath)
      this.#cumulativeTouchedFiles.add(filePath)
    }
    this.#broker.recordFileAccess(this.peerId, filePaths, 'write')
    this.#burst.toolActions.push(`${toolName}(${filePaths.join(', ') || 'file'}) -> ok`)
    const code = input.content ?? input.input ?? ''
    if (code.trim()) {
      this.#burst.addCodeSnippet(summarizeCodeChange(filePaths[0] || toolName, toolName, code))
    }
  }

  #recordVerification(
    toolName: string,
    filePaths: string[],
    input: ToolInput,
    output: string | undefined,
    failed: boolean,
  ): void {
    if (failed) {
      this.#burst.verificationFailed = true
    } else if (this.incompleteTasks.length > 0) {
      this.#burst.verifications++
      this.#burst.verificationFailed = false
    }
    this.#burst.toolActions.push(summarizeVerification(toolName, input, filePaths, output, failed))
  }

  #takePendingContext(): string | undefined {
    const peerNotices = formatPeerSyncNotices(this.#broker.drainInbox(this.peerId))
    const context = [peerNotices, this.#pendingTailNotices.join('\n')].filter(Boolean).join('\n\n')
    this.#pendingTailNotices = []
    return context || undefined
  }

  async #askSidecar(
    runner: SidecarRunner,
    kind: 'init' | 'delta',
    promptText: string,
    signal: AbortSignal | undefined,
  ): Promise<SidecarVerdict | undefined> {
    const startedAt = performance.now()
    const reply = await runner(promptText, signal)
    recordSidecarCall(this.telemetry, {
      kind,
      mode: reply.mode,
      modelId: reply.modelId,
      usage: reply.usage,
      durationMs: performance.now() - startedAt,
    })
    return parseSidecarVerdict(reply.replyText)
  }

  /** Moves open tasks named by the sidecar to `status`, returning their contents */
  #transitionOpenTasks(
    tokens: readonly string[] = [],
    status: 'completed' | 'abandoned',
    isAllowed: (task: TodoItem) => boolean = () => true,
  ): string[] {
    const transitioned: string[] = []
    for (const task of allTasks(this.#phases)) {
      if (isOpen(task) && isAllowed(task) && tokens.some(token => matchesTodo(task, token))) {
        task.status = status
        transitioned.push(task.content)
      }
    }
    return transitioned
  }

  #appendLedgerEntry(burst: Burst, completed: readonly string[]): void {
    const facts = [
      burst.touchedFiles.size > 0 ? `files=[${[...burst.touchedFiles].join(',')}]` : '',
      burst.readEvidence.length > 0 ? `investigated=[${burst.readEvidence.slice(0, 3).join('; ')}]` : '',
      burst.toolActions.length > 0 ? `actions=[${burst.toolActions.slice(0, 3).join('; ')}]` : '',
      completed.length > 0 ? `completed=[${completed.join('; ')}]` : '',
    ].filter(Boolean)
    if (facts.length === 0) return
    this.#turnLedger.push(`Turn ${this.#turnCount}: ${facts.join(' ')}`)
    if (this.#turnLedger.length > 10) this.#turnLedger.shift()
  }
}

/** Appends the contents not on the list yet, ignoring case, to `targetPhase` as pending tasks and returns them */
function appendNewTasks(phases: readonly TodoPhase[], targetPhase: TodoPhase, contents: readonly string[]): string[] {
  const knownContents = new Set(allTasks(phases).map(task => task.content.toLowerCase()))
  const appended: string[] = []
  for (const rawContent of contents) {
    const content = rawContent.trim()
    if (!content || knownContents.has(content.toLowerCase())) continue
    knownContents.add(content.toLowerCase())
    targetPhase.tasks.push({ id: `#${allTasks(phases).length + 1}`, content, status: 'pending' })
    appended.push(content)
  }
  return appended
}

function isCompletionVetoed(task: TodoItem, burst: Burst, force: boolean): boolean {
  // Deterministic Verification Gate: never mark a test/verification task completed
  // if the verification command in this burst failed!
  if (burst.verificationFailed && verificationTaskPattern.test(task.content)) return true
  // Deterministic Investigation Gate: a pure investigation task needs written code or substantive findings (>= 60 chars), not just a silent file read mid-exploration
  return !force && burst.writes === 0 && burst.substantiveTextLength < 60 && investigationTaskPattern.test(task.content)
}

function initStatusNotice(taskCount: number, completed: readonly string[], active: TodoItem | undefined): string {
  const completedNote = completed.length > 0 ? ` Completed in Turn 1: ${quoted(completed)}.` : ''
  return `<sidecar-todo-status>Initialized ${taskCount} todo items.${completedNote} ${activeNote(
    'Active',
    active,
  )} (Managed automatically by Sidecar Watcher; do not call todo tool.)</sidecar-todo-status>`
}

function progressStatusNotice(
  completed: readonly string[],
  appended: readonly string[],
  dropped: readonly string[],
  active: TodoItem | undefined,
): string {
  const transitions = [
    completed.length > 0 ? `marked completed: ${quoted(completed)}` : '',
    appended.length > 0 ? `added: ${quoted(appended)}` : '',
    dropped.length > 0 ? `dropped: ${quoted(dropped)}` : '',
  ].filter(Boolean)
  return `<sidecar-todo-status>Sidecar Watcher ${transitions.join('; ')}. ${activeNote(
    'Now in_progress',
    active,
  )}</sidecar-todo-status>`
}

function activeNote(label: string, active: TodoItem | undefined): string {
  return active ? `${label} (${active.id}): "${active.content}".` : 'All todo items are now completed.'
}

function quoted(contents: readonly string[]): string {
  return contents.map(content => `"${content}"`).join(', ')
}
