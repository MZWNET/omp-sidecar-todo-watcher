import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it, onTestFinished } from 'vitest'
import { PeerSyncBroker } from '../../src/peer-sync/broker.ts'

function openBrokerFile(): { broker: PeerSyncBroker; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'peer-sync-'))
  const dbPath = join(root, '.omp', 'peer-sync.sqlite')
  const broker = new PeerSyncBroker(dbPath, '/repo')
  onTestFinished(() => {
    broker.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { broker, dbPath }
}

describe('peerSyncBroker', () => {
  it('keeps the coordination database readable by its owner only', () => {
    const { broker, dbPath } = openBrokerFile()
    broker.registerPeer('peer-a')

    expect(statSync(join(dbPath, '..')).mode & 0o777).toBe(0o700)
    expect(statSync(dbPath).mode & 0o777).toBe(0o600)
    expect(statSync(`${dbPath}-wal`).mode & 0o777).toBe(0o600)
  })

  it('prunes peers whose process has exited', () => {
    const { broker, dbPath } = openBrokerFile()
    const crashedPeer = spawnSync(process.execPath, [
      join(import.meta.dirname, 'register-peer.ts'),
      dbPath,
      'peer-crashed',
    ])
    expect(crashedPeer.status).toBe(0)

    broker.registerPeer('peer-alive')

    expect(broker.listOtherPeers('observer').map(peer => peer.peerId)).toEqual(['peer-alive'])
  })
})
