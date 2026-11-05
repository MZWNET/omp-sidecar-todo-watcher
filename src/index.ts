import { join } from "node:path";
import { PeerSyncBroker } from "./peer-broker.ts";
import {
  type EphemeralTurnRunner,
  type HudTheme,
  type ModelTokenUsage,
  SIDECAR_CUSTOM_ENTRY_TYPE,
  SidecarTodoWatcher,
  isSensitiveFilePath,
  redactSecrets,
  shouldManageSession,
  stripTodoFromTools,
} from "./watcher-core.ts";

export interface OmpResolvedModel {
  id: string;
  provider: string;
  api: string;
  name?: string;
}

export interface OmpExtensionUI {
  theme?: HudTheme;
  setWidget?(
    key: string,
    lines: string[] | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" }
  ): void;
  setStatus?(key: string, text: string | undefined): void;
  notify?(text: string, level?: "info" | "warning" | "error"): void;
}

export interface OmpExtensionContext {
  cwd?: string;
  hasUI?: boolean;
  ui?: OmpExtensionUI;
  agent?: {
    kind?: "main" | "sub";
    id?: string;
    name?: string;
    depth?: number;
    parentId?: string;
  };
  models?: {
    list?(): OmpResolvedModel[];
    current?(): OmpResolvedModel | undefined;
    resolve?(spec: string): OmpResolvedModel | undefined;
  };
  modelRegistry?: {
    getApiKey?(model: OmpResolvedModel): Promise<string | undefined>;
    resolveModelHeaders?(
      model: OmpResolvedModel,
      signal?: AbortSignal
    ): Promise<Record<string, string> | undefined>;
  };
  sessionManager?: {
    getSessionId?(): string | undefined;
    getSessionFile?(): string | undefined;
    getBranch?(): unknown[];
  };
  runEphemeralTurn?: EphemeralTurnRunner;
  setTimeout?(fn: () => void, ms: number): unknown;
}

export interface OmpToolResultEvent {
  toolName?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

export interface OmpTurnEndEvent {
  turnIndex?: number;
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      name?: string;
      intent?: string;
      arguments?: Record<string, unknown>;
    }>;
  };
}

export interface OmpInputEvent {
  text?: string;
  source?: "interactive" | "rpc";
}

export interface OmpExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
}

export interface OmpExtensionAPI {
  setLabel?(label: string): void;
  getActiveTools?(): string[];
  setActiveTools?(names: string[]): Promise<void> | void;
  appendEntry?(customType: string, data: unknown): void;
  exec?(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number; signal?: AbortSignal }
  ): Promise<OmpExecResult>;
  on(
    event:
      | "session_start"
      | "session_switch"
      | "session_branch"
      | "session_tree"
      | "session_shutdown",
    handler: (event: unknown, ctx: OmpExtensionContext) => Promise<void> | void
  ): void;
  on(
    event: "turn_end",
    handler: (event: OmpTurnEndEvent, ctx: OmpExtensionContext) => Promise<void> | void
  ): void;
  on(
    event: "input",
    handler: (event: OmpInputEvent, ctx: OmpExtensionContext) => Promise<void> | void
  ): void;
  on(
    event: "tool_result",
    handler: (
      event: OmpToolResultEvent,
      ctx: OmpExtensionContext
    ) => Promise<{ additionalContext?: string } | undefined>
  ): void;
  on(
    event: "session_stop",
    handler: (
      event: unknown,
      ctx: OmpExtensionContext
    ) => Promise<{ decision?: "block"; reason?: string } | undefined>
  ): void;
  registerCommand?(
    name: string,
    def: {
      description: string;
      handler: (args: string, ctx: OmpExtensionContext) => Promise<void> | void;
    }
  ): void;
}

type CompleteSimpleFn = (
  model: OmpResolvedModel,
  context: {
    systemPrompt?: string;
    messages: Array<{
      role: "user";
      content: Array<{ type: "text"; text: string }>;
      timestamp: number;
    }>;
  },
  options?: {
    apiKey?: string;
    headers?: Record<string, string>;
    sessionId?: string;
    promptCacheKey?: string;
    temperature?: number;
    maxTokens?: number;
    disableReasoning?: boolean;
    forceReasoningOff?: boolean;
    signal?: AbortSignal;
  }
) => Promise<{
  model?: string;
  provider?: string;
  content?: Array<{ type?: string; text?: string }>;
  usage?: ModelTokenUsage;
}>;

