import type { SidecarRunner } from '../../src/watcher/watcher.ts'
import { describe, expect, it, onTestFinished } from 'vitest'
import { PeerSyncBroker } from '../../src/peer-sync/broker.ts'
import { SidecarTodoWatcher } from '../../src/watcher/watcher.ts'
import { fakeSidecar, zeroUsage } from '../fake-sidecar.ts'

function createBroker(): PeerSyncBroker {
  const broker = new PeerSyncBroker(':memory:', '/repo')
  onTestFinished(() => broker.close())
  return broker
}

/** A watcher whose list holds `tasks` as pending todos, the first one active */
function createWatcher(broker: PeerSyncBroker, peerId: string, tasks: string[] = []): SidecarTodoWatcher {
  const watcher = new SidecarTodoWatcher(peerId, broker)
  watcher.restore([{ name: 'Tasks', tasks: tasks.map(content => ({ content, status: 'pending' })) }])
  return watcher
}

describe('sidecarTodoWatcher', () => {
  it('extracts the initial plan on Turn 1 and activates its first task', async () => {
    const watcher = createWatcher(createBroker(), 'peer-backend')
    watcher.onToolResult({ toolName: 'read', input: { path: 'src/schema.ts' }, isError: false })

    const sidecar = fakeSidecar({
      initTasks: [
        'Define UserRole enum in src/schema.ts',
        'Implement role validation middleware in src/auth.ts',
        'Add unit tests for role validation',
      ],
    })
    expect(await watcher.runPass(sidecar.runner)).toBe(true)

    expect(watcher.phases[0]?.tasks).toEqual([
      { id: '#1', content: 'Define UserRole enum in src/schema.ts', status: 'in_progress' },
      { id: '#2', content: 'Implement role validation middleware in src/auth.ts', status: 'pending' },
      { id: '#3', content: 'Add unit tests for role validation', status: 'pending' },
    ])
  })

  it('skips the sidecar on read-only bursts and consults it after an edit', async () => {
    const watcher = createWatcher(createBroker(), 'peer-backend', ['Define UserRole enum in src/schema.ts'])
    const sidecar = fakeSidecar({ completedTasks: [] })

    watcher.onToolResult({ toolName: 'read', input: { path: 'src/schema.ts' }, isError: false })
    expect(await watcher.runPass(sidecar.runner)).toBe(false)
    expect(sidecar.requests).toHaveLength(0)

    watcher.onToolResult({
      toolName: 'edit',
      input: {
        input:
          "*** Begin Patch\n*** Update File: src/schema.ts\n@@\n+export type UserRole = 'admin' | 'member';\n*** End Patch",
      },
      isError: false,
    })
    await watcher.runPass(sidecar.runner)
    expect(sidecar.requests[0]?.prompt).toContain('Modified files: src/schema.ts')
  })

  it('sends each later pass as a follow-up to the exchanges before it', async () => {
    const watcher = createWatcher(createBroker(), 'peer-calc', ['Implement add in src/calc.ts', 'Run bun test'])
    const sidecar = fakeSidecar('{"completedTasks": ["#1"]}', { completedTasks: ['#2'] })

    watcher.onToolResult({
      toolName: 'write',
      input: { path: 'src/calc.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
      isError: false,
    })
    await watcher.runPass(sidecar.runner)
    watcher.onToolResult({ toolName: 'bash', input: { command: 'bun test' }, output: '1 pass', isError: false })
    await watcher.runPass(sidecar.runner)

    const [opening, followUp] = sidecar.requests
    expect(opening?.transcript).toEqual([])
    expect(followUp?.transcript).toEqual([{ prompt: opening?.prompt, replyText: '{"completedTasks": ["#1"]}' }])
    expect(followUp?.prompt).not.toContain('User Goal')
    expect(followUp?.prompt).not.toContain('Implement add in src/calc.ts')
    expect(followUp?.prompt).toContain('Open Todo Items:\n#2 [in_progress]: Run bun test')
    expect(followUp?.prompt).toContain('bash("bun test") -> ok (exit 0)')
  })

  it('starts the transcript over once the provider serves none of a replay from its cache', async () => {
    const watcher = createWatcher(createBroker(), 'peer-uncached', ['Step A', 'Step B', 'Step C'])
    const sidecar = fakeSidecar({}, {}, {})
    const uncachedRunner: SidecarRunner = async request => ({ ...(await sidecar.runner(request)), usage: zeroUsage })

    for (const path of ['src/a.ts', 'src/b.ts', 'src/c.ts']) {
      watcher.onToolResult({ toolName: 'edit', input: { path }, isError: false })
      await watcher.runPass(uncachedRunner)
    }

    expect(sidecar.requests.map(request => request.transcript.length)).toEqual([0, 1, 0])
    expect(sidecar.requests[2]?.prompt).toContain('Modified files so far: src/a.ts, src/b.ts, src/c.ts')
  })

  it('starts the transcript over once it outgrows its budget', async () => {
    const watcher = createWatcher(createBroker(), 'peer-long', ['Step A', 'Step B'])
    const sidecar = fakeSidecar({ milestoneSummary: 'x'.repeat(100_000) }, {})

    watcher.onToolResult({ toolName: 'edit', input: { path: 'src/a.ts' }, isError: false })
    await watcher.runPass(sidecar.runner)
    watcher.onToolResult({ toolName: 'edit', input: { path: 'src/b.ts' }, isError: false })
    await watcher.runPass(sidecar.runner)

    expect(sidecar.requests[1]?.transcript).toEqual([])
    expect(sidecar.requests[1]?.prompt).toContain('Modified files so far: src/a.ts, src/b.ts')
  })

  it("applies the sidecar's completions, drops, and additions and advances the active task", async () => {
    const watcher = createWatcher(createBroker(), 'peer-alive', ['Step A', 'Obsolete Step B'])
    watcher.onToolResult({ toolName: 'edit', input: { path: 'src/a.ts' }, isError: false })

    const sidecar = fakeSidecar({
      completedTasks: ['#1'],
      dropTasks: ['#2'],
      appendTasks: ['Step C: Add rate limiter'],
    })
    expect(await watcher.runPass(sidecar.runner)).toBe(true)

    expect(watcher.phases[0]?.tasks).toEqual([
      { id: '#1', content: 'Step A', status: 'completed' },
      { id: '#2', content: 'Obsolete Step B', status: 'abandoned' },
      { id: '#3', content: 'Step C: Add rate limiter', status: 'in_progress' },
    ])
  })

  it('routes milestone notices only to peers that read the touched files, once', async () => {
    const broker = createBroker()
    const backend = createWatcher(broker, 'backend', [
      'Update UserSchema in src/shared/schema.ts',
      'Update auth endpoint in src/api/auth.ts',
    ])
    const frontend = createWatcher(broker, 'frontend', ['Build user profile form using src/shared/schema.ts'])
    const docs = createWatcher(broker, 'docs', ['Document the release'])
    frontend.onToolResult({ toolName: 'read', input: { path: '/repo/src/shared/schema.ts:1-50' }, isError: false })
    docs.onToolResult({ toolName: 'read', input: { path: 'docs/guide.md' }, isError: false })

    backend.onToolResult({ toolName: 'edit', input: { path: 'src/shared/schema.ts' }, isError: false })
    const sidecar = fakeSidecar(
      '```json\n{"completedTasks": ["#1"], "milestoneSummary": "Added required `role: UserRole` field to UserSchema in src/shared/schema.ts"}\n```',
    )
    await backend.runPass(sidecar.runner, { gitDiff: '+role: UserRole' })

    expect(sidecar.requests[0]?.prompt).toContain('+role: UserRole')
    expect(backend.activeTask?.id).toBe('#2')

    const notice = frontend.onToolResult({
      toolName: 'read',
      input: { path: 'src/components/ProfileForm.tsx' },
      isError: false,
    })
    expect(notice).toContain('<peer-sync from="@backend"')
    expect(notice).toContain('Added required `role: UserRole` field to UserSchema')
    expect(notice).toContain('zero-ack')
    expect(
      frontend.onToolResult({ toolName: 'read', input: { path: 'src/components/ProfileForm.tsx' }, isError: false }),
    ).toBeUndefined()
    expect(docs.onToolResult({ toolName: 'read', input: { path: 'docs/guide.md' }, isError: false })).toBeUndefined()
  })

  it('announces exported-symbol changes to every peer', async () => {
    const broker = createBroker()
    const backend = createWatcher(broker, 'backend', ['Rename UserSchema'])
    const docs = createWatcher(broker, 'docs', ['Document the release'])

    backend.onToolResult({ toolName: 'write', input: { path: 'src/shared/schema.ts' }, isError: false })
    const sidecar = fakeSidecar({
      completedTasks: ['#1'],
      milestoneSummary: 'Renamed UserSchema to AccountSchema',
      exportedSymbolsChanged: ['AccountSchema'],
    })
    await backend.runPass(sidecar.runner)

    const notice = docs.onToolResult({ toolName: 'read', input: { path: 'docs/guide.md' }, isError: false })
    expect(notice).toContain('symbols="AccountSchema"')
    expect(notice).toContain('Renamed UserSchema to AccountSchema')
  })

  it('warns both peers about concurrent writes to the same file', () => {
    const broker = createBroker()
    const peerA = createWatcher(broker, 'peer-a')
    const peerB = createWatcher(broker, 'peer-b')

    peerA.onToolResult({ toolName: 'edit', input: { path: 'src/router.ts' }, isError: false })
    const warningForB = peerB.onToolResult({ toolName: 'write', input: { path: 'src/router.ts' }, isError: false })
    expect(warningForB).toContain('kind="write_conflict"')
    expect(warningForB).toContain('src/router.ts')

    const warningForA = peerA.onToolResult({ toolName: 'read', input: { path: 'src/router.ts' }, isError: false })
    expect(warningForA).toContain('kind="write_conflict"')
    expect(warningForA).toContain('peer @peer-b')
  })

  it('blocks a premature stop and allows it once a forced pass completes the remaining todos', async () => {
    const watcher = new SidecarTodoWatcher('worker-1', createBroker())
    watcher.restore([
      {
        name: 'Tasks',
        tasks: [
          { content: 'Implement feature', status: 'completed' },
          { content: 'Write regression test', status: 'in_progress' },
        ],
      },
    ])

    expect(await watcher.evaluateStopGate(fakeSidecar().runner)).toContain('[#2] Write regression test')

    watcher.onToolResult({ toolName: 'write', input: { path: 'tests/feature.test.ts' }, isError: false })
    expect(await watcher.evaluateStopGate(fakeSidecar({ completedTasks: ['#2'] }).runner)).toBeUndefined()
    expect(watcher.incompleteTasks).toHaveLength(0)
  })

  it('stops blocking after three attempts so the session can always end', async () => {
    const watcher = createWatcher(createBroker(), 'worker-1', ['Write regression test'])
    const { runner } = fakeSidecar()

    const reasons = []
    for (let attempt = 0; attempt < 4; attempt++) reasons.push(await watcher.evaluateStopGate(runner))

    expect(reasons[2]).toContain('Sidecar Todo Gate (3/3)')
    expect(reasons[3]).toBeUndefined()
  })

  it('archives a finished list and starts a fresh list and transcript on a new prompt (#41359)', async () => {
    const watcher = createWatcher(createBroker(), 'peer-alive', ['Step A'])
    const sidecar = fakeSidecar({ completedTasks: ['#1'] }, { initTasks: ['Add the billing webhook route'] })
    watcher.onToolResult({ toolName: 'edit', input: { path: 'src/a.ts' }, isError: false })
    await watcher.runPass(sidecar.runner)

    expect(watcher.onUserInput('Now build the billing webhook handler')).toEqual({ clearedFinishedList: true })
    expect(watcher.phases).toHaveLength(0)
    expect(watcher.archivedBatches).toEqual([
      [{ name: 'Tasks', tasks: [{ id: '#1', content: 'Step A', status: 'completed' }] }],
    ])

    await watcher.runPass(sidecar.runner)
    expect(sidecar.requests[1]?.transcript).toEqual([])
    expect(sidecar.requests[1]?.prompt).toContain('User Goal: Now build the billing webhook handler')
  })

  it('archives the list a reset clears, but not an empty one', () => {
    const watcher = createWatcher(createBroker(), 'peer-reset', ['Step A'])

    watcher.resetTodos()
    watcher.resetTodos()

    expect(watcher.phases).toHaveLength(0)
    expect(watcher.archivedBatches).toEqual([
      [{ name: 'Tasks', tasks: [{ id: '#1', content: 'Step A', status: 'in_progress' }] }],
    ])
  })

  it('vetoes checking off a verification task after a failed test run', async () => {
    const watcher = createWatcher(createBroker(), 'peer-opt', [
      'Implement add and divide in src/calc.ts',
      'Run bun test and verify all tests pass',
    ])
    watcher.onToolResult({
      toolName: 'write',
      input: { path: 'src/calc.ts', content: 'export function add(a: number, b: number) { return a + b; }' },
      isError: false,
    })
    watcher.onToolResult({
      toolName: 'bash',
      input: { command: 'bun test' },
      output: '1 fail, 0 pass',
      isError: true,
    })

    const sidecar = fakeSidecar({ completedTasks: ['#1', '#2'] })
    await watcher.runPass(sidecar.runner)

    expect(sidecar.requests[0]?.prompt).toContain('bash("bun test") -> FAILED | error: 1 fail, 0 pass')
    expect(watcher.phases[0]?.tasks.map(task => task.status)).toEqual(['completed', 'in_progress'])
  })

  it('holds investigation tasks until the agent reports substantive findings', async () => {
    const watcher = createWatcher(createBroker(), 'peer-investigator', [
      '调研 src/auth.ts 与 src/session.ts 并分析会话过期根因',
      '修复 src/session.ts 中的过期时间计算错误',
    ])

    watcher.onToolResult({
      toolName: 'read',
      input: { path: 'src/auth.ts' },
      output: 'export function verifyToken(token: string) { return true; }',
      isError: false,
    })
    watcher.onTurnEnd([
      { type: 'text', text: '先读一下文件' },
      { type: 'toolCall', name: 'read' },
    ])
    expect(watcher.isPassDue).toBe(false)

    watcher.onUserInput('继续')
    await watcher.runPass(fakeSidecar({ completedTasks: ['#1'] }).runner)
    expect(watcher.activeTask?.id).toBe('#1')

    watcher.onToolResult({
      toolName: 'read',
      input: { path: 'src/session.ts' },
      output: 'export class SessionStore { isExpired(ts: number) { return Date.now() - ts > 1000; } }',
      isError: false,
    })
    const analysis =
      '根因定位完成：对比 src/auth.ts 与 src/session.ts 发现，SessionStore.isExpired 将 TTL 单位秒误作毫秒计算（1000ms），导致会话在 1 秒后即过期。接下来准备修改 src/session.ts。'
    watcher.onTurnEnd([{ type: 'text', text: analysis }])
    expect(watcher.isPassDue).toBe(true)

    const sidecar = fakeSidecar({
      completedTasks: ['#1'],
      milestoneSummary: 'Identified TTL ms/sec unit bug in SessionStore.isExpired',
    })
    await watcher.runPass(sidecar.runner)

    expect(sidecar.requests[0]?.prompt).toContain('symbols=[export class SessionStore')
    expect(sidecar.requests[0]?.prompt).toContain('SessionStore.isExpired')
    expect(watcher.activeTask?.id).toBe('#2')
  })
})
