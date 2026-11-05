import * as v from 'valibot'

const nonBlankStrings = v.fallback(
  v.optional(
    v.pipe(
      v.array(v.unknown()),
      v.transform(items => items.filter((item): item is string => typeof item === 'string' && item.trim() !== '')),
    ),
  ),
  undefined,
)

const verdictSchema = v.pipe(
  v.string(),
  v.parseJson(),
  v.object({
    /** Initial tasks extracted on Turn 1 when no todo list exists yet */
    initTasks: nonBlankStrings,
    /** Task IDs (#1, #2) or task contents completed in this write-burst */
    completedTasks: nonBlankStrings,
    /** Newly discovered or user-added tasks to append to the active phase */
    appendTasks: nonBlankStrings,
    /** Obsolete tasks (by ID or content) to mark as abandoned */
    dropTasks: nonBlankStrings,
    /** Concise 1-line technical summary of interface/behavior changes for peer agents (null if internal-only) */
    milestoneSummary: v.fallback(v.optional(v.nullable(v.string())), undefined),
    /** Exported function/type/class symbols added or modified in this write-burst */
    exportedSymbolsChanged: nonBlankStrings,
  }),
)

export type SidecarVerdict = v.InferOutput<typeof verdictSchema>

/** Parses the JSON object in the sidecar's reply, tolerating surrounding prose or markdown code fences */
export function parseSidecarVerdict(replyText: string): SidecarVerdict | undefined {
  const json = replyText.slice(replyText.indexOf('{'), replyText.lastIndexOf('}') + 1)
  const result = v.safeParse(verdictSchema, json)
  return result.success ? result.output : undefined
}