const DEFAULT_SMOL_CANDIDATES = [
  "@smol",
  "@tiny",
  "@commit",
  "gemini-3.8-flash",
  "deepseek-v4.1-flash",
  "deepseek-flash",
  "claude-haiku-4-5",
];

let cachedCompleteSimple: CompleteSimpleFn | null | undefined;

async function getCompleteSimple(): Promise<CompleteSimpleFn | null> {
  if (cachedCompleteSimple !== undefined) return cachedCompleteSimple;
  try {
    // Exception to ts-no-dynamic-import: `@oh-my-pi/pi-ai` is a virtual host-bundled specifier
    // resolved at runtime by omp's Bun onLoad hook and is absent when running standalone `bun test`.
    const mod = (await import("@oh-my-pi/pi-ai")) as { completeSimple?: CompleteSimpleFn };
    cachedCompleteSimple = typeof mod.completeSimple === "function" ? mod.completeSimple : null;
  } catch {
    cachedCompleteSimple = null;
  }
  return cachedCompleteSimple;
}

function extractToolOutputSnippet(content: OmpToolResultEvent["content"]): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const text = content
    .filter(c => c && c.type === "text" && typeof c.text === "string")
    .map(c => c.text!.trim())
    .filter(Boolean)
    .join(" ");
  return text ? text.replace(/\s+/g, " ").slice(-200) : undefined;
}

function extractTurnAssistantSummary(event: OmpTurnEndEvent | undefined): {
  summary: string;
  pureTextLength: number;
} {
  const blocks = event?.message?.content;
  if (!Array.isArray(blocks)) return { summary: "", pureTextLength: 0 };
  const parts: string[] = [];
  let pureTextLength = 0;
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      const trimmed = b.text.trim();
      pureTextLength += trimmed.length;
      parts.push(trimmed.slice(0, 900));
    } else if (b.type === "toolCall" && typeof b.name === "string") {
      const intent = typeof b.intent === "string" && b.intent ? ` (${b.intent})` : "";
      parts.push(`ToolCall: ${b.name}${intent}`);
    }
  }
  return {
    summary: parts.join(" | ").slice(0, 1200),
    pureTextLength,
  };
}

/**
 * OMP Extension: Sidecar Todo Watcher & Peer Sync Broker
 */
