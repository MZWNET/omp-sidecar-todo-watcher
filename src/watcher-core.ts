import {
  type ManagedTodoItem,
  type ManagedTodoPhase,
  type PeerSyncBroker,
  type PeerSyncMessage,
  coerceTodoPhases,
  formatPeerSyncContext,
  normalizeRepoPath,
} from "./peer-broker.ts";

export const SIDECAR_CUSTOM_ENTRY_TYPE = "omp-sidecar-todo-watcher.state";

export interface SidecarEvalResponse {
  /** Initial tasks extracted on Turn 1 when no todo list exists yet */
  initTasks?: string[];
  /** Task IDs (#1, #2) or task contents completed in this write-burst */
  completedTasks?: string[];
  /** Newly discovered or user-added tasks to append to the active phase */
  appendTasks?: string[];
  /** Obsolete tasks (by ID or content) to mark as abandoned */
  dropTasks?: string[];
  /** Concise 1-line technical summary of interface/behavior changes for peer agents (null if internal-only) */
  milestoneSummary?: string | null;
  /** Exported function/type/class symbols added or modified in this write-burst */
  exportedSymbolsChanged?: string[];
}

export interface ModelTokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

export interface SidecarUsageTelemetry {
  calls: number;
  mode: "detached-smol" | "ephemeral-shared-cache" | "mixed";
  lastModelId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  cacheHitRate: number;
  perCallLog: Array<{
    callIndex: number;
    kind: "init" | "delta";
    mode: "detached-smol" | "ephemeral-shared-cache";
    modelId: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cacheHitRate: number;
    costUsd: number;
    durationMs: number;
  }>;
}

export type EphemeralTurnRunner = (options: {
  promptText: string;
  minimizeEffort?: boolean;
   standaloneDigest?: boolean;
  signal?: AbortSignal;
}) => Promise<{
  replyText: string;
  mode?: "detached-smol" | "ephemeral-shared-cache";
  assistantMessage?: {
    model?: string;
    provider?: string;
    usage?: ModelTokenUsage;
  };
}>;

export interface HudTheme {
  fg?(color: "success" | "accent" | "warning" | "error" | "muted" | "dim", text: string): string;
  strikethrough?(text: string): string;
}

const READ_TOOLS: Record<string, true> = {
  read: true,
  grep: true,
  glob: true,
  lsp: true,
};
const WRITE_TOOLS: Record<string, true> = {
  edit: true,
  write: true,
  ast_edit: true,
  apply_patch: true,
};
const VERIFY_TOOLS: Record<string, true> = {
  bash: true,
  eval: true,
  lsp: true,
};
const READ_ONLY_AGENT_NAMES: Record<string, true> = {
  advisor: true,
  scout: true,
  seance: true,
  reviewer: true,
  "security-reviewer": true,
};

