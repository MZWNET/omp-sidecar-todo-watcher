import type { TodoItem, TodoPhase } from '../todos.ts'
import type { Burst } from './burst.ts'
import { allTasks, isOpen } from '../todos.ts'

/** Every fixed rule lives in the system prompt, so all sidecar calls share it as the start of their cached prefix */
export const sidecarInstructions = [
  "You are a fast, deterministic JSON-only code-progress judge for a coding agent's todo list. Each user message reports the agent's activity since the previous one. Do not think or explain; output ONLY a raw JSON object starting with '{' and ending with '}'.",
  '',
  '[WHEN THERE IS NO TODO LIST YET]',
  'Extract 2 to 6 concrete, verifiable engineering todo items in execution order (`initTasks` array).',
  'If any step is ALREADY fully implemented/verified by the reported tool actions, list its 1-based ID (e.g. "#1") in `completedTasks`.',
  'Reply format: {"initTasks": ["step 1", "step 2"], "completedTasks": ["#1"], "milestoneSummary": null, "exportedSymbolsChanged": []}',
  '',
  '[EVALUATION RULES FOR AN EXISTING TODO LIST]',
  '1. Mark an open item in `completedTasks` (by ID like "#1") ONLY if every function/requirement named in that item is implemented and verified in the reported code/actions.',
  "2. For investigation/analysis/audit items (e.g. 'Analyze X', 'Locate root cause'), mark completed ONLY if the target files were read AND the 'Main Agent Notes & Analytical Findings' contain the concrete analytical conclusion/findings (or the agent has already moved on to implementing the fix).",
  '3. Never mark a test/verification item completed if the test command has not run yet or failed.',
  '4. If the user added new requirements, list in `appendTasks`; if an item is obsolete, list in `dropTasks`.',
  '5. If shared exports/signatures changed or a key investigation finding affects peers, write a 1-sentence `milestoneSummary` and list `exportedSymbolsChanged`.',
  'Reply format: {"completedTasks": ["#1"], "appendTasks": [], "dropTasks": [], "milestoneSummary": null, "exportedSymbolsChanged": []}',
].join('\n')

/** The first message of a transcript, carrying the task context the sidecar has not seen yet */
export function buildOpeningPrompt(context: {
  userGoal: string
  phases: readonly TodoPhase[]
  cumulativeReadFiles: ReadonlySet<string>
  cumulativeTouchedFiles: ReadonlySet<string>
  burst: Burst
  diff: string
}): string {
  const lines = [
    '[TASK CONTEXT]',
    `User Goal: ${context.userGoal || '(infer from the activity below)'}`,
    ...todoListLines(context.phases),
  ]
  if (context.phases.length > 0) {
    lines.push(
      `Investigated/Read files so far: ${[...context.cumulativeReadFiles].join(', ') || '(none)'}`,
      `Modified files so far: ${[...context.cumulativeTouchedFiles].join(', ') || '(none)'}`,
    )
  }
  return [...lines, '', ...activityLines(context.burst, context.diff)].join('\n')
}

/** A later message of a transcript: what changed since the sidecar's previous reply */
export function buildFollowUpPrompt(context: {
  userPrompt: string
  phases: readonly TodoPhase[]
  burst: Burst
  diff: string
}): string {
  const { burst } = context
  const lines = burst.userPrompted ? [`New user message: ${context.userPrompt}`] : []
  return [...lines, ...openTodoLines(context.phases), '', ...activityLines(burst, context.diff)].join('\n')
}

function todoListLines(phases: readonly TodoPhase[]): string[] {
  const tasks = allTasks(phases)
  if (tasks.length === 0) return ['Todo List: (none yet)']
  return ['Todo List:', ...tasks.map(taskLine)]
}

/** The finished items already sit earlier in the transcript */
function openTodoLines(phases: readonly TodoPhase[]): string[] {
  const tasks = allTasks(phases)
  if (tasks.length === 0) return ['Todo List: (none yet)']
  const openTasks = tasks.filter(isOpen)
  return openTasks.length > 0 ? ['Open Todo Items:', ...openTasks.map(taskLine)] : ['Open Todo Items: (none)']
}

function taskLine(task: TodoItem): string {
  return `${task.id} [${task.status}]: ${task.content}`
}

function activityLines(burst: Burst, diff: string): string[] {
  const lines: string[] = []
  if (burst.assistantNotes.length > 0) {
    lines.push('Main Agent Notes & Analytical Findings:', ...burst.assistantNotes)
  }
  if (burst.readEvidence.length > 0) {
    lines.push('Files & symbols inspected:', ...bullets(burst.readEvidence))
  }
  if (burst.toolActions.length > 0) {
    lines.push('Executed tool actions:', ...bullets(burst.toolActions))
  }
  if (burst.touchedFiles.size > 0) {
    lines.push(`Modified files: ${[...burst.touchedFiles].join(', ')}`)
  }
  if (diff.trim()) {
    lines.push('On-disk git diff snippet:', '```diff', diff.trim().slice(0, 3000), '```')
  }
  return ['[AGENT ACTIVITY]', ...(lines.length > 0 ? lines : ['(none)'])]
}

function bullets(items: readonly string[]): string[] {
  return items.map(item => `- ${item}`)
}