export default function sidecarTodoWatcherExtension(pi: OmpExtensionAPI): void {
  let broker: PeerSyncBroker | null = null;
  let watcher: SidecarTodoWatcher | null = null;
  let inFlightPass: Promise<void> | null = null;
  let rerunRequested = false;
  let customWatcherModelSpec: string | undefined = process.env.OMP_WATCHER_MODEL;
  let watcherMode: "auto" | "detached" | "ephemeral" =
    process.env.OMP_WATCHER_MODE === "ephemeral"
      ? "ephemeral"
      : process.env.OMP_WATCHER_MODE === "detached"
        ? "detached"
        : "auto";

  function isManagedContext(ctx: OmpExtensionContext): boolean {
    return shouldManageSession({
      agent: ctx.agent,
      activeTools: pi.getActiveTools?.(),
    });
  }

  function resolveDetachedSmolModel(ctx: OmpExtensionContext): OmpResolvedModel | undefined {
    if (watcherMode === "ephemeral" || !ctx.models?.resolve) return undefined;
    const candidates = customWatcherModelSpec
      ? [customWatcherModelSpec, ...DEFAULT_SMOL_CANDIDATES]
      : DEFAULT_SMOL_CANDIDATES;
    for (const spec of candidates) {
      try {
        const resolved = ctx.models.resolve(spec);
        if (resolved) return resolved;
      } catch {
        continue;
      }
    }
    return undefined;
  }

  function buildWatcherRunner(ctx: OmpExtensionContext): EphemeralTurnRunner | undefined {
    return async options => {
      // 1. Prefer Detached Micro-Judge on cheap/fast model (@smol / @tiny / deepseek-flash)
      if (watcherMode !== "ephemeral") {
        const smolModel = resolveDetachedSmolModel(ctx);
        const completeSimple = smolModel ? await getCompleteSimple() : null;
        if (smolModel && completeSimple && ctx.modelRegistry?.getApiKey) {
          try {
            const apiKey = await ctx.modelRegistry.getApiKey(smolModel);
            if (apiKey) {
              const headers = await ctx.modelRegistry.resolveModelHeaders?.(
                smolModel,
                options.signal
              );
              const cacheSessionId = `${
                ctx.sessionManager?.getSessionId?.() ?? `peer-${process.pid}`
              }:detached-watcher`;
              const msg = await completeSimple(
                smolModel,
                {
                  systemPrompt:
                    "You are a fast, deterministic JSON-only code-progress judge. Do not think or explain; output ONLY a raw JSON object starting with '{' and ending with '}'.",
                  messages: [
                    {
                      role: "user",
                      content: [{ type: "text", text: options.promptText }],
                      timestamp: Date.now(),
                    },
                  ],
                },
                {
                  apiKey,
                  ...(headers ? { headers } : {}),
                  sessionId: cacheSessionId,
                  promptCacheKey: cacheSessionId,
                  temperature: 0,
                  disableReasoning: true,
                  forceReasoningOff: true,
                  signal: options.signal,
                }
              );
              const replyText = Array.isArray(msg.content)
                ? msg.content
                    .filter(c => c?.type === "text" && typeof c.text === "string")
                    .map(c => c.text!)
                    .join("\n")
                    .trim()
                : "";
              if (replyText) {
                return {
                  replyText,
                  mode: "detached-smol",
                  assistantMessage: {
                    model: msg.model ?? smolModel.id,
                    provider: msg.provider ?? smolModel.provider,
                    usage: msg.usage,
                  },
                };
              }
            }
          } catch {
            // Fall through to ctx.runEphemeralTurn on transport error
          }
        }
      }

      // 2. Fallback: Shared-Cache Ephemeral Turn on active session model
      if (typeof ctx.runEphemeralTurn === "function") {
        const res = await ctx.runEphemeralTurn(options);
        return {
          ...res,
          mode: "ephemeral-shared-cache",
        };
      }
      throw new Error("No sidecar watcher runner available");
    };
  }

  function ensureInitialized(ctx: OmpExtensionContext): {
    broker: PeerSyncBroker;
    watcher: SidecarTodoWatcher;
  } {
    const cwd = ctx.cwd || process.cwd();
    const rawPeerId =
      process.env.OMP_PEER_ID ||
      ctx.sessionManager?.getSessionId?.() ||
      `peer-${process.pid}`;
    const peerId = rawPeerId.slice(0, 24);

    if (!broker) {
      const dbPath = process.env.OMP_PEER_BROKER_DB || join(cwd, ".omp", "peer-sync.sqlite");
      broker = new PeerSyncBroker(dbPath, cwd);
    }
    if (!watcher || watcher.peerId !== peerId) {
      watcher = new SidecarTodoWatcher({ peerId, broker });
      const branch = ctx.sessionManager?.getBranch?.();
      if (Array.isArray(branch) && branch.length > 0) {
        watcher.restoreFromBranch(branch);
      }
    }
    return { broker, watcher };
  }

  function persistAndRefreshUi(ctx: OmpExtensionContext, w: SidecarTodoWatcher): void {
    pi.appendEntry?.(SIDECAR_CUSTOM_ENTRY_TYPE, {
      phases: w.phases,
      telemetry: w.telemetry,
    });
    refreshUi(ctx, w);
  }

  function refreshUi(ctx: OmpExtensionContext, w: SidecarTodoWatcher): void {
    if (!ctx.hasUI || !ctx.ui) return;
    const lines = w.renderHudWidget(ctx.ui.theme);
    ctx.ui.setWidget?.("sidecar-todo-watcher", lines.length > 0 ? lines : undefined, {
      placement: "aboveEditor",
    });
    const active = w.activeTask();
    const all = w.phases.flatMap(p => p.tasks);
    const done = all.filter(t => t.status === "completed").length;
    ctx.ui.setStatus?.(
      "sidecar-todo",
      all.length > 0
        ? `Todo ${done}/${all.length}${w.paused ? " (paused)" : active ? ` (${active.id})` : " ✓"}`
        : undefined
    );
  }

  async function collectGitDiffSnippet(
    ctx: OmpExtensionContext,
    files: string[]
  ): Promise<string | undefined> {
    const safeFiles = files.filter(f => !isSensitiveFilePath(f)).slice(0, 10);
    if (typeof pi.exec !== "function" || safeFiles.length === 0) return undefined;
    try {
      const res = await pi.exec("git", ["diff", "-U2", "--", ...safeFiles], {
        cwd: ctx.cwd || process.cwd(),
        timeout: 2000,
      });
      if (res.code === 0 && res.stdout.trim()) {
        return redactSecrets(res.stdout.trim()).slice(0, 3000);
      }
    } catch {
      // Ignore git diff errors in non-git directories
    }
    return undefined;
  }

  async function syncFromSessionBranch(_event: unknown, ctx: OmpExtensionContext): Promise<void> {
    if (!isManagedContext(ctx)) return;
    const { watcher: w } = ensureInitialized(ctx);
    const activeTools = pi.getActiveTools?.() ?? [];
    if (activeTools.includes("todo")) {
      await pi.setActiveTools?.(stripTodoFromTools(activeTools));
    }
    const branch = ctx.sessionManager?.getBranch?.();
    if (Array.isArray(branch)) {
      w.restoreFromBranch(branch);
    }
    refreshUi(ctx, w);
  }

  pi.setLabel?.("Sidecar Todo Watcher & Peer Sync");

  pi.on("session_start", syncFromSessionBranch);
  pi.on("session_switch", syncFromSessionBranch);
  pi.on("session_branch", syncFromSessionBranch);
  pi.on("session_tree", syncFromSessionBranch);

  pi.on("input", async (event: OmpInputEvent, ctx: OmpExtensionContext) => {
    if (!isManagedContext(ctx)) return;
    const { watcher: w } = ensureInitialized(ctx);
    const res = w.onUserInput(String(event.text ?? ""));
    if (res.archivedPreviousList) {
      persistAndRefreshUi(ctx, w);
    }
  });

  pi.on("tool_result", async (event: OmpToolResultEvent, ctx: OmpExtensionContext) => {
    if (!isManagedContext(ctx)) return undefined;
    const { watcher: w } = ensureInitialized(ctx);
    const outcome = w.onToolResult({
      toolName: String(event.toolName ?? ""),
      input: event.input,
      outputSnippet: extractToolOutputSnippet(event.content),
      isError: event.isError === true,
    });

    if (outcome.additionalContext) {
      return { additionalContext: outcome.additionalContext };
    }
    return undefined;
  });

  function launchWatcherPassInBackground(ctx: OmpExtensionContext, w: SidecarTodoWatcher): void {
    const runner = buildWatcherRunner(ctx);
    if (w.paused || !runner) return;
    if (inFlightPass) {
      rerunRequested = true;
      return;
    }

    const drainLoop = async (): Promise<void> => {
      try {
        do {
          rerunRequested = false;
          const filesToDiff = w.pendingTouchedFiles;
          const diffSnippet =
            filesToDiff.length > 0 ? await collectGitDiffSnippet(ctx, filesToDiff) : undefined;
          const res = await w.runWatcherPass(runner, {
            gitDiffSnippet: diffSnippet,
          });
          if (res.updated) {
            persistAndRefreshUi(ctx, w);
          }
        } while (rerunRequested && !w.paused && (w.phases.length === 0 || w.hasPendingActivity));
      } catch {
        // Non-fatal: sidecar errors are isolated from main session
      } finally {
        inFlightPass = null;
      }
    };

    if (typeof ctx.setTimeout === "function") {
      const { promise, resolve } = Promise.withResolvers<void>();
      inFlightPass = promise;
      ctx.setTimeout(() => {
        void drainLoop().finally(resolve);
      }, 0);
    } else {
      inFlightPass = drainLoop();
    }
  }

  pi.on("turn_end", async (event: OmpTurnEndEvent, ctx: OmpExtensionContext) => {
    if (!isManagedContext(ctx)) return;
    const { watcher: w } = ensureInitialized(ctx);
    const { summary: turnSummary, pureTextLength } = extractTurnAssistantSummary(event);
    if (turnSummary) {
      w.recordTurnAssistantSummary(turnSummary, pureTextLength);
    }
    if (w.paused) return;

    const needsInit = w.phases.length === 0;
    const hasPendingActivity = w.hasPendingActivity;
    if (!needsInit && !hasPendingActivity) return;

    launchWatcherPassInBackground(ctx, w);
    if (typeof ctx.setTimeout !== "function" && inFlightPass) {
      await inFlightPass;
    }
  });

  pi.on("session_stop", async (_event: unknown, ctx: OmpExtensionContext) => {
    if (!isManagedContext(ctx)) return undefined;
    const { watcher: w } = ensureInitialized(ctx);
    const runner = buildWatcherRunner(ctx);
    if (w.paused || !runner) return undefined;

    try {
      if (inFlightPass) {
        await inFlightPass;
      }
      const diffSnippet =
        w.pendingTouchedFiles.length > 0
          ? await collectGitDiffSnippet(ctx, w.pendingTouchedFiles)
          : undefined;
      const gate = await w.evaluateStopGate(runner, {
        gitDiffSnippet: diffSnippet,
      });
      persistAndRefreshUi(ctx, w);
      if (gate.decision === "block") {
        return { decision: "block", reason: gate.reason };
      }
    } catch {
      // Fail open on unexpected transport error during shutdown
    }
    return undefined;
  });

  pi.on("session_shutdown", async () => {
    if (watcher && broker) {
      broker.unregisterPeer(watcher.peerId);
      broker.close();
      broker = null;
      watcher = null;
    }
  });

  pi.registerCommand?.("peer-todos", {
    description:
      "Manage Sidecar Watcher todos & peer sync: /peer-todos [status|model <spec>|mode <auto|detached|ephemeral>|add <task>|done <#id>|reset|pause|resume|broadcast <msg>]",
    handler: async (rawArgs: string, ctx: OmpExtensionContext) => {
      const { broker: b, watcher: w } = ensureInitialized(ctx);
      const trimmed = rawArgs.trim();
      const spaceIdx = trimmed.indexOf(" ");
      const sub = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase() || "status";
      const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

      switch (sub) {
        case "model": {
          if (!rest) {
            const resolved = resolveDetachedSmolModel(ctx);
            ctx.ui?.notify?.(
              `Current Watcher model: ${
                resolved ? `${resolved.provider}/${resolved.id}` : "session model (ephemeral)"
              }`,
              "info"
            );
            return;
          }
          customWatcherModelSpec = rest;
          const resolved = resolveDetachedSmolModel(ctx);
          ctx.ui?.notify?.(
            resolved
              ? `Watcher model set to ${resolved.provider}/${resolved.id}`
              : `Could not resolve "${rest}", will fallback to default chain`,
            resolved ? "info" : "warning"
          );
          return;
        }
        case "mode": {
          if (rest === "auto" || rest === "detached" || rest === "ephemeral") {
            watcherMode = rest;
            ctx.ui?.notify?.(`Watcher mode set to ${watcherMode}`, "info");
          } else {
            ctx.ui?.notify?.("Usage: /peer-todos mode <auto|detached|ephemeral>", "warning");
          }
          return;
        }
        case "add": {
          const added = w.addManualTask(rest);
          if (!added) {
            ctx.ui?.notify?.("Usage: /peer-todos add <task description>", "warning");
            return;
          }
          persistAndRefreshUi(ctx, w);
          ctx.ui?.notify?.(`Added ${added.id}: ${added.content}`, "info");
          return;
        }
        case "done": {
          const completed = w.markTaskCompleted(rest);
          if (!completed) {
            ctx.ui?.notify?.(`No open todo matching "${rest}"`, "warning");
            return;
          }
          persistAndRefreshUi(ctx, w);
          ctx.ui?.notify?.(`Completed ${completed.id}: ${completed.content}`, "info");
          return;
        }
        case "reset": {
          w.resetTodos();
          persistAndRefreshUi(ctx, w);
          ctx.ui?.notify?.("Sidecar todos archived and reset.", "info");
          return;
        }
        case "pause": {
          w.setPaused(true);
          refreshUi(ctx, w);
          ctx.ui?.notify?.("Sidecar Todo Watcher paused.", "info");
          return;
        }
        case "resume": {
          w.setPaused(false);
          refreshUi(ctx, w);
          ctx.ui?.notify?.("Sidecar Todo Watcher resumed.", "info");
          return;
        }
        case "broadcast": {
          if (!rest) {
            ctx.ui?.notify?.("Usage: /peer-todos broadcast <technical message>", "warning");
            return;
          }
          const delivered = b.broadcastPeerNote(w.peerId, rest);
          ctx.ui?.notify?.(`Broadcast queued for ${delivered.length} active peer(s).`, "info");
          return;
        }
        default: {
          const lines = w.renderHudWidget();
          ctx.ui?.notify?.(lines.length > 0 ? lines.join("\n") : "No active todos or peers.", "info");
        }
      }
    },
  });
}

export * from "./peer-broker.ts";
export * from "./watcher-core.ts";