const DECLARATION_LINE_REGEX =
  /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+\w+|(?:async\s+)?function\s+\w+|class\s+\w+|def\s+\w+|pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+\w+|func\s+\w+|describe\s*\(|test\s*\(|it\s*\()/;

const VERIFICATION_TASK_REGEX =
  /\b(?:bun\s+test|npm\s+test|pnpm\s+test|vitest|jest|pytest|cargo\s+test|go\s+test|tsc|typecheck|lint)\b|运行.*测试|跑通.*测试|验证通过/i;

const INVESTIGATION_TASK_REGEX =
  /\b(?:investigate|analyze|audit|inspect|research|locate|find|diagnose|review|check|understand)\b|调研|分析|排查|审计|定位|检查|阅读|梳理|诊断/i;

const SENSITIVE_FILE_REGEX =
  /(?:^|\/)(?:\.env(?:\..+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_(?:rsa|ed25519|ecdsa|dsa)(?:\..+)?|.*\.(?:pem|key|p12|pfx|keystore|jks)|.*(?:secret|credential|token|passwd|password)s?\.(?:json|ya?ml|toml|ini|conf))$/i;

/**
 * Checks whether a file path points to a credential/secret/key file whose contents
 * must NEVER be extracted into sidecar prompts or git diff snippets.
 */
export function isSensitiveFilePath(filePath: string): boolean {
  const normalized = filePath.trim().replace(/\\/g, "/");
  if (!normalized) return false;
  if (normalized.includes("/.ssh/") || normalized.includes("/.aws/") || normalized.includes("/.gnupg/")) {
    return true;
  }
  return SENSITIVE_FILE_REGEX.test(normalized);
}

/**
 * Redacts API keys, Bearer tokens, PEM private keys, JWTs, and secret assignments
 * before any text is sent to an external Sidecar LLM or persisted to SQLite.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  return input
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]"
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}\b/gi, "$1[REDACTED_TOKEN]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
      "[REDACTED_SECRET]"
    )
    .replace(
      /\b((?:[A-Za-z0-9_]*(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)[A-Za-z0-9_]*)\s*[:=]\s*)(['"]?)[^\s'"`,;\n]{8,}\2/gi,
      "$1$2[REDACTED]$2"
    );
}

/**
 * Extracts all top-level/exported symbol declarations + a compact head/tail preview
 * from written or patched code so the detached small model sees 100% of implemented
 * functions even in files >1000 chars without blowing up token count.
 */
export function summarizeCodeChange(label: string, toolName: string, rawContent: string): string {
  if (isSensitiveFilePath(label)) {
    return `--- ${label} (${toolName}) ---\n[REDACTED_SENSITIVE_FILE]`;
  }
  const sanitized = redactSecrets(rawContent);
  const lines = sanitized.split("\n");
  const declarations: string[] = [];
  for (const line of lines) {
    const trimmed = line.replace(/^[+-]\s*/, "").trim();
    if (DECLARATION_LINE_REGEX.test(trimmed)) {
      declarations.push(trimmed.slice(0, 120));
    }
  }
  const declHeader =
    declarations.length > 0
      ? `Declarations (${declarations.length}): ${declarations.slice(0, 20).join(" ; ")}\n`
      : "";
  const trimmedRaw = sanitized.trim();
  const bodyPreview =
    trimmedRaw.length <= 700
      ? trimmedRaw
      : `${trimmedRaw.slice(0, 400)}\n... [${trimmedRaw.length - 650} chars elided] ...\n${trimmedRaw.slice(-250)}`;
  return `--- ${label} (${toolName}) ---\n${declHeader}${bodyPreview}`;
}

/**
 * Extracts a compact (<180 chars) evidence fingerprint from read/grep/glob/lsp/web_search tool output
 * so `detached-smol` can objectively verify whether the main agent actually inspected the target files/symbols
 * without sending thousands of tokens of raw file contents.
 */
export function summarizeReadEvidence(
  toolName: string,
  paths: string[],
  input: Record<string, unknown> | undefined,
  rawOutput: string | undefined
): string {
  const target =
    paths.join(", ") ||
    (typeof input?.pattern === "string" ? `pattern:${input.pattern}` : "") ||
    (typeof input?.query === "string" ? `query:${input.query}` : "") ||
    toolName;

  if (paths.some(p => isSensitiveFilePath(p))) {
    return `${toolName}(${target}) -> [REDACTED_SENSITIVE_FILE]`;
  }

  if (!rawOutput?.trim()) {
    return `${toolName}(${target}) -> read ok`;
  }

  const sanitized = redactSecrets(rawOutput);
  const lines = sanitized.split("\n");
  const symbols: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/^\s*\d+[:|]\s*/, "").trim();
    if (DECLARATION_LINE_REGEX.test(clean)) {
      symbols.push(clean.slice(0, 80));
    }
  }

  if (symbols.length > 0) {
    return `${toolName}(${target}) -> symbols=[${symbols.slice(0, 6).join(" ; ")}]`;
  }

  const compactPreview = sanitized.replace(/\s+/g, " ").trim().slice(0, 140);
  return `${toolName}(${target}) -> snippet="${compactPreview}"`;
}

/**
 * Determines whether a session/subagent should be managed by SidecarTodoWatcher.
 * Excludes `advisor` internal tool sessions and read-only subagents (`scout`, `seance`, `reviewer`).
 */
export function shouldManageSession(params: {
  agent?: { kind?: string; id?: string; name?: string };
  activeTools?: string[];
}): boolean {
  const agentName = params.agent?.name?.toLowerCase() ?? "";
  const agentId = params.agent?.id?.toLowerCase() ?? "";
  if (READ_ONLY_AGENT_NAMES[agentName] || READ_ONLY_AGENT_NAMES[agentId]) {
    return false;
  }
  if (params.activeTools && params.activeTools.length > 0) {
    const hasWriteCapability = params.activeTools.some(
      t => WRITE_TOOLS[t] === true || t === "bash" || t === "eval"
    );
    if (!hasWriteCapability) return false;
  }
  return true;
}

/**
 * Strips `"todo"` from the main agent's active tool list so the primary LLM
 * never wastes turns or encounters string-matching errors on `todo`.
 */
export function stripTodoFromTools(toolNames: string[]): string[] {
  return toolNames.filter(name => name !== "todo");
}

/**
 * Enforces the Single-Active-Task Invariant (matching omp's `normalizeInProgressTask`):
 * - At most one task across all phases is `in_progress`.
 * - If none is `in_progress`, the first `pending` task is promoted to `in_progress`.
 * - Assigns stable `#1`, `#2`, ... IDs to every item.
 */
export function normalizeManagedPhases(phases: ManagedTodoPhase[]): ManagedTodoPhase[] {
  let seq = 1;
  let seenInProgress = false;

  const cloned: ManagedTodoPhase[] = phases
    .map(phase => ({
      name: phase.name.trim() || "Tasks",
      tasks: phase.tasks
        .map(task => {
          const content = task.content.trim();
          if (!content) return null;
          let status = task.status;
          if (status === "in_progress") {
            if (seenInProgress) {
              status = "pending";
            } else {
              seenInProgress = true;
            }
          }
          return {
            id: `#${seq++}`,
            content,
            status,
            ...(task.blocker ? { blocker: task.blocker } : {}),
          } satisfies ManagedTodoItem;
        })
        .filter((t): t is ManagedTodoItem => t !== null),
    }))
    .filter(p => p.tasks.length > 0);

  if (!seenInProgress) {
    for (const phase of cloned) {
      const firstPending = phase.tasks.find(t => t.status === "pending");
      if (firstPending) {
        firstPending.status = "in_progress";
        break;
      }
    }
  }

  return cloned;
}

/**
 * Restores the latest `ManagedTodoPhase[]` from a session branch's persisted entries
 * (`session_start`, `session_switch`, `session_branch`, `session_tree`).
 */
export function restorePhasesFromBranchEntries(entries: readonly unknown[]): ManagedTodoPhase[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object") continue;

    if (
      "type" in entry &&
      entry.type === "custom" &&
      "customType" in entry &&
      (entry.customType === SIDECAR_CUSTOM_ENTRY_TYPE || entry.customType === "user_todo_edit") &&
      "data" in entry &&
      entry.data &&
      typeof entry.data === "object" &&
      "phases" in entry.data
    ) {
      return normalizeManagedPhases(coerceTodoPhases(entry.data.phases));
    }

    if (
      "type" in entry &&
      entry.type === "message" &&
      "message" in entry &&
      entry.message &&
      typeof entry.message === "object" &&
      "role" in entry.message &&
      entry.message.role === "toolResult" &&
      "toolName" in entry.message &&
      entry.message.toolName === "todo" &&
      !("isError" in entry.message && entry.message.isError === true) &&
      "details" in entry.message &&
      entry.message.details &&
      typeof entry.message.details === "object" &&
      "phases" in entry.message.details
    ) {
      return normalizeManagedPhases(coerceTodoPhases(entry.message.details.phases));
    }
  }
  return [];
}

/**
 * Extracts file paths referenced in tool arguments (`read`, `edit`, `write`, `apply_patch`, `grep`).
 */
export function extractFilePathsFromToolInput(
  _toolName: string,
  input: Record<string, unknown> | undefined
): string[] {
  if (!input || typeof input !== "object") return [];
  const paths: string[] = [];

  for (const key of ["path", "file", "filePath", "targetFile"]) {
    const val = input[key];
    if (typeof val === "string" && val.trim() && !val.includes("://")) {
      paths.push(val.split(":")[0]!);
    }
  }

  if (typeof input.input === "string") {
    const regex = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(input.input)) !== null) {
      if (match[1]) paths.push(match[1].trim());
    }
  }

  return paths;
}

/**
 * Parses JSON from the Sidecar Watcher's `runEphemeralTurn` reply, tolerating markdown code fences.
 */
export function parseSidecarReply(replyText: string): SidecarEvalResponse | null {
  const trimmed = replyText.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]!.trim() : trimmed;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    const result: SidecarEvalResponse = {};
    if (Array.isArray(parsed.initTasks)) {
      result.initTasks = parsed.initTasks.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      );
    }
    if (Array.isArray(parsed.completedTasks)) {
      result.completedTasks = parsed.completedTasks.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      );
    }
    if (Array.isArray(parsed.appendTasks)) {
      result.appendTasks = parsed.appendTasks.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      );
    }
    if (Array.isArray(parsed.dropTasks)) {
      result.dropTasks = parsed.dropTasks.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      );
    }
    if (typeof parsed.milestoneSummary === "string" || parsed.milestoneSummary === null) {
      result.milestoneSummary = parsed.milestoneSummary;
    }
    if (Array.isArray(parsed.exportedSymbolsChanged)) {
      result.exportedSymbolsChanged = parsed.exportedSymbolsChanged.filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      );
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Matches a task identifier (`"#1"`, `"1"`, or task content) against a `ManagedTodoItem`.
 */
