import * as v from 'valibot'
import { collapseWhitespace, countLeadingDigits } from './text.ts'

const todoStatusSchema = v.picklist(['pending', 'in_progress', 'completed', 'abandoned', 'blocked'])

export type TodoStatus = v.InferOutput<typeof todoStatusSchema>

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  blocker?: string
}

export interface TodoPhase {
  name: string
  tasks: TodoItem[]
}

/** Todo phases persisted outside this process: session entries, omp's `todo` tool, the peer database */
export const todoPhasesSchema = v.array(
  v.object({
    name: v.string(),
    tasks: v.array(
      v.object({
        content: v.string(),
        status: todoStatusSchema,
        blocker: v.optional(v.string()),
      }),
    ),
  }),
)

export type TodoPhaseDraft = v.InferOutput<typeof todoPhasesSchema>[number]

/**
 * Enforces the Single-Active-Task Invariant (matching omp's `normalizeInProgressTask`):
 * - At most one task across all phases is `in_progress`.
 * - If none is `in_progress`, the first `pending` task is promoted to `in_progress`.
 * - Assigns stable `#1`, `#2`, ... IDs to every item.
 */
export function normalizePhases(phases: readonly TodoPhaseDraft[]): TodoPhase[] {
  let nextId = 1
  let hasActiveTask = false
  const normalized = phases
    .map(phase => ({
      name: phase.name.trim() || 'Tasks',
      tasks: phase.tasks.flatMap(task => {
        const content = task.content.trim()
        if (!content) return []
        let status = task.status
        if (status === 'in_progress') {
          if (hasActiveTask) status = 'pending'
          hasActiveTask = true
        }
        const blocker = task.blocker ?? ''
        return [{ id: `#${nextId++}`, content, status, ...(blocker ? { blocker } : {}) }]
      }),
    }))
    .filter(phase => phase.tasks.length > 0)

  if (!hasActiveTask) {
    const firstPending = allTasks(normalized).find(task => task.status === 'pending')
    if (firstPending) firstPending.status = 'in_progress'
  }
  return normalized
}

export function allTasks(phases: readonly TodoPhase[]): TodoItem[] {
  return phases.flatMap(phase => phase.tasks)
}

/** Tasks the stop gate waits for */
export function isIncomplete(task: TodoItem): boolean {
  return task.status === 'pending' || task.status === 'in_progress'
}

/** Tasks the sidecar may still complete or drop */
export function isOpen(task: TodoItem): boolean {
  return task.status !== 'completed' && task.status !== 'abandoned'
}

/**
 * Matches a task identifier (`"#1"`, `"1"`, or task content) against a todo item.
 */
export function matchesTodo(task: TodoItem, token: string): boolean {
  const clean = token.trim()
  if (!clean) return false
  if (clean === task.id || `#${clean}` === task.id) return true
  const taskText = collapseWhitespace(task.content).toLowerCase()
  const tokenText = collapseWhitespace(withoutTaskId(clean)).toLowerCase()
  if (!tokenText) return false
  return taskText === tokenText || (tokenText.length >= 6 && taskText.includes(tokenText))
}

/** Drops a leading task ID such as `#3:` so the rest of the token can match a task's content */
function withoutTaskId(token: string): string {
  const digitCount = countLeadingDigits(token.slice(1))
  if (!token.startsWith('#') || digitCount === 0) return token
  const rest = token.slice(1 + digitCount).trimStart()
  return ([':', '.', '-'].includes(rest.charAt(0)) ? rest.slice(1) : rest).trimStart()
}
