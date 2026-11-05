import type { TodoPhase } from '../todos.ts'
import type { SQLTagStore } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import * as v from 'valibot'
import { collapseWhitespace } from '../text.ts'
import { todoPhasesSchema } from '../todos.ts'

export type PeerSyncKind = 'milestone_sync' | 'write_conflict' | 'direct_broadcast'

export interface PeerSyncMessage {
  fromPeerId: string
  kind: PeerSyncKind
  completedTask?: string
  summary: string
  touchedFiles: readonly string[]
  exportedSymbols: readonly string[]
}

export interface Milestone {
  fromPeerId: string
  completedTasks: readonly string[]
  summary?: string | null
  touchedFiles: readonly string[]
  exportedSymbols: readonly string[]
}

export interface PeerSnapshot {
  peerId: string
  activeTask: string | null
  completedCount: number
  totalCount: number
}

const stalePeerTtlMs = 15 * 60 * 1000

const storedPhasesSchema = v.fallback(v.pipe(v.string(), v.parseJson(), todoPhasesSchema), [])
const storedStringsSchema = v.fallback(v.pipe(v.string(), v.parseJson(), v.array(v.string())), [])

const schemaSql = `
  CREATE TABLE IF NOT EXISTS peers (
    peer_id TEXT PRIMARY KEY,
    pid INTEGER NOT NULL DEFAULT 0,
    cwd TEXT NOT NULL,
    todos_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS peer_file_access (
    peer_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    access_kind TEXT NOT NULL CHECK (access_kind IN ('read', 'write')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (peer_id, file_path, access_kind)
  );

  CREATE TABLE IF NOT EXISTS peer_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_peer_id TEXT NOT NULL,
    to_peer_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('milestone_sync', 'write_conflict', 'direct_broadcast')),
    completed_task TEXT,
    summary TEXT NOT NULL,
    touched_files_json TEXT NOT NULL,
    exported_symbols_json TEXT NOT NULL,
    dedupe_hash TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_inbox_dedupe
    ON peer_inbox (to_peer_id, dedupe_hash);
`

/**
 * SQLite WAL-backed cross-process broker that coordinates peer sessions:
 * 1. Tracks each peer's PID, heartbeat, ReadSet, WriteSet, and managed TodoPhases;
 * 2. Automatically prunes dead/crashed peer processes (via `process.kill(pid, 0)` + TTL);
 * 3. Detects Read-Set intersections & Write-Write conflicts when a peer completes a milestone;
 * 4. Queues deduplicated, Zero-ACK `<peer-sync>` advisories for injection at the target peer's next tool boundary.
 */
export class PeerSyncBroker {
  readonly cwd: string
  readonly #db: DatabaseSync
  readonly #sql: SQLTagStore

