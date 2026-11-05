import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative } from "node:path";

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

export interface ManagedTodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  blocker?: string;
}

export interface ManagedTodoPhase {
  name: string;
  tasks: ManagedTodoItem[];
}

export interface PeerSyncMessage {
  id: number;
  fromPeerId: string;
  toPeerId: string;
  kind: "milestone_sync" | "write_conflict" | "direct_broadcast";
  completedTask?: string;
  summary: string;
  touchedFiles: string[];
  exportedSymbols: string[];
  createdAt: number;
}

export interface PublishMilestoneInput {
  fromPeerId: string;
  completedTasks: string[];
  summary: string | null;
  touchedFiles: string[];
  exportedSymbols?: string[];
}

export interface PeerSnapshot {
  peerId: string;
  pid: number;
  cwd: string;
  activeTask: string | null;
  completedCount: number;
  totalCount: number;
  readFiles: string[];
  writeFiles: string[];
  updatedAt: number;
}

const DEFAULT_STALE_PEER_TTL_MS = 15 * 60 * 1000;

/**
 * Normalizes a file path relative to project root so ReadSet / WriteSet
 * comparisons across peers are deterministic.
 */
export function normalizeRepoPath(cwd: string, rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^['"]|['"]$/g, "").replace(/:.*$/, "");
  if (!trimmed) return "";
  const resolved = isAbsolute(trimmed) ? normalize(trimmed) : normalize(`${cwd}/${trimmed}`);
  const rel = relative(cwd, resolved);
  return rel && !rel.startsWith("..") ? rel : resolved;
}

function isLocalProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another OS user
    if (err && typeof err === "object" && "code" in err && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const val: unknown = JSON.parse(raw);
    return Array.isArray(val) ? val.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function parseTodoPhases(raw: string): ManagedTodoPhase[] {
  try {
    const val: unknown = JSON.parse(raw);
    return coerceTodoPhases(val);
  } catch {
    return [];
  }
}

export function coerceTodoPhases(val: unknown): ManagedTodoPhase[] {
  if (!Array.isArray(val)) return [];
  const phases: ManagedTodoPhase[] = [];
  let seq = 1;
  for (const item of val) {
    if (!item || typeof item !== "object" || !("name" in item) || !("tasks" in item)) continue;
    if (typeof item.name !== "string" || !Array.isArray(item.tasks)) continue;
    const tasks: ManagedTodoItem[] = [];
    for (const t of item.tasks) {
      if (!t || typeof t !== "object" || !("content" in t) || !("status" in t)) continue;
      if (typeof t.content === "string" && typeof t.status === "string") {
        const id = "id" in t && typeof t.id === "string" && t.id ? t.id : `#${seq}`;
        seq++;
        tasks.push({
          id,
          content: t.content,
          status: t.status as TodoStatus,
          ...("blocker" in t && typeof t.blocker === "string" ? { blocker: t.blocker } : {}),
        });
      }
    }
    if (tasks.length > 0) {
      phases.push({ name: item.name, tasks });
    }
  }
  return phases;
}

/**
 * SQLite WAL-backed cross-process broker that coordinates peer sessions:
 * 1. Tracks each peer's PID, heartbeat, ReadSet, WriteSet, and managed TodoPhases;
 * 2. Automatically prunes dead/crashed peer processes (via `process.kill(pid, 0)` + TTL);
 * 3. Detects Read-Set intersections & Write-Write conflicts when a peer completes a milestone;
 * 4. Queues deduplicated, Zero-ACK `<peer-sync>` advisories for injection at the target peer's next tool boundary.
 */
export class PeerSyncBroker {
  readonly db: Database;
  readonly cwd: string;
  readonly stalePeerTtlMs: number;
  readonly checkProcessLiveness: (pid: number) => boolean;

  constructor(
    dbPath: string,
    cwd: string = process.cwd(),
    options: {
      stalePeerTtlMs?: number;
      checkProcessLiveness?: (pid: number) => boolean;
    } = {}
  ) {
    this.cwd = cwd;
    this.stalePeerTtlMs = options.stalePeerTtlMs ?? DEFAULT_STALE_PEER_TTL_MS;
    this.checkProcessLiveness = options.checkProcessLiveness ?? isLocalProcessAlive;
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    }
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 3000;");
    if (dbPath !== ":memory:") {
      for (const suffix of ["", "-wal", "-shm"]) {
        const target = `${dbPath}${suffix}`;
        if (existsSync(target)) {
          try {
            chmodSync(target, 0o600);
          } catch {
            // Ignore chmod errors on filesystems without POSIX permissions
          }
        }
      }
    }
    this.#initSchema();
  }

  #initSchema(): void {
    this.db.exec(`
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
    `);
  }

  registerPeer(peerId: string, now = Date.now(), pid = process.pid): void {
    this.db
      .prepare(
        `INSERT INTO peers (peer_id, pid, cwd, todos_json, updated_at)
         VALUES (?1, ?2, ?3, '[]', ?4)
         ON CONFLICT(peer_id) DO UPDATE SET
           pid = excluded.pid,
           cwd = excluded.cwd,
           updated_at = excluded.updated_at`
      )
      .run(peerId, pid, this.cwd, now);
  }

  unregisterPeer(peerId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM peers WHERE peer_id = ?1").run(peerId);
      this.db.prepare("DELETE FROM peer_file_access WHERE peer_id = ?1").run(peerId);
      this.db.prepare("DELETE FROM peer_inbox WHERE to_peer_id = ?1 AND delivered = 0").run(peerId);
    });
    tx();
  }

  /**
   * Prunes peers whose process has exited or whose heartbeat has exceeded `stalePeerTtlMs`.
   * Returns the list of pruned peer IDs.
   */
  pruneStalePeers(now = Date.now()): string[] {
    const rows = this.db
      .prepare("SELECT peer_id, pid, updated_at FROM peers")
      .all() as Array<{ peer_id: string; pid: number; updated_at: number }>;

    const deadPeers: string[] = [];
    for (const row of rows) {
      const expired = now - row.updated_at > this.stalePeerTtlMs;
      const deadPid = row.pid > 0 && !this.checkProcessLiveness(row.pid);
      if (expired || deadPid) {
        deadPeers.push(row.peer_id);
      }
    }

    if (deadPeers.length > 0) {
      const tx = this.db.transaction(() => {
        for (const peerId of deadPeers) {
          this.db.prepare("DELETE FROM peers WHERE peer_id = ?1").run(peerId);
          this.db.prepare("DELETE FROM peer_file_access WHERE peer_id = ?1").run(peerId);
          this.db.prepare("DELETE FROM peer_inbox WHERE to_peer_id = ?1 AND delivered = 0").run(peerId);
        }
      });
      tx();
    }
    return deadPeers;
  }

  recordFileAccess(
    peerId: string,
    rawPaths: string[],
    kind: "read" | "write",
    now = Date.now()
  ): PeerSyncMessage[] {
    const normalizedPaths = Array.from(
      new Set(rawPaths.map(p => normalizeRepoPath(this.cwd, p)).filter(Boolean))
    );
    if (normalizedPaths.length === 0) return [];

    this.pruneStalePeers(now);
    const conflicts: PeerSyncMessage[] = [];
    const tx = this.db.transaction(() => {
      this.registerPeer(peerId, now);
      const upsert = this.db.prepare(
        `INSERT INTO peer_file_access (peer_id, file_path, access_kind, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(peer_id, file_path, access_kind)
         DO UPDATE SET updated_at = excluded.updated_at`
      );
      for (const filePath of normalizedPaths) {
        upsert.run(peerId, filePath, kind, now);
      }

      if (kind === "write") {
        const placeholders = normalizedPaths.map(() => "?").join(", ");
        const otherWriters = this.db
          .prepare(
            `SELECT DISTINCT peer_id, file_path
             FROM peer_file_access
             WHERE peer_id != ? AND access_kind = 'write' AND file_path IN (${placeholders})`
          )
          .all(peerId, ...normalizedPaths) as Array<{ peer_id: string; file_path: string }>;

        const byPeer = new Map<string, string[]>();
        for (const row of otherWriters) {
          const list = byPeer.get(row.peer_id) ?? [];
          list.push(row.file_path);
          byPeer.set(row.peer_id, list);
        }

        for (const [otherPeerId, overlappingFiles] of byPeer.entries()) {
          const summary = `Concurrent write detected on [${overlappingFiles.join(", ")}] with peer @${peerId}. Coordinate or re-read before further edits to avoid lost updates.`;
          const msgA = this.#enqueueInbox({
            fromPeerId: peerId,
            toPeerId: otherPeerId,
            kind: "write_conflict",
            summary,
            touchedFiles: overlappingFiles,
            exportedSymbols: [],
            now,
          });
          if (msgA) conflicts.push(msgA);

          const reverseSummary = `You modified [${overlappingFiles.join(", ")}] which peer @${otherPeerId} is also actively editing. Re-read the file or partition responsibilities.`;
          const msgB = this.#enqueueInbox({
            fromPeerId: otherPeerId,
            toPeerId: peerId,
            kind: "write_conflict",
            summary: reverseSummary,
            touchedFiles: overlappingFiles,
            exportedSymbols: [],
            now,
          });
          if (msgB) conflicts.push(msgB);
        }
      }
    });
    tx();
    return conflicts;
  }

  updatePeerTodos(peerId: string, phases: ManagedTodoPhase[], now = Date.now()): void {
    this.registerPeer(peerId, now);
    this.db
      .prepare("UPDATE peers SET todos_json = ?1, updated_at = ?2 WHERE peer_id = ?3")
      .run(JSON.stringify(phases), now, peerId);
  }

  getPeerTodos(peerId: string): ManagedTodoPhase[] {
    const row = this.db
      .prepare("SELECT todos_json FROM peers WHERE peer_id = ?1")
      .get(peerId) as { todos_json: string } | null;
    if (!row) return [];
    return parseTodoPhases(row.todos_json);
  }

  /**
   * Broadcasts an explicit technical message from `fromPeerId` to all other active peers (or a specific `targetPeerId`).
   */
  broadcastPeerNote(
    fromPeerId: string,
    summary: string,
    options: { targetPeerId?: string; touchedFiles?: string[]; now?: number } = {}
  ): PeerSyncMessage[] {
    const now = options.now ?? Date.now();
    const clean = summary.trim();
    if (!clean) return [];
    this.pruneStalePeers(now);

    const delivered: PeerSyncMessage[] = [];
    const tx = this.db.transaction(() => {
      this.registerPeer(fromPeerId, now);
      const targets = options.targetPeerId
        ? [{ peer_id: options.targetPeerId }]
        : (this.db
            .prepare("SELECT peer_id FROM peers WHERE peer_id != ?1")
            .all(fromPeerId) as Array<{ peer_id: string }>);

      for (const { peer_id: toPeerId } of targets) {
        if (toPeerId === fromPeerId) continue;
        const msg = this.#enqueueInbox({
          fromPeerId,
          toPeerId,
          kind: "direct_broadcast",
          summary: clean,
          touchedFiles: options.touchedFiles ?? [],
          exportedSymbols: [],
          now,
        });
        if (msg) delivered.push(msg);
      }
    });
    tx();
    return delivered;
  }

  /**
   * Called when the Sidecar Watcher marks one or more Todo items completed (or a significant write-burst settles).
   * Routes a `<peer-sync>` notice to every peer whose ReadSet/WriteSet intersects `touchedFiles`,
   * or to all active peers when `exportedSymbols` is non-empty (contract change).
   */
  publishMilestoneSync(input: PublishMilestoneInput, now = Date.now()): PeerSyncMessage[] {
    const normalizedFiles = Array.from(
      new Set(input.touchedFiles.map(f => normalizeRepoPath(this.cwd, f)).filter(Boolean))
    );
    const exportedSymbols = input.exportedSymbols ?? [];
    const summaryText = input.summary?.trim();
    if (!summaryText && input.completedTasks.length === 0) {
      return [];
    }

    this.pruneStalePeers(now);

    const effectiveSummary =
      summaryText ||
      `Completed milestone: ${input.completedTasks.join("; ")}${
        normalizedFiles.length ? ` (files: ${normalizedFiles.join(", ")})` : ""
      }`;

    const deliveredMessages: PeerSyncMessage[] = [];
    const tx = this.db.transaction(() => {
      this.registerPeer(input.fromPeerId, now);
      const otherPeers = this.db
        .prepare("SELECT peer_id FROM peers WHERE peer_id != ?1")
        .all(input.fromPeerId) as Array<{ peer_id: string }>;

      for (const { peer_id: targetPeerId } of otherPeers) {
        let shouldRoute = exportedSymbols.length > 0;
        let relevantFiles = normalizedFiles;

        if (!shouldRoute && normalizedFiles.length > 0) {
          const placeholders = normalizedFiles.map(() => "?").join(", ");
          const matches = this.db
            .prepare(
              `SELECT DISTINCT file_path
               FROM peer_file_access
               WHERE peer_id = ? AND file_path IN (${placeholders})`
            )
            .all(targetPeerId, ...normalizedFiles) as Array<{ file_path: string }>;
          if (matches.length > 0) {
            shouldRoute = true;
            relevantFiles = matches.map(m => m.file_path);
          }
        }

        if (!shouldRoute && normalizedFiles.length > 0) {
          const dirPrefixes = normalizedFiles.map(f => dirname(f)).filter(d => d && d !== ".");
          if (dirPrefixes.length > 0) {
            const peerFiles = this.db
              .prepare("SELECT DISTINCT file_path FROM peer_file_access WHERE peer_id = ?1")
              .all(targetPeerId) as Array<{ file_path: string }>;
            if (
              peerFiles.some(pf =>
                dirPrefixes.some(dp => pf.file_path.startsWith(`${dp}/`) || pf.file_path === dp)
              )
            ) {
              shouldRoute = true;
            }
          }
        }

        if (!shouldRoute) continue;

        const queued = this.#enqueueInbox({
          fromPeerId: input.fromPeerId,
          toPeerId: targetPeerId,
          kind: "milestone_sync",
          completedTask: input.completedTasks[0],
          summary: effectiveSummary,
          touchedFiles: relevantFiles,
          exportedSymbols,
          now,
        });
        if (queued) deliveredMessages.push(queued);
      }
    });
    tx();
    return deliveredMessages;
  }

  /**
   * Atomically drains all pending `<peer-sync>` messages for `peerId`.
   * Called at `tool_result` boundary so injection never interrupts an in-flight streaming call.
   */
  drainInbox(peerId: string): PeerSyncMessage[] {
    let messages: PeerSyncMessage[] = [];
    const tx = this.db.transaction(() => {
      const rows = this.db
        .prepare(
          `SELECT id, from_peer_id, to_peer_id, kind, completed_task, summary,
                  touched_files_json, exported_symbols_json, created_at
           FROM peer_inbox
           WHERE to_peer_id = ?1 AND delivered = 0
           ORDER BY id ASC`
        )
        .all(peerId) as Array<{
        id: number;
        from_peer_id: string;
        to_peer_id: string;
        kind: "milestone_sync" | "write_conflict" | "direct_broadcast";
        completed_task: string | null;
        summary: string;
        touched_files_json: string;
        exported_symbols_json: string;
        created_at: number;
      }>;

      if (rows.length === 0) return;

      const markStmt = this.db.prepare("UPDATE peer_inbox SET delivered = 1 WHERE id = ?1");
      messages = rows.map(r => {
        markStmt.run(r.id);
        return {
          id: r.id,
          fromPeerId: r.from_peer_id,
          toPeerId: r.to_peer_id,
          kind: r.kind,
          ...(r.completed_task ? { completedTask: r.completed_task } : {}),
          summary: r.summary,
          touchedFiles: parseStringArray(r.touched_files_json),
          exportedSymbols: parseStringArray(r.exported_symbols_json),
          createdAt: r.created_at,
        };
      });
    });
    tx();
    return messages;
  }

  listPeers(now = Date.now()): PeerSnapshot[] {
    this.pruneStalePeers(now);
    const rows = this.db
      .prepare("SELECT peer_id, pid, cwd, todos_json, updated_at FROM peers ORDER BY updated_at DESC")
      .all() as Array<{
      peer_id: string;
      pid: number;
      cwd: string;
      todos_json: string;
      updated_at: number;
    }>;

    return rows.map(row => {
      const phases = parseTodoPhases(row.todos_json);
      const allTasks = phases.flatMap(p => p.tasks);
      const activeTask = allTasks.find(t => t.status === "in_progress")?.content ?? null;
      const completedCount = allTasks.filter(t => t.status === "completed").length;

      const accessRows = this.db
        .prepare("SELECT file_path, access_kind FROM peer_file_access WHERE peer_id = ?1")
        .all(row.peer_id) as Array<{ file_path: string; access_kind: "read" | "write" }>;

      return {
        peerId: row.peer_id,
        pid: row.pid,
        cwd: row.cwd,
        activeTask,
        completedCount,
        totalCount: allTasks.length,
        readFiles: accessRows.filter(a => a.access_kind === "read").map(a => a.file_path),
        writeFiles: accessRows.filter(a => a.access_kind === "write").map(a => a.file_path),
        updatedAt: row.updated_at,
      };
    });
  }

  #enqueueInbox(params: {
    fromPeerId: string;
    toPeerId: string;
    kind: "milestone_sync" | "write_conflict" | "direct_broadcast";
    completedTask?: string;
    summary: string;
    touchedFiles: string[];
    exportedSymbols: string[];
    now: number;
  }): PeerSyncMessage | null {
    const normalizedSummary = params.summary.toLowerCase().replace(/\s+/g, " ").trim();
    const dedupeHash = createHash("sha256")
      .update(`${params.fromPeerId}|${params.toPeerId}|${params.kind}|${normalizedSummary}`)
      .digest("hex")
      .slice(0, 32);

    const existing = this.db
      .prepare("SELECT id FROM peer_inbox WHERE to_peer_id = ?1 AND dedupe_hash = ?2")
      .get(params.toPeerId, dedupeHash) as { id: number } | null;
    if (existing) {
      return null;
    }

    const res = this.db
      .prepare(
        `INSERT INTO peer_inbox (
          from_peer_id, to_peer_id, kind, completed_task, summary,
          touched_files_json, exported_symbols_json, dedupe_hash, delivered, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`
      )
      .run(
        params.fromPeerId,
        params.toPeerId,
        params.kind,
        params.completedTask ?? null,
        params.summary,
        JSON.stringify(params.touchedFiles),
        JSON.stringify(params.exportedSymbols),
        dedupeHash,
        params.now
      );

    return {
      id: Number(res.lastInsertRowid),
      fromPeerId: params.fromPeerId,
      toPeerId: params.toPeerId,
      kind: params.kind,
      ...(params.completedTask ? { completedTask: params.completedTask } : {}),
      summary: params.summary,
      touchedFiles: params.touchedFiles,
      exportedSymbols: params.exportedSymbols,
      createdAt: params.now,
    };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Formats drained `PeerSyncMessage[]` as an XML-wrapped, Zero-ACK advisory block
 * suitable for `tool_result.additionalContext`.
 */
export function formatPeerSyncContext(messages: PeerSyncMessage[]): string | undefined {
  if (messages.length === 0) return undefined;
  const blocks = messages.map(msg => {
    const headerAttrs = [
      `from="@${msg.fromPeerId}"`,
      `kind="${msg.kind}"`,
      msg.completedTask ? `milestone=${JSON.stringify(msg.completedTask)}` : "",
      msg.touchedFiles.length > 0 ? `files=${JSON.stringify(msg.touchedFiles.join(","))}` : "",
      msg.exportedSymbols.length > 0 ? `symbols=${JSON.stringify(msg.exportedSymbols.join(","))}` : "",
      `policy="zero-ack: adapt your code directly if affected; NEVER send thank-you or acknowledgment messages"`,
    ]
      .filter(Boolean)
      .join(" ");
    return `<peer-sync ${headerAttrs}>\n${msg.summary}\n</peer-sync>`;
  });
  return blocks.join("\n");
}
