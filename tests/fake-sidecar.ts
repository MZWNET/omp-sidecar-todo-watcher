import type { ModelTokenUsage } from '../src/watcher/telemetry.ts'
import type { SidecarRunner } from '../src/watcher/watcher.ts'

export const zeroUsage: ModelTokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { total: 0 },
}

/** A sidecar that answers each call with the next reply (JSON-encoded unless a string) and records its prompts */
export function fakeSidecar(...replies: Array<object | string>): { runner: SidecarRunner; prompts: string[] } {
  const prompts: string[] = []
  const runner: SidecarRunner = async promptText => {
    prompts.push(promptText)
    const reply = replies.shift() ?? {}
    return {
      replyText: typeof reply === 'string' ? reply : JSON.stringify(reply),
      mode: 'ephemeral-shared-cache',
      modelId: 'test/sidecar',
      usage: zeroUsage,
    }
  }
  return { runner, prompts }
}
