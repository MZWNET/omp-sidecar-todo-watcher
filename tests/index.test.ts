import type { completeSimple } from '@oh-my-pi/pi-ai'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { sidecarInstructions } from '../src/watcher/prompts.ts'
import { createFakeOmp } from './fake-omp.ts'

// Only omp provides this module
const { complete } = vi.hoisted(() => ({ complete: vi.fn<typeof completeSimple>() }))
vi.mock('@oh-my-pi/pi-ai', () => ({ completeSimple: complete }))

function detachedReply(text: string): Awaited<ReturnType<typeof completeSimple>> {
  return {
    model: 'deepseek-flash',
    provider: 'deepseek',
    content: [{ type: 'text', text }],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
}

describe('sidecar todo watcher extension', () => {
  it('runs the omp lifecycle: plan extraction, checkoff, slash commands, and auto-reset', async () => {
    const omp = createFakeOmp({ gitDiff: "+export const API_KEY = 'sk-1234567890abcdefghijklmnop';\n" })

    await omp.emit('session_start', {})
    expect(omp.activeTools).toEqual(['read', 'edit', 'bash'])

    omp.sidecarReplies.push('{"initTasks": ["Step 1: Create config", "Step 2: Verify config"]}')
    await omp.emit('turn_end', { message: { content: [] } })
    await vi.waitFor(() => expect(omp.widget?.[0]).toContain('0/2 done · Active (#1): Step 1: Create config'))
    expect(omp.entries).toHaveLength(1)

    omp.sidecarReplies.push('{"completedTasks": ["#1"], "milestoneSummary": "Created config.ts"}')
    await omp.emit('tool_result', { toolName: 'write', input: { path: 'src/config.ts' }, content: [], isError: false })
    await omp.emit('tool_result', { toolName: 'bash', input: { command: 'bun test' }, content: [], isError: false })
    await omp.emit('turn_end', { message: { content: [] } })
    await vi.waitFor(() => expect(omp.widget?.[0]).toContain('1/2 done · Active (#2): Step 2: Verify config'))
    // The session model never sees the sidecar transcript, so each ephemeral turn restates the list
    expect(omp.prompts[1]).toContain('Todo List:\n#1 [in_progress]: Step 1: Create config')
    expect(omp.prompts[1]).toContain("+export const API_KEY = '[REDACTED]'")
    expect(omp.prompts[1]).not.toContain('sk-1234567890')

    const nextToolResult = await omp.emit('tool_result', {
      toolName: 'read',
      input: { path: 'src/config.ts' },
      content: [],
      isError: false,
    })
    expect(nextToolResult?.additionalContext).toContain('Sidecar Watcher marked completed: "Step 1: Create config"')

    await omp.command('add Step 3: Update docs')
    expect(omp.widget?.[0]).toContain('1/3 done')
    await omp.command('done #2')
    expect(omp.widget?.[0]).toContain('2/3 done · Active (#3): Step 3: Update docs')
    await omp.command('done #3')
    expect(omp.widget?.[0]).toContain('3/3 done · All complete ✓')

    await omp.emit('input', { text: 'Start next feature' })
    expect(omp.widget).toBeUndefined()
  })

  it('replays earlier exchanges to the detached model before each new prompt', async () => {
    const omp = createFakeOmp({
      detachedModel: { id: 'deepseek-flash', provider: 'deepseek', api: 'openai-completions' },
    })
    const initReply = '{"initTasks": ["Step 1: Create config", "Step 2: Verify config"]}'
    complete.mockResolvedValueOnce(detachedReply(initReply))
    complete.mockResolvedValueOnce(detachedReply('{"completedTasks": ["#1"]}'))

    await omp.emit('session_start', {})
    await omp.emit('turn_end', { message: { content: [] } })
    await vi.waitFor(() => expect(omp.entries).toHaveLength(1))
    await omp.emit('tool_result', { toolName: 'write', input: { path: 'src/config.ts' }, content: [], isError: false })
    await omp.emit('turn_end', { message: { content: [] } })
    await vi.waitFor(() => expect(complete).toHaveBeenCalledTimes(2))

    const [opening, followUp] = complete.mock.calls.map(([, context]) => context)
    expect(followUp?.systemPrompt).toBe(sidecarInstructions)
    expect(followUp?.messages.map(message => [message.role, message.content[0]?.text])).toEqual([
      ['user', opening?.messages[0]?.content[0]?.text],
      ['assistant', initReply],
      ['user', expect.stringContaining('Modified files: src/config.ts')],
    ])
    expect(omp.prompts).toHaveLength(0)
  })

  it('restores the list saved at the branch point it navigates back to', async () => {
    const omp = createFakeOmp()
    await omp.emit('session_start', {})
    omp.sidecarReplies.push('{"initTasks": ["Step 1: Create config", "Step 2: Verify config"]}')
    await omp.emit('turn_end', { message: { content: [] } })
    await vi.waitFor(() => expect(omp.entries).toHaveLength(1))
    await omp.command('done #1')

    omp.entries.splice(1)
    await omp.emit('session_tree', {})

    expect(omp.widget?.[0]).toContain('0/2 done · Active (#1): Step 1: Create config')
  })

  it('drops the pending pass of a session that another session replaces', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const omp = createFakeOmp()
    await omp.emit('session_start', {})
    omp.sidecarReplies.push('{"initTasks": ["Step 1: Create config"]}')
    await omp.emit('turn_end', { message: { content: [] } })

    omp.sessionId = 'session-beta-002'
    await omp.emit('session_switch', {})
    await vi.runAllTimersAsync()

    expect(omp.prompts).toHaveLength(0)
    expect(omp.entries).toHaveLength(0)
  })

  it('reads the declarations in tool output line by line', async () => {
    const omp = createFakeOmp()
    await omp.emit('session_start', {})
    await omp.emit('tool_result', {
      toolName: 'read',
      input: { path: 'src/session.ts' },
      content: [{ type: 'text', text: '1: import { ttl } from "./config"\n2: export class SessionStore {}' }],
      isError: false,
    })
    omp.sidecarReplies.push('{"initTasks": ["Fix the session expiry"]}')
    await omp.emit('turn_end', { message: { content: [] } })
    await vi.waitFor(() => expect(omp.prompts).toHaveLength(1))

    expect(omp.prompts[0]).toContain('read(src/session.ts) -> symbols=[export class SessionStore {}]')
  })

  it('scrubs secrets from tool output and assistant text before cutting them down', async () => {
    const omp = createFakeOmp()
    await omp.emit('session_start', {})
    await omp.emit('tool_result', {
      toolName: 'bash',
      input: { command: 'cat token.txt' },
      content: [{ type: 'text', text: `ghp_${'a'.repeat(300)}` }],
      isError: false,
    })
    omp.sidecarReplies.push('{"initTasks": ["Rotate the token"]}')
    await omp.emit('turn_end', {
      message: { content: [{ type: 'text', text: `${'x'.repeat(880)} ghp_${'b'.repeat(40)}` }] },
    })
    await vi.waitFor(() => expect(omp.prompts).toHaveLength(1))

    expect(omp.prompts[0]).not.toContain('aaaa')
    expect(omp.prompts[0]).not.toContain('ghp_b')
  })

  it('never falls back to the session model in detached mode', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const omp = createFakeOmp()
    await omp.emit('session_start', {})
    await omp.command('mode detached')
    await omp.emit('turn_end', { message: { content: [] } })
    await vi.runAllTimersAsync()

    expect(omp.prompts).toHaveLength(0)
  })

  it('leaves read-only subagents and sessions without write tools unmanaged', async () => {
    const scout = createFakeOmp({ agent: { kind: 'sub', id: '0-Scout', name: 'scout' } })
    await scout.emit('session_start', {})
    expect(scout.activeTools).toContain('todo')

    const reader = createFakeOmp({ activeTools: ['read', 'grep', 'todo'] })
    await reader.emit('session_start', {})
    expect(reader.activeTools).toContain('todo')
  })
})
