import type { TodoPhase } from '../todos.ts'
import type { Burst } from './burst.ts'
import { allTasks, isOpen } from '../todos.ts'

export function buildInitPrompt(context: { userGoal: string; burst: Burst; diff: string }): string {
  const { burst, diff } = context
  // Prefix-aligned structure: static instructions & user goal first, dynamic turn details at tail
  const lines = [
    '[TASK CONTEXT]',
    `User Goal: ${context.userGoal || '(infer from actions below)'}`,
    '',
    '[INSTRUCTIONS]',
    'Extract 2 to 6 concrete, verifiable engineering todo items in execution order (`initTasks` array).',
    'If any step is ALREADY fully implemented/verified by the completed tool actions below, list its 1-based ID (e.g. "#1") in `completedTasks`.',
    "Output ONLY raw JSON starting with '{' and ending with '}':",
    '{"initTasks": ["step 1", "step 2"], "completedTasks": ["#1"], "milestoneSummary": null, "exportedSymbolsChanged": []}',
    '',
    '[TURN 1 DELTA]',
  ]
  if (burst.assistantNotes.length > 0) {
    lines.push('Main Agent Turn Summary & Findings:', ...burst.assistantNotes)
  }
  if (burst.readEvidence.length > 0) {
    lines.push('Investigated files & symbols read in this turn:', ...bullets(burst.readEvidence))
  }
  if (burst.toolActions.length > 0) {
    lines.push('Completed tool actions in this turn:', ...bullets(burst.toolActions))
  }
  if (burst.touchedFiles.size > 0) {
    lines.push(`Modified files in this turn: ${[...burst.touchedFiles].join(', ')}`)
  }
  if (diff.trim()) {
    lines.push('On-disk git diff snippet:', '```diff', diff.trim().slice(0, 2000), '```')
  }
  return lines.join('\n')
}

export function buildDeltaPrompt(context: {
  userGoal: string
  phases: readonly TodoPhase[]
  turnLedger: readonly string[]
  cumulativeReadFiles: ReadonlySet<string>
  cumulativeTouchedFiles: ReadonlySet<string>
  burst: Burst
  diff: string
}): string {
  const { burst, diff } = context
  const tasks = allTasks(context.phases)
  const burstFiles = [...burst.touchedFiles]
  const openList = tasks
    .filter(isOpen)
    .map(task => `${task.id} [${task.status}]: ${task.content}`)
    .join('\n')
  // Prefix-aligned structure: the static context is identical across delta calls and the ledger only grows
  const sections = [
    '[STATIC TASK CONTEXT]',
    `Original User Goal: ${context.userGoal || '(see plan below)'}`,
    'Master Todo Plan:',
    tasks.map(task => `${task.id}: ${task.content}`).join('\n'),
    '',
    '[EVALUATION RULES]',
    '1. Mark an open item in `completedTasks` (by ID like "#1") ONLY if every function/requirement named in that item is implemented and verified in the code/actions below.',
    "2. For investigation/analysis/audit items (e.g. 'Analyze X', 'Locate root cause'), mark completed ONLY if the target files were read AND the 'Main Agent Latest Turn Notes' below contain the concrete analytical conclusion/findings (or the agent has already moved on to implementing the fix).",
    '3. Never mark a test/verification item completed if the test command has not run yet or failed.',
    '4. If the user added new requirements, list in `appendTasks`; if an item is obsolete, list in `dropTasks`.',
    '5. If shared exports/signatures changed or a key investigation finding affects peers, write a 1-sentence `milestoneSummary` and list `exportedSymbolsChanged`.',
    "6. Output ONLY raw JSON starting with '{' and ending with '}':",
    '{"completedTasks": ["#1"], "appendTasks": [], "dropTasks": [], "milestoneSummary": null, "exportedSymbolsChanged": []}',
  ]
  if (context.turnLedger.length > 0) {
    sections.push('', '[PAST TURN LEDGER]', ...context.turnLedger)
  }
  sections.push(
    '',
    '[CURRENT BURST DELTA]',
    `Open Todo Items:\n${openList || '(none)'}`,
    `Investigated/Read files so far: ${[...context.cumulativeReadFiles].join(', ') || '(none)'}`,
    `Modified files in this burst: ${burstFiles.length > 0 ? burstFiles.join(', ') : '(none)'} (cumulative: ${
      [...context.cumulativeTouchedFiles].join(', ') || 'none'
    })`,
  )
  if (burst.readEvidence.length > 0) {
    sections.push('Files & symbols inspected in this burst:', ...bullets(burst.readEvidence))
  }
  if (burst.assistantNotes.length > 0) {
    sections.push('Main Agent Latest Turn Notes & Analytical Findings:', ...burst.assistantNotes)
  }
  if (burst.toolActions.length > 0) {
    sections.push('Executed tool actions in this burst:', ...bullets(burst.toolActions))
  }
  if (diff.trim()) {
    sections.push('On-disk git diff snippet:', '```diff', diff.trim().slice(0, 3000), '```')
  }
  return sections.join('\n')
}

function bullets(items: readonly string[]): string[] {
  return items.map(item => `- ${item}`)
}