function matchesTodoItem(item: ManagedTodoItem, token: string): boolean {
  const clean = token.trim();
  if (!clean) return false;
  if (clean === item.id || `#${clean}` === item.id) return true;
  const normItem = item.content.toLowerCase().replace(/\s+/g, " ").trim();
  const normToken = clean.replace(/^#\d+\s*[:.-]?\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!normToken) return false;
  return normItem === normToken || (normToken.length >= 6 && normItem.includes(normToken));
}

/**
 * Core state machine for a single Peer Session's Sidecar Todo Watcher.
 */
export class SidecarTodoWatcher {
  readonly peerId: string;
  readonly broker: PeerSyncBroker;
  readonly maxStopBlocks: number;

  #phases: ManagedTodoPhase[] = [];
  #archivedBatches: ManagedTodoPhase[][] = [];
  #mutationsSinceCheck = 0;
  #verificationsSinceCheck = 0;
  #readsSinceCheck = 0;
  #latestSubstantiveTextLength = 0;
  #uncheckedTurns = 0;
  #pendingTouchedFiles = new Set<string>();
  #cumulativeTouchedFiles = new Set<string>();
  #cumulativeReadFiles = new Set<string>();
  #pendingToolActions: string[] = [];
  #pendingReadEvidence: string[] = [];
  #pendingCodeSnippets: string[] = [];
  #latestAssistantNotes: string[] = [];
  #turnLedger: string[] = [];
  #userRequestSummary = "";
  #lastVerificationPassed = false;
  #lastVerificationFailed = false;
  #pendingTailNotices: string[] = [];
  #stopBlockCount = 0;
  #turnCount = 0;
  #paused = false;
  #userPromptSinceLastCheck = false;
  #telemetry: SidecarUsageTelemetry = {
    calls: 0,
    mode: "ephemeral-shared-cache",
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    cacheHitRate: 0,
    perCallLog: [],
  };

  constructor(options: {
    peerId: string;
    broker: PeerSyncBroker;
    maxStopBlocks?: number;
    initialPhases?: ManagedTodoPhase[];
  }) {
    this.peerId = options.peerId;
    this.broker = options.broker;
    this.maxStopBlocks = options.maxStopBlocks ?? 3;
    this.broker.registerPeer(this.peerId);
    if (options.initialPhases?.length) {
      this.#phases = normalizeManagedPhases(options.initialPhases);
      this.broker.updatePeerTodos(this.peerId, this.#phases);
    }
  }

  get phases(): ManagedTodoPhase[] {
    return this.#phases;
  }

  get archivedBatches(): readonly ManagedTodoPhase[][] {
    return this.#archivedBatches;
  }

  get mutationsSinceCheck(): number {
    return this.#mutationsSinceCheck;
  }

  get readsSinceCheck(): number {
    return this.#readsSinceCheck;
  }

  get hasPendingActivity(): boolean {
    // Trigger on write bursts, verification runs, user prompts, OR when an investigation/read burst
    // produces a substantive analytical summary (>= 80 chars of findings/analysis).
    const hasReadSynthesis =
      this.#readsSinceCheck > 0 && this.#latestSubstantiveTextLength >= 80;
    return (
      this.#mutationsSinceCheck > 0 ||
      this.#verificationsSinceCheck > 0 ||
      hasReadSynthesis ||
      this.#userPromptSinceLastCheck
    );
  }

  get paused(): boolean {
    return this.#paused;
  }

  get pendingTouchedFiles(): string[] {
    return Array.from(this.#pendingTouchedFiles);
  }

  get telemetry(): SidecarUsageTelemetry {
    return this.#telemetry;
  }

  #recordUsage(
    kind: "init" | "delta",
    mode: "detached-smol" | "ephemeral-shared-cache",
    modelId: string,
    usage: ModelTokenUsage | undefined,
    durationMs: number
  ): void {
    const input = usage?.input ?? 0;
    const output = usage?.output ?? 0;
    const cacheRead = usage?.cacheRead ?? 0;
    const cacheWrite = usage?.cacheWrite ?? 0;
    const total = usage?.totalTokens || input + output + cacheRead + cacheWrite;
    const costUsd = usage?.cost?.total ?? 0;
    const promptTotal = input + cacheRead + cacheWrite;
    const callHitRate = promptTotal > 0 ? cacheRead / promptTotal : 0;

    this.#telemetry.calls++;
    this.#telemetry.lastModelId = modelId;
    if (this.#telemetry.calls === 1) {
      this.#telemetry.mode = mode;
    } else if (this.#telemetry.mode !== mode) {
      this.#telemetry.mode = "mixed";
    }
    this.#telemetry.inputTokens += input;
    this.#telemetry.outputTokens += output;
    this.#telemetry.cacheReadTokens += cacheRead;
    this.#telemetry.cacheWriteTokens += cacheWrite;
    this.#telemetry.totalTokens += total;
    this.#telemetry.totalCostUsd += costUsd;

    const cumPrompt =
      this.#telemetry.inputTokens +
      this.#telemetry.cacheReadTokens +
      this.#telemetry.cacheWriteTokens;
    this.#telemetry.cacheHitRate =
      cumPrompt > 0 ? this.#telemetry.cacheReadTokens / cumPrompt : 0;

    this.#telemetry.perCallLog.push({
      callIndex: this.#telemetry.calls,
      kind,
      mode,
      modelId,
      input,
      output,
      cacheRead,
      cacheWrite,
      totalTokens: total,
      cacheHitRate: callHitRate,
      costUsd,
      durationMs: Math.round(durationMs),
    });
  }

  setPaused(paused: boolean): void {
    this.#paused = paused;
  }

  setPhases(phases: ManagedTodoPhase[]): void {
    this.#phases = normalizeManagedPhases(phases);
    this.broker.updatePeerTodos(this.peerId, this.#phases);
  }

  /**
   * Restores state from branch entries on `/resume`, `/branch`, `/tree`, or `session_switch`.
   */
  restoreFromBranch(entries: readonly unknown[]): void {
    const restored = restorePhasesFromBranchEntries(entries);
    this.#phases = restored;
    this.#mutationsSinceCheck = 0;
    this.#verificationsSinceCheck = 0;
    this.#readsSinceCheck = 0;
    this.#latestSubstantiveTextLength = 0;
    this.#uncheckedTurns = 0;
    this.#pendingTouchedFiles.clear();
    this.#cumulativeTouchedFiles.clear();
    this.#cumulativeReadFiles.clear();
    this.#pendingToolActions = [];
    this.#pendingReadEvidence = [];
    this.#pendingCodeSnippets = [];
    this.#latestAssistantNotes = [];
    this.#turnLedger = [];
    this.#lastVerificationPassed = false;
    this.#lastVerificationFailed = false;
    this.#stopBlockCount = 0;
    this.broker.updatePeerTodos(this.peerId, this.#phases);
  }

  /**
   * Handles a new user prompt (`input` event):
   * - If all existing todos were already completed/abandoned, archives the old list and resets
   *   `#phases = []` so Turn 1 of the new prompt extracts a fresh Todo list (solving #41359).
   * - Otherwise sets `#userPromptSinceLastCheck = true` so mid-task scope additions can be extracted.
   */
  onUserInput(text: string): { archivedPreviousList: boolean } {
    if (!text.trim() || text.trim().startsWith("/")) {
      return { archivedPreviousList: false };
    }
    this.#stopBlockCount = 0;
    this.#userPromptSinceLastCheck = true;
    this.#userRequestSummary = redactSecrets(text.trim()).slice(0, 1200);

    if (this.#phases.length > 0 && this.incompleteTasks().length === 0) {
      this.#archivedBatches.push(this.#phases);
      this.#phases = [];
      this.#cumulativeTouchedFiles.clear();
      this.#cumulativeReadFiles.clear();
      this.#turnLedger = [];
      this.broker.updatePeerTodos(this.peerId, []);
      return { archivedPreviousList: true };
    }
    return { archivedPreviousList: false };
  }

  /**
   * Records assistant message text / tool-call intents from `turn_end` so a detached
   * small model without full conversation history still sees the main model's reasoning & actions.
   */
  recordTurnAssistantSummary(summary: string, pureTextLength = summary.length): void {
    const clean = summary.trim();
    if (!clean) return;
    this.#latestSubstantiveTextLength = Math.max(this.#latestSubstantiveTextLength, pureTextLength);
    this.#latestAssistantNotes.push(redactSecrets(clean).slice(0, 1200));
    if (this.#latestAssistantNotes.length > 4) {
      this.#latestAssistantNotes.shift();
    }
  }

  setUserRequestSummary(text: string): void {
    if (text.trim()) {
      this.#userRequestSummary = redactSecrets(text.trim()).slice(0, 1200);
    }
  }
  /**
   * Manual operator controls (`/peer-todos add|done|drop|reset`).
   */
  addManualTask(content: string, phaseName = "Tasks"): ManagedTodoItem | null {
    const clean = content.trim();
    if (!clean) return null;
    const current = this.#phases.length > 0 ? [...this.#phases] : [{ name: phaseName, tasks: [] }];
    const targetPhase = current.find(p => p.name === phaseName) ?? current[0]!;
    if (current.some(p => p.tasks.some(t => t.content.toLowerCase() === clean.toLowerCase()))) {
      return null;
    }
    targetPhase.tasks.push({
      id: `#${current.flatMap(p => p.tasks).length + 1}`,
      content: clean,
      status: "pending",
    });
    this.#phases = normalizeManagedPhases(current);
    this.broker.updatePeerTodos(this.peerId, this.#phases);
    return this.#phases.flatMap(p => p.tasks).find(t => t.content === clean) ?? null;
  }

  markTaskCompleted(idOrContent: string): ManagedTodoItem | null {
    let matched: ManagedTodoItem | null = null;
    for (const phase of this.#phases) {
      for (const task of phase.tasks) {
        if (task.status !== "completed" && matchesTodoItem(task, idOrContent)) {
          task.status = "completed";
          matched = task;
          break;
        }
      }
      if (matched) break;
    }
    if (!matched) return null;
    this.#phases = normalizeManagedPhases(this.#phases);
    this.broker.updatePeerTodos(this.peerId, this.#phases);
    return matched;
  }

  resetTodos(): void {
    if (this.#phases.length > 0) {
      this.#archivedBatches.push(this.#phases);
    }
    this.#phases = [];
    this.#mutationsSinceCheck = 0;
    this.#verificationsSinceCheck = 0;
    this.#readsSinceCheck = 0;
    this.#latestSubstantiveTextLength = 0;
    this.#uncheckedTurns = 0;
    this.#pendingTouchedFiles.clear();
    this.#cumulativeTouchedFiles.clear();
    this.#cumulativeReadFiles.clear();
    this.#pendingToolActions = [];
    this.#pendingReadEvidence = [];
    this.#pendingCodeSnippets = [];
    this.#latestAssistantNotes = [];
    this.#turnLedger = [];
    this.#lastVerificationPassed = false;
    this.#lastVerificationFailed = false;
    this.#stopBlockCount = 0;
    this.broker.updatePeerTodos(this.peerId, []);
  }

  /**
   * Records tool execution results, updates ReadSet/WriteSet in the broker,
   * and returns any `additionalContext` to inject at the tool boundary.
   */
  onToolResult(event: {
    toolName: string;
    input?: Record<string, unknown>;
    outputSnippet?: string;
    isError?: boolean;
  }): {
    shouldTriggerMidTurnWatcher: boolean;
    additionalContext?: string;
  } {
    const paths = extractFilePathsFromToolInput(event.toolName, event.input);

    if (!event.isError) {
      if (READ_TOOLS[event.toolName] || event.toolName === "web_search") {
        this.#readsSinceCheck++;
        if (paths.length > 0) {
          this.broker.recordFileAccess(this.peerId, paths, "read");
          for (const p of paths) {
            const norm = normalizeRepoPath(this.broker.cwd, p);
            if (norm) this.#cumulativeReadFiles.add(norm);
          }
        }
        this.#pendingReadEvidence.push(
          summarizeReadEvidence(event.toolName, paths, event.input, event.outputSnippet)
        );
        if (this.#pendingReadEvidence.length > 8) {
          this.#pendingReadEvidence.shift();
        }
      }

      if (WRITE_TOOLS[event.toolName]) {
        this.#mutationsSinceCheck++;
        for (const p of paths) {
          const norm = normalizeRepoPath(this.broker.cwd, p);
          if (norm) {
            this.#pendingTouchedFiles.add(norm);
            this.#cumulativeTouchedFiles.add(norm);
          }
        }
        if (paths.length > 0) {
          this.broker.recordFileAccess(this.peerId, paths, "write");
        }
        this.#pendingToolActions.push(
          `${event.toolName}(${paths.join(", ") || "file"}) -> ok`
        );
        const rawContent =
          typeof event.input?.content === "string"
            ? event.input.content
            : typeof event.input?.input === "string"
              ? event.input.input
              : "";
        if (rawContent.trim()) {
          const label = paths[0] || event.toolName;
          this.#pendingCodeSnippets.push(summarizeCodeChange(label, event.toolName, rawContent));
          if (this.#pendingCodeSnippets.length > 4) {
            this.#pendingCodeSnippets.shift();
          }
        }
      }

      if (VERIFY_TOOLS[event.toolName] && this.#mutationsSinceCheck > 0) {
        this.#lastVerificationPassed = true;
      }
      if (VERIFY_TOOLS[event.toolName] && this.incompleteTasks().length > 0) {
        this.#verificationsSinceCheck++;
        this.#lastVerificationFailed = false;
      }
      if (VERIFY_TOOLS[event.toolName]) {
        const cmd =
          typeof event.input?.command === "string"
            ? redactSecrets(event.input.command).slice(0, 80)
            : paths.join(", ") || event.toolName;
        const outTail = event.outputSnippet
          ? ` | output: ${redactSecrets(event.outputSnippet).slice(0, 160)}`
          : "";
        this.#pendingToolActions.push(
          `${event.toolName}(${JSON.stringify(cmd)}) -> ok (exit 0)${outTail}`
        );
      }
    } else if (VERIFY_TOOLS[event.toolName]) {
      this.#lastVerificationPassed = false;
      this.#lastVerificationFailed = true;
      const cmd =
        typeof event.input?.command === "string"
          ? redactSecrets(event.input.command).slice(0, 80)
          : event.toolName;
      const outTail = event.outputSnippet
        ? ` | error: ${redactSecrets(event.outputSnippet).slice(0, 160)}`
        : "";
      this.#pendingToolActions.push(`${event.toolName}(${JSON.stringify(cmd)}) -> FAILED${outTail}`);
    }

    const shouldTriggerMidTurnWatcher =
      !this.#paused &&
      this.#phases.length > 0 &&
      ((this.#mutationsSinceCheck > 0 && this.#lastVerificationPassed) ||
        (this.#verificationsSinceCheck > 0 && this.incompleteTasks().length > 0));

    const additionalContext = this.flushPendingContext();
    return {
      shouldTriggerMidTurnWatcher,
      ...(additionalContext ? { additionalContext } : {}),
    };
  }

  flushPendingContext(): string | undefined {
    const inboxMessages = this.broker.drainInbox(this.peerId);
    const parts: string[] = [];
    const peerSyncXml = formatPeerSyncContext(inboxMessages);
    if (peerSyncXml) parts.push(peerSyncXml);
    if (this.#pendingTailNotices.length > 0) {
      parts.push(this.#pendingTailNotices.join("\n"));
      this.#pendingTailNotices = [];
    }
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }

  /**
   * Runs the Sidecar Watcher via `ctx.runEphemeralTurn`:
   * - If no todos exist yet (Turn 1), extracts the structured Todo plan from the main model's exploration.
   * - If todos exist and mutations occurred (`mutationsSinceCheck > 0`, `#userPromptSinceLastCheck`, or `force`),
   *   evaluates completed/appended/dropped todos, advances the active cursor, and publishes `<peer-sync>`.
   */
  async runWatcherPass(
    runEphemeral: EphemeralTurnRunner,
    options: { force?: boolean; gitDiffSnippet?: string; signal?: AbortSignal } = {}
  ): Promise<{
    updated: boolean;
    newlyCompleted: string[];
    newlyAppended: string[];
    newlyDropped: string[];
    routedPeerMessages: PeerSyncMessage[];
  }> {
    if (this.#paused && !options.force) {
      return {
        updated: false,
        newlyCompleted: [],
        newlyAppended: [],
        newlyDropped: [],
        routedPeerMessages: [],
      };
    }

    this.#turnCount++;

    // Case 1: Turn 1 Plan Extraction ("Main model thinks, small sidecar records")
    // Also supports marking tasks that the main model already completed during Turn 1!
    if (this.#phases.length === 0) {
      const touchedFiles = Array.from(this.#pendingTouchedFiles);
      const toolActions = [...this.#pendingToolActions];
      const readEvidence = [...this.#pendingReadEvidence];
      const codeSnippets = [...this.#pendingCodeSnippets];
      const assistantNotes = [...this.#latestAssistantNotes];
      const hadFailedVerify = this.#lastVerificationFailed;
      const substantiveTextLen = this.#latestSubstantiveTextLength;
      const hadWriteInBurst = this.#mutationsSinceCheck > 0;
      this.#userPromptSinceLastCheck = false;
      this.#mutationsSinceCheck = 0;
      this.#verificationsSinceCheck = 0;
      this.#readsSinceCheck = 0;
      this.#latestSubstantiveTextLength = 0;
      this.#uncheckedTurns = 0;
      this.#lastVerificationPassed = false;
      this.#lastVerificationFailed = false;
      this.#pendingTouchedFiles.clear();
      this.#pendingToolActions = [];
      this.#pendingReadEvidence = [];
      this.#pendingCodeSnippets = [];
      this.#latestAssistantNotes = [];

      const combinedDiff = [codeSnippets.join("\n"), options.gitDiffSnippet ?? ""]
        .filter(Boolean)
        .join("\n")
        .slice(0, 3000);

      const promptText = this.#buildInitExtractionPrompt(
        touchedFiles,
        toolActions,
        readEvidence,
        assistantNotes,
        combinedDiff ? redactSecrets(combinedDiff) : undefined
      );
      const t0 = performance.now();
      const { replyText, assistantMessage, mode } = await runEphemeral({
        promptText,
        minimizeEffort: true,
        standaloneDigest: Boolean(this.#userRequestSummary),
        signal: options.signal,
      });
      const modelId = assistantMessage?.model
        ? `${assistantMessage.provider ? `${assistantMessage.provider}/` : ""}${assistantMessage.model}`
        : "unknown";
      this.#recordUsage(
        "init",
        mode ?? "ephemeral-shared-cache",
        modelId,
        assistantMessage?.usage,
        performance.now() - t0
      );

      const parsed = parseSidecarReply(replyText);
      if (parsed?.initTasks && parsed.initTasks.length > 0) {
        this.#phases = normalizeManagedPhases([
          {
            name: "Tasks",
            tasks: parsed.initTasks.map((content, idx) => ({
              id: `#${idx + 1}`,
              content,
              status: idx === 0 ? "in_progress" : "pending",
            })),
          },
        ]);

        const newlyCompleted: string[] = [];
        if (parsed.completedTasks && parsed.completedTasks.length > 0) {
          for (const phase of this.#phases) {
            for (const task of phase.tasks) {
              if (hadFailedVerify && VERIFICATION_TASK_REGEX.test(task.content)) {
                continue;
              }
              // Anti-premature checkoff for pure investigation tasks: require either substantive
              // analytical text (>= 60 chars) or transition to code modification.
              if (
                INVESTIGATION_TASK_REGEX.test(task.content) &&
                !hadWriteInBurst &&
                substantiveTextLen < 60
              ) {
                continue;
              }
              if (parsed.completedTasks.some(token => matchesTodoItem(task, token))) {
                task.status = "completed";
                newlyCompleted.push(task.content);
              }
            }
          }
          if (newlyCompleted.length > 0) {
            this.#phases = normalizeManagedPhases(this.#phases);
          }
        }

        this.#appendTurnLedgerEntry(touchedFiles, toolActions, readEvidence, newlyCompleted);
        this.broker.updatePeerTodos(this.peerId, this.#phases);
        const active = this.activeTask();
        const doneMsg =
          newlyCompleted.length > 0
            ? ` Completed in Turn 1: ${newlyCompleted.map(t => `"${t}"`).join(", ")}.`
            : "";
        this.#pendingTailNotices.push(
          `<sidecar-todo-status>Initialized ${parsed.initTasks.length} todo items.${doneMsg} ${
            active
              ? `Active (${active.id}): "${active.content}".`
              : "All todo items are now completed."
          } (Managed automatically by Sidecar Watcher; do not call todo tool.)</sidecar-todo-status>`
        );

        const routedPeerMessages =
          newlyCompleted.length > 0 ||
          parsed.milestoneSummary ||
          (parsed.exportedSymbolsChanged?.length ?? 0) > 0
            ? this.broker.publishMilestoneSync({
                fromPeerId: this.peerId,
                completedTasks: newlyCompleted,
                summary: parsed.milestoneSummary ?? null,
                touchedFiles,
                exportedSymbols: parsed.exportedSymbolsChanged ?? [],
              })
            : [];

        return {
          updated: true,
          newlyCompleted,
          newlyAppended: parsed.initTasks,
          newlyDropped: [],
          routedPeerMessages,
        };
      }
      return {
        updated: false,
        newlyCompleted: [],
        newlyAppended: [],
        newlyDropped: [],
        routedPeerMessages: [],
      };
    }

    // Case 2: Write-Burst Milestone Checkoff, Scope Evolution & Peer Sync
    if (
      this.#mutationsSinceCheck === 0 &&
      this.#verificationsSinceCheck === 0 &&
      !(this.#readsSinceCheck > 0 && this.#latestSubstantiveTextLength >= 80) &&
      !this.#userPromptSinceLastCheck &&
      !options.force
    ) {
      return {
        updated: false,
        newlyCompleted: [],
        newlyAppended: [],
        newlyDropped: [],
        routedPeerMessages: [],
      };
    }

    // Snapshot and reset counters BEFORE awaiting network I/O so concurrent tool completions
    // in the next turn are never overwritten (preventing Lost Update anomaly).
    const touchedFiles = Array.from(this.#pendingTouchedFiles);
    const toolActions = [...this.#pendingToolActions];
    const readEvidence = [...this.#pendingReadEvidence];
    const codeSnippets = [...this.#pendingCodeSnippets];
    const assistantNotes = [...this.#latestAssistantNotes];
    const hadFailedVerify = this.#lastVerificationFailed;
    const substantiveTextLen = this.#latestSubstantiveTextLength;
    const hadWriteInBurst = this.#mutationsSinceCheck > 0;
    this.#mutationsSinceCheck = 0;
    this.#verificationsSinceCheck = 0;
    this.#readsSinceCheck = 0;
    this.#latestSubstantiveTextLength = 0;
    this.#uncheckedTurns = 0;
    this.#lastVerificationPassed = false;
    this.#lastVerificationFailed = false;
    this.#userPromptSinceLastCheck = false;
    this.#pendingTouchedFiles.clear();
    this.#pendingToolActions = [];
    this.#pendingReadEvidence = [];
    this.#pendingCodeSnippets = [];
    this.#latestAssistantNotes = [];

    const combinedDiff = [codeSnippets.join("\n"), options.gitDiffSnippet ?? ""]
      .filter(Boolean)
      .join("\n")
      .slice(0, 3000);

    const promptText = this.#buildDeltaCheckPrompt(
      touchedFiles,
      toolActions,
      readEvidence,
      assistantNotes,
      combinedDiff ? redactSecrets(combinedDiff) : undefined
    );
    const t0 = performance.now();
    const { replyText, assistantMessage, mode } = await runEphemeral({
      promptText,
      minimizeEffort: true,
      standaloneDigest: true,
      signal: options.signal,
    });
    const modelId = assistantMessage?.model
      ? `${assistantMessage.provider ? `${assistantMessage.provider}/` : ""}${assistantMessage.model}`
      : "unknown";
    this.#recordUsage(
      "delta",
      mode ?? "ephemeral-shared-cache",
      modelId,
      assistantMessage?.usage,
      performance.now() - t0
    );

    const parsed = parseSidecarReply(replyText);
    if (!parsed) {
      return {
        updated: false,
        newlyCompleted: [],
        newlyAppended: [],
        newlyDropped: [],
        routedPeerMessages: [],
      };
    }

    const newlyCompleted: string[] = [];
    const newlyDropped: string[] = [];
    const newlyAppended: string[] = [];

    if (parsed.completedTasks && parsed.completedTasks.length > 0) {
      for (const phase of this.#phases) {
        for (const task of phase.tasks) {
          if (task.status === "completed" || task.status === "abandoned") continue;
          // Deterministic Verification Gate: never mark a test/verification task completed
          // if the verification command in this burst failed!
          if (hadFailedVerify && VERIFICATION_TASK_REGEX.test(task.content)) {
            continue;
          }
          // Deterministic Investigation Gate: if an item is a pure investigation/analysis task
          // and no code was written yet, require that the agent actually emitted substantive findings (>= 60 chars)
          // rather than just silently reading a file mid-exploration.
          if (
            INVESTIGATION_TASK_REGEX.test(task.content) &&
            !hadWriteInBurst &&
            substantiveTextLen < 60 &&
            !options.force
          ) {
            continue;
          }
          if (parsed.completedTasks.some(token => matchesTodoItem(task, token))) {
            task.status = "completed";
            newlyCompleted.push(task.content);
          }
        }
      }
    }

    this.#appendTurnLedgerEntry(touchedFiles, toolActions, readEvidence, newlyCompleted);

    if (parsed.dropTasks && parsed.dropTasks.length > 0) {
      for (const phase of this.#phases) {
        for (const task of phase.tasks) {
          if (task.status === "completed" || task.status === "abandoned") continue;
          if (parsed.dropTasks.some(token => matchesTodoItem(task, token))) {
            task.status = "abandoned";
            newlyDropped.push(task.content);
          }
        }
      }
    }

    if (parsed.appendTasks && parsed.appendTasks.length > 0) {
      const targetPhase = this.#phases[this.#phases.length - 1]!;
      const existingLower = new Set(
        this.#phases.flatMap(p => p.tasks).map(t => t.content.toLowerCase().trim())
      );
      for (const rawNew of parsed.appendTasks) {
        const clean = rawNew.trim();
        if (!clean || existingLower.has(clean.toLowerCase())) continue;
        existingLower.add(clean.toLowerCase());
        targetPhase.tasks.push({
          id: `#${this.#phases.flatMap(p => p.tasks).length + 1}`,
          content: clean,
          status: "pending",
        });
        newlyAppended.push(clean);
      }
    }

    const stateChanged =
      newlyCompleted.length > 0 || newlyDropped.length > 0 || newlyAppended.length > 0;

    if (stateChanged) {
      this.#phases = normalizeManagedPhases(this.#phases);
      this.broker.updatePeerTodos(this.peerId, this.#phases);
      this.#stopBlockCount = 0;

      const nextActive = this.activeTask();
      const transitions: string[] = [];
      if (newlyCompleted.length > 0) {
        transitions.push(`marked completed: ${newlyCompleted.map(t => `"${t}"`).join(", ")}`);
      }
      if (newlyAppended.length > 0) {
        transitions.push(`added: ${newlyAppended.map(t => `"${t}"`).join(", ")}`);
      }
      if (newlyDropped.length > 0) {
        transitions.push(`dropped: ${newlyDropped.map(t => `"${t}"`).join(", ")}`);
      }

      this.#pendingTailNotices.push(
        `<sidecar-todo-status>Sidecar Watcher ${transitions.join("; ")}. ${
          nextActive
            ? `Now in_progress (${nextActive.id}): "${nextActive.content}".`
            : "All todo items are now completed."
        }</sidecar-todo-status>`
      );
    }

    const routedPeerMessages =
      newlyCompleted.length > 0 ||
      parsed.milestoneSummary ||
      (parsed.exportedSymbolsChanged?.length ?? 0) > 0
        ? this.broker.publishMilestoneSync({
            fromPeerId: this.peerId,
            completedTasks: newlyCompleted,
            summary: parsed.milestoneSummary ?? null,
            touchedFiles,
            exportedSymbols: parsed.exportedSymbolsChanged ?? [],
          })
        : [];

    return {
      updated: stateChanged,
      newlyCompleted,
      newlyAppended,
      newlyDropped,
      routedPeerMessages,
    };
  }

  /**
   * Evaluates `session_stop`: blocks premature stop if open todos remain after flushing any pending write-burst.
   */
  async evaluateStopGate(
    runEphemeral: EphemeralTurnRunner,
    options: { gitDiffSnippet?: string; signal?: AbortSignal } = {}
  ): Promise<{ decision?: "block"; reason?: string }> {
    if (this.#paused || this.#phases.length === 0) return {};

    if (
      this.incompleteTasks().length > 0 &&
      (this.#mutationsSinceCheck > 0 ||
        this.#verificationsSinceCheck > 0 ||
        this.#readsSinceCheck > 0 ||
        this.#uncheckedTurns > 0)
    ) {
      await this.runWatcherPass(runEphemeral, {
        force: true,
        gitDiffSnippet: options.gitDiffSnippet,
        signal: options.signal,
      });
    }

    const incomplete = this.incompleteTasks();
    if (incomplete.length === 0) {
      this.#stopBlockCount = 0;
      return {};
    }

    if (this.#stopBlockCount >= this.maxStopBlocks) {
      return {};
    }

    this.#stopBlockCount++;
    const listText = incomplete.map(t => `  - [${t.id}] ${t.content}`).join("\n");
    return {
      decision: "block",
      reason: `[Sidecar Todo Gate (${this.#stopBlockCount}/${this.maxStopBlocks})] You stopped with ${incomplete.length} unverified/incomplete todo item(s):\n${listText}\nPlease complete the remaining implementation and verification before stopping.`,
    };
  }

  activeTask(): ManagedTodoItem | undefined {
    for (const phase of this.#phases) {
      const found = phase.tasks.find(t => t.status === "in_progress");
      if (found) return found;
    }
    return undefined;
  }

  incompleteTasks(): ManagedTodoItem[] {
    return this.#phases
      .flatMap(p => p.tasks)
      .filter(t => t.status === "pending" || t.status === "in_progress");
  }

  /**
   * Renders a multi-line TUI widget showing managed Todos (with checkboxes & theme colors) + Peer Team activity.
   */
  renderHudWidget(theme?: HudTheme): string[] {
    const color = (
      kind: "success" | "accent" | "warning" | "error" | "muted" | "dim",
      text: string
    ): string => (theme?.fg ? theme.fg(kind, text) : text);

    const all = this.#phases.flatMap(p => p.tasks);
    const peers = this.broker.listPeers().filter(p => p.peerId !== this.peerId);
    if (all.length === 0 && peers.length === 0) return [];

    const lines: string[] = [];
    if (all.length > 0) {
      const done = all.filter(t => t.status === "completed").length;
      const active = this.activeTask();
      const pauseBadge = this.#paused ? color("warning", " [PAUSED]") : "";
      const tel = this.#telemetry;
      const telBadge =
        tel.calls > 0
          ? color(
              "dim",
              ` · Watcher(${tel.lastModelId ?? tel.mode}): ${tel.calls} calls, ${tel.totalTokens} tok, ${(tel.cacheHitRate * 100).toFixed(1)}% cache ($${tel.totalCostUsd.toFixed(4)})`
            )
          : "";
      lines.push(
        `${color("accent", `[Sidecar Todo]`)} ${done}/${all.length} done${pauseBadge}${
          active
            ? ` · Active (${active.id}): ${active.content}`
            : ` · ${color("success", "All complete ✓")}`
        }${telBadge}`
      );

      // Show up to 5 items around the active cursor
      const maxVisible = 5;
      for (const item of all.slice(0, maxVisible)) {
        const struckContent = theme?.strikethrough ? theme.strikethrough(item.content) : item.content;
        if (item.status === "completed") {
          lines.push(`  ${color("success", `[x] ${item.id} ${struckContent}`)}`);
        } else if (item.status === "in_progress") {
          lines.push(`  ${color("accent", `[>] ${item.id} ${item.content}`)}`);
        } else if (item.status === "abandoned") {
          lines.push(`  ${color("dim", `[-] ${item.id} ${struckContent}`)}`);
        } else if (item.status === "blocked") {
          lines.push(`  ${color("warning", `[!] ${item.id} ${item.content} (blocked)`)}`);
        } else {
          lines.push(`  ${color("muted", `[ ] ${item.id} ${item.content}`)}`);
        }
      }
      if (all.length > maxVisible) {
        lines.push(`  ${color("dim", `… +${all.length - maxVisible} more todo(s)`)}`);
      }
    }

    if (peers.length > 0) {
      const peerSummary = peers
        .map(
          p =>
            `@${p.peerId}(${p.completedCount}/${p.totalCount}${
              p.activeTask ? `: ${p.activeTask}` : ""
            })`
        )
        .join(" | ");
      lines.push(`${color("accent", "[Peers]")} ${peerSummary}`);
    }
    return lines;
  }

  #appendTurnLedgerEntry(
    touchedFiles: string[],
    toolActions: string[],
    readEvidence: string[],
    newlyCompleted: string[]
  ): void {
    if (
      touchedFiles.length === 0 &&
      toolActions.length === 0 &&
      readEvidence.length === 0 &&
      newlyCompleted.length === 0
    ) {
      return;
    }
    const parts: string[] = [`Turn ${this.#turnCount}:`];
    if (touchedFiles.length > 0) parts.push(`files=[${touchedFiles.join(",")}]`);
    if (readEvidence.length > 0) parts.push(`investigated=[${readEvidence.slice(0, 3).join("; ")}]`);
    if (toolActions.length > 0) parts.push(`actions=[${toolActions.slice(0, 3).join("; ")}]`);
    if (newlyCompleted.length > 0) parts.push(`completed=[${newlyCompleted.join("; ")}]`);
    this.#turnLedger.push(parts.join(" "));
    if (this.#turnLedger.length > 10) {
      this.#turnLedger.shift();
    }
  }

  #buildInitExtractionPrompt(
    touchedFiles: string[],
    toolActions: string[],
    readEvidence: string[],
    assistantNotes: string[],
    gitDiffSnippet?: string
  ): string {
    // Prefix-aligned structure: static instructions & user goal first, dynamic turn details at tail
    const lines = [
      "[TASK CONTEXT]",
      `User Goal: ${this.#userRequestSummary || "(infer from actions below)"}`,
      "",
      "[INSTRUCTIONS]",
      "Extract 2 to 6 concrete, verifiable engineering todo items in execution order (`initTasks` array).",
      "If any step is ALREADY fully implemented/verified by the completed tool actions below, list its 1-based ID (e.g. \"#1\") in `completedTasks`.",
      "Output ONLY raw JSON starting with '{' and ending with '}':",
      '{"initTasks": ["step 1", "step 2"], "completedTasks": ["#1"], "milestoneSummary": null, "exportedSymbolsChanged": []}',
      "",
      "[TURN 1 DELTA]",
    ];
    if (assistantNotes.length > 0) {
      lines.push("Main Agent Turn Summary & Findings:", ...assistantNotes);
    }
    if (readEvidence.length > 0) {
      lines.push("Investigated files & symbols read in this turn:", ...readEvidence.map(r => `- ${r}`));
    }
    if (toolActions.length > 0) {
      lines.push("Completed tool actions in this turn:", ...toolActions.map(a => `- ${a}`));
    }
    if (touchedFiles.length > 0) {
      lines.push(`Modified files in this turn: ${touchedFiles.join(", ")}`);
    }
    if (gitDiffSnippet?.trim()) {
      lines.push("On-disk git diff snippet:", "```diff", gitDiffSnippet.trim().slice(0, 2000), "```");
    }
    return lines.join("\n");
  }

  #buildDeltaCheckPrompt(
    touchedFiles: string[],
    toolActions: string[],
    readEvidence: string[],
    assistantNotes: string[],
    gitDiffSnippet?: string
  ): string {
    const allPlanLines = this.#phases
      .flatMap(p => p.tasks)
      .map(t => `${t.id}: ${t.content}`)
      .join("\n");
    const openList = this.#phases
      .flatMap(p => p.tasks)
      .filter(t => t.status !== "completed" && t.status !== "abandoned")
      .map(t => `${t.id} [${t.status}]: ${t.content}`)
      .join("\n");

    const allCumulativeFiles = Array.from(this.#cumulativeTouchedFiles);
    const allReadFiles = Array.from(this.#cumulativeReadFiles);
    // Prefix-aligned structure:
    // 1. Static Task Context (User Goal + Master Todo Plan + Static Rules) -> 100% identical prefix across all delta calls!
    // 2. Append-Only Past Turn Ledger -> grows monotonically!
    // 3. Current Burst Delta at the very tail!
    const sections = [
      "[STATIC TASK CONTEXT]",
      `Original User Goal: ${this.#userRequestSummary || "(see plan below)"}`,
      "Master Todo Plan:",
      allPlanLines,
      "",
      "[EVALUATION RULES]",
      "1. Mark an open item in `completedTasks` (by ID like \"#1\") ONLY if every function/requirement named in that item is implemented and verified in the code/actions below.",
      "2. For investigation/analysis/audit items (e.g. 'Analyze X', 'Locate root cause'), mark completed ONLY if the target files were read AND the 'Main Agent Latest Turn Notes' below contain the concrete analytical conclusion/findings (or the agent has already moved on to implementing the fix).",
      "3. Never mark a test/verification item completed if the test command has not run yet or failed.",
      "4. If the user added new requirements, list in `appendTasks`; if an item is obsolete, list in `dropTasks`.",
      "5. If shared exports/signatures changed or a key investigation finding affects peers, write a 1-sentence `milestoneSummary` and list `exportedSymbolsChanged`.",
      "6. Output ONLY raw JSON starting with '{' and ending with '}':",
      '{"completedTasks": ["#1"], "appendTasks": [], "dropTasks": [], "milestoneSummary": null, "exportedSymbolsChanged": []}',
    ];

    if (this.#turnLedger.length > 0) {
      sections.push("", "[PAST TURN LEDGER]", ...this.#turnLedger);
    }

    sections.push(
      "",
      "[CURRENT BURST DELTA]",
      `Open Todo Items:\n${openList || "(none)"}`,
      `Investigated/Read files so far: ${allReadFiles.join(", ") || "(none)"}`,
      `Modified files in this burst: ${
        touchedFiles.length > 0 ? touchedFiles.join(", ") : "(none)"
      } (cumulative: ${allCumulativeFiles.join(", ") || "none"})`
    );

    if (readEvidence.length > 0) {
      sections.push("Files & symbols inspected in this burst:", ...readEvidence.map(r => `- ${r}`));
    }
    if (assistantNotes.length > 0) {
      sections.push("Main Agent Latest Turn Notes & Analytical Findings:", ...assistantNotes);
    }
    if (toolActions.length > 0) {
      sections.push("Executed tool actions in this burst:", ...toolActions.map(a => `- ${a}`));
    }

    if (gitDiffSnippet?.trim()) {
      sections.push("On-disk git diff snippet:", "```diff", gitDiffSnippet.trim().slice(0, 3000), "```");
    }

    return sections.join("\n");
  }
}
