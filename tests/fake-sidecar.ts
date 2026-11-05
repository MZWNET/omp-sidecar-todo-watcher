import type { ModelTokenUsage } from '../src/watcher/telemetry.ts'
import type { SidecarRequest, SidecarRunner } from '../src/watcher/watcher.ts'

export const zeroUsage: ModelTokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { total: 0 },
}

/** A detached sidecar that answers each call with the next reply (JSON-encoded unless a string), serves replayed exchanges from its prompt cache, and records the requests it was sent */
export function fakeSidecar(...replies: Array<object | string>): { runner: SidecarRunner; requests: SidecarRequest[] } {
  const requests: SidecarRequest[] = []
  const runner: SidecarRunner = async ({ transcript, prompt }) => {
    requests.push({ transcript: [...transcript], prompt })
    const reply = replies.shift() ?? {}
    return {
      replyText: typeof reply === 'string' ? reply : JSON.stringify(reply),
      mode: 'detached-smol',
      modelId: 'test/sidecar',
      usage: { ...zeroUsage, cacheRead: transcript.length > 0 ? 1024 : 0 },
    }
  }
  return { runner, requests }
}
