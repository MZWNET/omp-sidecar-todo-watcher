// The subset of omp's host-bundled `@oh-my-pi/pi-ai` that the detached sidecar calls
declare module '@oh-my-pi/pi-ai' {
  export function completeSimple(
    model: { id: string; provider: string },
    context: {
      systemPrompt: string
      messages: Array<{
        role: 'user'
        content: Array<{ type: 'text'; text: string }>
        timestamp: number
      }>
    },
    options: {
      apiKey: string
      headers?: Record<string, string>
      sessionId: string
      promptCacheKey: string
      temperature: number
      disableReasoning: boolean
      forceReasoningOff: boolean
      signal?: AbortSignal
    },
  ): Promise<{
    model: string
    provider: string
    content: Array<{ type: string; text?: string }>
    usage: {
      input: number
      output: number
      cacheRead: number
      cacheWrite: number
      totalTokens: number
      cost: { total: number }
    }
  }>
}
