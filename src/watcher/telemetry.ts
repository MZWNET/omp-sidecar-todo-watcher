export type SidecarMode = 'detached-smol' | 'ephemeral-shared-cache'

export interface ModelTokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: { total: number }
}

export interface SidecarUsageTelemetry {
  calls: number
  mode: SidecarMode | 'mixed'
  lastModelId?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  totalCostUsd: number
  cacheHitRate: number
  perCallLog: Array<{
    callIndex: number
    kind: 'init' | 'delta'
    mode: SidecarMode
    modelId: string
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    totalTokens: number
    cacheHitRate: number
    costUsd: number
    durationMs: number
  }>
}

export function createUsageTelemetry(): SidecarUsageTelemetry {
  return {
    calls: 0,
    mode: 'ephemeral-shared-cache',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    cacheHitRate: 0,
    perCallLog: [],
  }
}

export function recordSidecarCall(
  telemetry: SidecarUsageTelemetry,
  call: {
    kind: 'init' | 'delta'
    mode: SidecarMode
    modelId: string
    usage: ModelTokenUsage
    durationMs: number
  },
): void {
  const { input, output, cacheRead, cacheWrite } = call.usage
  const totalTokens = call.usage.totalTokens || input + output + cacheRead + cacheWrite
  const costUsd = call.usage.cost.total

  telemetry.calls++
  telemetry.lastModelId = call.modelId
  telemetry.mode = telemetry.calls === 1 || telemetry.mode === call.mode ? call.mode : 'mixed'
  telemetry.inputTokens += input
  telemetry.outputTokens += output
  telemetry.cacheReadTokens += cacheRead
  telemetry.cacheWriteTokens += cacheWrite
  telemetry.totalTokens += totalTokens
  telemetry.totalCostUsd += costUsd
  telemetry.cacheHitRate = cacheHitRate(
    telemetry.cacheReadTokens,
    telemetry.inputTokens + telemetry.cacheReadTokens + telemetry.cacheWriteTokens,
  )
  telemetry.perCallLog.push({
    callIndex: telemetry.calls,
    kind: call.kind,
    mode: call.mode,
    modelId: call.modelId,
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens,
    cacheHitRate: cacheHitRate(cacheRead, input + cacheRead + cacheWrite),
    costUsd,
    durationMs: Math.round(call.durationMs),
  })
}

function cacheHitRate(cacheReadTokens: number, promptTokens: number): number {
  return promptTokens > 0 ? cacheReadTokens / promptTokens : 0
}
