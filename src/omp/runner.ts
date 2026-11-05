import type { SidecarReply, SidecarRequest, SidecarRunner } from '../watcher/watcher.ts'
import type { OmpExtensionContext, OmpResolvedModel } from './api.ts'
import type { AssistantMessage, completeSimple, Usage, UserMessage } from '@oh-my-pi/pi-ai'
import * as v from 'valibot'
import { sidecarInstructions } from '../watcher/prompts.ts'

export const watcherModeSchema = v.picklist(['auto', 'detached', 'ephemeral'])

export type WatcherMode = v.InferOutput<typeof watcherModeSchema>

export interface SidecarSettings {
  modelSpec: string | undefined
  mode: WatcherMode
}

const detachedModelSpecs = [
  '@smol',
  '@tiny',
  '@commit',
  'gemini-3.8-flash',
  'deepseek-v4.1-flash',
  'deepseek-flash',
  'claude-haiku-4-5',
]

const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
}

export function isWatcherMode(value: string): value is WatcherMode {
  return v.is(watcherModeSchema, value)
}

/** The cheap model for the Detached Micro-Judge, or undefined when the watcher must use the session model */
export function resolveDetachedModel(
  ctx: OmpExtensionContext,
  settings: SidecarSettings,
): OmpResolvedModel | undefined {
  if (settings.mode === 'ephemeral') return undefined
  const specs = settings.modelSpec === undefined ? detachedModelSpecs : [settings.modelSpec, ...detachedModelSpecs]
  for (const spec of specs) {
    const model = ctx.models.resolve(spec)
    if (model) return model
  }
  return undefined
}

/** Prefers a Detached Micro-Judge on a cheap/fast model (@smol / @tiny / deepseek-flash) and, outside `detached` mode, falls back to a Shared-Cache Ephemeral Turn on the active session model */
export function createSidecarRunner(ctx: OmpExtensionContext, settings: SidecarSettings): SidecarRunner {
  return async (request, signal) => {
    const model = resolveDetachedModel(ctx, settings)
    if (model) {
      // In auto mode a transport error on the detached path falls through to the ephemeral turn
      const reply = await askDetached(ctx, model, request, signal).catch(error => {
        if (settings.mode === 'detached') throw error
        return undefined
      })
      if (reply) return reply
    }
    if (settings.mode === 'detached') throw new Error('No detached sidecar model replied')
    if (!ctx.runEphemeralTurn) throw new Error('No sidecar watcher runner available')
    const { replyText, assistantMessage } = await ctx.runEphemeralTurn({
      promptText: `${sidecarInstructions}\n\n${request.prompt}`,
      minimizeEffort: true,
      signal,
    })
    return {
      replyText,
      mode: 'ephemeral-shared-cache',
      modelId: `${assistantMessage.provider}/${assistantMessage.model}`,
      usage: assistantMessage.usage,
    }
  }
}

async function askDetached(
  ctx: OmpExtensionContext,
  model: OmpResolvedModel,
  request: SidecarRequest,
  signal: AbortSignal | undefined,
): Promise<SidecarReply | undefined> {
  const complete = await loadCompleteSimple()
  const apiKey = await ctx.modelRegistry.getApiKey(model)
  if (!complete || apiKey === undefined || apiKey === '') return undefined
  const headers = await ctx.modelRegistry.resolveModelHeaders(model, signal)
  const cacheKey = `${ctx.sessionManager.getSessionId()}:detached-watcher`
  const message = await complete(
    model,
    {
      systemPrompt: sidecarInstructions,
      messages: [
        ...request.transcript.flatMap(exchange => [
          userMessage(exchange.prompt),
          assistantMessage(model, exchange.replyText),
        ]),
        userMessage(request.prompt),
      ],
    },
    {
      apiKey,
      headers,
      sessionId: cacheKey,
      promptCacheKey: cacheKey,
      temperature: 0,
      disableReasoning: true,
      forceReasoningOff: true,
      signal,
    },
  )
  // completeSimple resolves with whatever streamed before an abort instead of rejecting
  signal?.throwIfAborted()
  // Kept untrimmed so the replayed reply renders exactly as the model wrote it
  const replyText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n')
  if (!replyText.trim()) return undefined
  return {
    replyText,
    mode: 'detached-smol',
    modelId: `${message.provider}/${message.model}`,
    usage: message.usage,
  }
}

function userMessage(text: string): UserMessage {
  return { role: 'user', content: [{ type: 'text', text }], timestamp: Date.now() }
}

/** An earlier reply in the form pi-ai returns one from `model` */
function assistantMessage(model: OmpResolvedModel, text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage,
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

let completeSimplePromise: Promise<typeof completeSimple | undefined> | undefined

async function loadCompleteSimple(): Promise<typeof completeSimple | undefined> {
  // Imported lazily because only omp provides this module; omp rewrites the literal specifier while loading the extension
  completeSimplePromise ??= import('@oh-my-pi/pi-ai').then(
    piAi => piAi.completeSimple,
    () => undefined,
  )
  return completeSimplePromise
}