  constructor(dbPath: string, cwd: string) {
    this.cwd = cwd
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 })
    this.#db = new DatabaseSync(dbPath)
    this.#db.exec('PRAGMA journal_mode = WAL;')
    this.#db.exec('PRAGMA busy_timeout = 3000;')
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        chmodSync(`${dbPath}${suffix}`, 0o600)
      } catch {
        // Not created yet, or a filesystem without POSIX permissions
      }
    }
    this.#db.exec(schemaSql)
    this.#sql = this.#db.createTagStore()
  }

  registerPeer(peerId: string): void {
    this.#sql.run`
      INSERT INTO peers (peer_id, pid, cwd, todos_json, updated_at)
      VALUES (${peerId}, ${process.pid}, ${this.cwd}, '[]', ${Date.now()})
      ON CONFLICT(peer_id) DO UPDATE SET
        pid = excluded.pid,
        cwd = excluded.cwd,
        updated_at = excluded.updated_at`
  }

  unregisterPeer(peerId: string): void {
    this.#transaction(() => this.#deletePeer(peerId))
  }

  /** Records repo-relative file paths in the peer's ReadSet or WriteSet, warning both sides of a Write-Write overlap */
  recordFileAccess(peerId: string, filePaths: readonly string[], kind: 'read' | 'write'): void {
    if (filePaths.length === 0) return
    this.#pruneStalePeers()
    const now = Date.now()
    this.#transaction(() => {
      this.registerPeer(peerId)
      for (const filePath of filePaths) {
        this.#sql.run`
          INSERT INTO peer_file_access (peer_id, file_path, access_kind, updated_at)
          VALUES (${peerId}, ${filePath}, ${kind}, ${now})
          ON CONFLICT(peer_id, file_path, access_kind) DO UPDATE SET updated_at = excluded.updated_at`
      }
      if (kind === 'write') this.#warnConcurrentWriters(peerId, filePaths)
    })
  }

  updatePeerTodos(peerId: string, phases: readonly TodoPhase[]): void {
    this.#sql.run`
      INSERT INTO peers (peer_id, pid, cwd, todos_json, updated_at)
      VALUES (${peerId}, ${process.pid}, ${this.cwd}, ${JSON.stringify(phases)}, ${Date.now()})
      ON CONFLICT(peer_id) DO UPDATE SET
        pid = excluded.pid,
        cwd = excluded.cwd,
        todos_json = excluded.todos_json,
        updated_at = excluded.updated_at`
  }

  /** Queues a technical note for every other active peer and returns how many accepted it */
  broadcastPeerNote(fromPeerId: string, note: string): number {
    this.#pruneStalePeers()
    const message: PeerSyncMessage = {
      fromPeerId,
      kind: 'direct_broadcast',
      summary: note,
      touchedFiles: [],
      exportedSymbols: [],
    }
    let queued = 0
    this.#transaction(() => {
      this.registerPeer(fromPeerId)
      for (const toPeerId of this.#otherPeerIds(fromPeerId)) {
        if (this.#enqueue(toPeerId, message)) queued++
      }
    })
    return queued
  }

  /**
   * Called when the Sidecar Watcher marks one or more Todo items completed (or a significant write-burst settles).
   * Routes a `<peer-sync>` notice to every peer whose ReadSet/WriteSet intersects `touchedFiles`,
   * or to all active peers when `exportedSymbols` is non-empty (contract change).
   */
  publishMilestoneSync(milestone: Milestone): void {
    const { fromPeerId, completedTasks, touchedFiles, exportedSymbols } = milestone
    const summaryText = milestone.summary?.trim() ?? ''
    if (!summaryText && completedTasks.length === 0) return
    const summary =
      summaryText ||
      `Completed milestone: ${completedTasks.join('; ')}${
        touchedFiles.length > 0 ? ` (files: ${touchedFiles.join(', ')})` : ''
      }`

    this.#pruneStalePeers()
    this.#transaction(() => {
      this.registerPeer(fromPeerId)
      const accessRows = this.#sql.all`
        SELECT DISTINCT peer_id, file_path FROM peer_file_access WHERE peer_id != ${fromPeerId}` as Array<{
        peer_id: string
        file_path: string
      }>
      const filesByPeer = Map.groupBy(accessRows, row => row.peer_id)
      for (const toPeerId of this.#otherPeerIds(fromPeerId)) {
        const peerFiles = (filesByPeer.get(toPeerId) ?? []).map(row => row.file_path)
        const relevantFiles = filesRelevantToPeer(peerFiles, touchedFiles, exportedSymbols)
        if (!relevantFiles) continue
        this.#enqueue(toPeerId, {
          fromPeerId,
          kind: 'milestone_sync',
          completedTask: completedTasks[0],
          summary,
          touchedFiles: relevantFiles,
          exportedSymbols,
        })
      }
    })
  }

  /**
   * Atomically drains all pending `<peer-sync>` messages for `peerId`.
   * Called at `tool_result` boundary so injection never interrupts an in-flight streaming call.
   */
  drainInbox(peerId: string): PeerSyncMessage[] {
    const rows = this.#sql.all`
      UPDATE peer_inbox SET delivered = 1
      WHERE to_peer_id = ${peerId} AND delivered = 0
      RETURNING id, from_peer_id, kind, completed_task, summary, touched_files_json, exported_symbols_json` as Array<{
      id: number
      from_peer_id: string
      kind: PeerSyncKind
      completed_task: string | null
      summary: string
      touched_files_json: string
      exported_symbols_json: string
    }>
    return rows
      .sort((a, b) => a.id - b.id)
      .map(row => ({
        fromPeerId: row.from_peer_id,
        kind: row.kind,
        completedTask: row.completed_task ?? undefined,
        summary: row.summary,
        touchedFiles: v.parse(storedStringsSchema, row.touched_files_json),
        exportedSymbols: v.parse(storedStringsSchema, row.exported_symbols_json),
      }))
  }

  listOtherPeers(peerId: string): PeerSnapshot[] {
    this.#pruneStalePeers()
    const rows = this.#sql.all`
      SELECT peer_id, todos_json FROM peers WHERE peer_id != ${peerId} ORDER BY updated_at DESC` as Array<{
      peer_id: string
      todos_json: string
    }>
    return rows.map(row => {
      const tasks = v.parse(storedPhasesSchema, row.todos_json).flatMap(phase => phase.tasks)
      return {
        peerId: row.peer_id,
        activeTask: tasks.find(task => task.status === 'in_progress')?.content ?? null,
        completedCount: tasks.filter(task => task.status === 'completed').length,
        totalCount: tasks.length,
      }
    })
  }

  close(): void {
    this.#db.close()
  }

  #pruneStalePeers(): void {
    const now = Date.now()
    const rows = this.#sql.all`SELECT peer_id, pid, updated_at FROM peers` as Array<{
      peer_id: string
      pid: number
      updated_at: number
    }>
    const stalePeerIds = rows
      .filter(row => now - row.updated_at > stalePeerTtlMs || (row.pid > 0 && !isProcessAlive(row.pid)))
      .map(row => row.peer_id)
    if (stalePeerIds.length === 0) return
    this.#transaction(() => {
      for (const peerId of stalePeerIds) this.#deletePeer(peerId)
    })
  }

  #deletePeer(peerId: string): void {
    this.#sql.run`DELETE FROM peers WHERE peer_id = ${peerId}`
    this.#sql.run`DELETE FROM peer_file_access WHERE peer_id = ${peerId}`
    this.#sql.run`DELETE FROM peer_inbox WHERE to_peer_id = ${peerId} AND delivered = 0`
  }

  #otherPeerIds(peerId: string): string[] {
    const rows = this.#sql.all`SELECT peer_id FROM peers WHERE peer_id != ${peerId}` as Array<{ peer_id: string }>
    return rows.map(row => row.peer_id)
  }

  #warnConcurrentWriters(peerId: string, filePaths: readonly string[]): void {
    const rows = this.#sql.all`
      SELECT DISTINCT peer_id, file_path FROM peer_file_access
      WHERE peer_id != ${peerId} AND access_kind = 'write'
        AND file_path IN (SELECT value FROM json_each(${JSON.stringify(filePaths)}))` as Array<{
      peer_id: string
      file_path: string
    }>
    for (const [otherPeerId, otherRows] of Map.groupBy(rows, row => row.peer_id)) {
      const overlappingFiles = otherRows.map(row => row.file_path)
      const fileList = overlappingFiles.join(', ')
      this.#enqueue(otherPeerId, {
        fromPeerId: peerId,
        kind: 'write_conflict',
        summary: `Concurrent write detected on [${fileList}] with peer @${peerId}. Coordinate or re-read before further edits to avoid lost updates.`,
        touchedFiles: overlappingFiles,
        exportedSymbols: [],
      })
      this.#enqueue(peerId, {
        fromPeerId: otherPeerId,
        kind: 'write_conflict',
        summary: `You modified [${fileList}] which peer @${otherPeerId} is also actively editing. Re-read the file or partition responsibilities.`,
        touchedFiles: overlappingFiles,
        exportedSymbols: [],
      })
    }
  }

  /** Returns false when the recipient already received the same notice */
  #enqueue(toPeerId: string, message: PeerSyncMessage): boolean {
    const { fromPeerId, kind, summary } = message
    const normalizedSummary = collapseWhitespace(summary).toLowerCase()
    const dedupeHash = createHash('sha256')
      .update(`${fromPeerId}|${toPeerId}|${kind}|${normalizedSummary}`)
      .digest('hex')
      .slice(0, 32)
    const { changes } = this.#sql.run`
      INSERT INTO peer_inbox (
        from_peer_id, to_peer_id, kind, completed_task, summary,
        touched_files_json, exported_symbols_json, dedupe_hash, delivered, created_at
      ) VALUES (
        ${fromPeerId}, ${toPeerId}, ${kind}, ${message.completedTask ?? null}, ${summary},
        ${JSON.stringify(message.touchedFiles)}, ${JSON.stringify(message.exportedSymbols)}, ${dedupeHash}, 0, ${Date.now()}
      )
      ON CONFLICT (to_peer_id, dedupe_hash) DO NOTHING`
    return Number(changes) > 0
  }

  /** Takes the write lock up front so concurrent peers wait on `busy_timeout` instead of failing to upgrade */
  #transaction(run: () => void): void {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      run()
      this.#db.exec('COMMIT')
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }
}

/** Files a milestone should report to a peer, or undefined when the peer is unaffected */
function filesRelevantToPeer(
  peerFiles: readonly string[],
  touchedFiles: readonly string[],
  exportedSymbols: readonly string[],
): readonly string[] | undefined {
  if (exportedSymbols.length > 0) return touchedFiles
  const sharedFiles = touchedFiles.filter(file => peerFiles.includes(file))
  if (sharedFiles.length > 0) return sharedFiles
  const touchedDirs = touchedFiles.map(file => dirname(file)).filter(dir => dir !== '.')
  const sharesDirectory = peerFiles.some(file => touchedDirs.some(dir => file === dir || file.startsWith(`${dir}/`)))
  return sharesDirectory ? touchedFiles : undefined
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another OS user
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
