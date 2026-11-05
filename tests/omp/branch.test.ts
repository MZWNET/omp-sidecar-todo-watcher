import { expect, it } from 'vitest'
import { findLatestTodoPhases } from '../../src/omp/branch.ts'

it("finds the newest todo phases on a branch, including omp's own todo tool results", () => {
  const phases = findLatestTodoPhases([
    {
      type: 'custom',
      customType: 'omp-sidecar-todo-watcher.state',
      data: { phases: [{ name: 'Old', tasks: [{ id: '#1', content: 'Old task', status: 'pending' }] }] },
    },
    {
      type: 'message',
      message: {
        role: 'toolResult',
        toolName: 'todo',
        details: { phases: [{ name: 'Restored', tasks: [{ content: 'Restored branch task', status: 'pending' }] }] },
      },
    },
    {
      type: 'message',
      message: { role: 'toolResult', toolName: 'todo', isError: true, details: { phases: [] } },
    },
  ])

  expect(phases).toEqual([{ name: 'Restored', tasks: [{ content: 'Restored branch task', status: 'pending' }] }])
})
