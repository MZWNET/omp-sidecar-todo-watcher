import { describe, expect, test } from "bun:test";
import sidecarTodoWatcherExtension, {
  type OmpExtensionAPI,
  type OmpExtensionContext,
  type OmpInputEvent,
  type OmpToolResultEvent,
  PeerSyncBroker,
  SIDECAR_CUSTOM_ENTRY_TYPE,
  SidecarTodoWatcher,
  isSensitiveFilePath,
  redactSecrets,
  restorePhasesFromBranchEntries,
  shouldManageSession,
  stripTodoFromTools,
  summarizeCodeChange,
  summarizeReadEvidence,
} from "../src/index.ts";

describe("Sidecar Todo Watcher & Peer Sync Broker", () => {
  test("1. strips 'todo' from main agent active tools and extracts initial plan on Turn 1", async () => {
    const broker = new PeerSyncBroker(":memory:", "/repo");
    const watcher = new SidecarTodoWatcher({ peerId: "peer-backend", broker });

    const initialTools = ["read", "edit", "bash", "todo", "grep"];
    expect(stripTodoFromTools(initialTools)).toEqual(["read", "edit", "bash", "grep"]);

    watcher.onToolResult({ toolName: "read", input: { path: "src/schema.ts" } });
    expect(watcher.mutationsSinceCheck).toBe(0);

    const initPass = await watcher.runWatcherPass(async () => ({
      replyText: JSON.stringify({
        initTasks: [
          "Define UserRole enum in src/schema.ts",
          "Implement role validation middleware in src/auth.ts",
          "Add unit tests for role validation",
        ],
      }),
    }));

    expect(initPass.updated).toBe(true);
    expect(watcher.phases[0]?.tasks).toEqual([
      { id: "#1", content: "Define UserRole enum in src/schema.ts", status: "in_progress" },
      { id: "#2", content: "Implement role validation middleware in src/auth.ts", status: "pending" },
      { id: "#3", content: "Add unit tests for role validation", status: "pending" },
    ]);

    broker.close();
  });

  test("2. write-burst watermark gate stays silent on read-only turns and fires on edit + verification", async () => {
    const broker = new PeerSyncBroker(":memory:", "/repo");
    const watcher = new SidecarTodoWatcher({
      peerId: "peer-backend",
      broker,
      initialPhases: [
        {
          name: "Tasks",
          tasks: [
            { id: "#1", content: "Define UserRole enum in src/schema.ts", status: "in_progress" },
            { id: "#2", content: "Implement role validation middleware in src/auth.ts", status: "pending" },
          ],
        },
      ],
    });

    const readOutcome = watcher.onToolResult({
      toolName: "read",
      input: { path: "src/schema.ts" },
    });
    expect(readOutcome.shouldTriggerMidTurnWatcher).toBe(false);

    const editOutcome = watcher.onToolResult({
      toolName: "edit",
      input: {
        input:
          "*** Begin Patch\n*** Update File: src/schema.ts\n@@\n+export type UserRole = 'admin' | 'member';\n*** End Patch",
      },
    });
    expect(editOutcome.shouldTriggerMidTurnWatcher).toBe(false);
    expect(watcher.mutationsSinceCheck).toBe(1);

    const verifyOutcome = watcher.onToolResult({
      toolName: "bash",
      input: { command: "bun test" },
      isError: false,
    });
    expect(verifyOutcome.shouldTriggerMidTurnWatcher).toBe(true);

    broker.close();
  });

  test("3. sidecar checkoff advances active todo cursor and routes <peer-sync> to peers whose ReadSet intersects", async () => {
    const broker = new PeerSyncBroker(":memory:", "/repo");

    const backendWatcher = new SidecarTodoWatcher({
      peerId: "backend",
      broker,
      initialPhases: [
        {
          name: "Backend",
          tasks: [
            { id: "#1", content: "Update UserSchema in src/shared/schema.ts", status: "in_progress" },
            { id: "#2", content: "Update auth endpoint in src/api/auth.ts", status: "pending" },
          ],
        },
      ],
    });

    const frontendWatcher = new SidecarTodoWatcher({
      peerId: "frontend",
      broker,
      initialPhases: [
        {
          name: "Frontend",
          tasks: [
            { id: "#1", content: "Build user profile form using src/shared/schema.ts", status: "in_progress" },
          ],
        },
      ],
    });

    frontendWatcher.onToolResult({
      toolName: "read",
      input: { path: "/repo/src/shared/schema.ts:1-50" },
    });

    backendWatcher.onToolResult({
      toolName: "edit",
      input: { path: "src/shared/schema.ts" },
    });
    backendWatcher.onToolResult({
      toolName: "lsp",
      input: { path: "src/shared/schema.ts" },
    });

    const passResult = await backendWatcher.runWatcherPass(
      async ({ promptText }) => {
        expect(promptText).toContain("+role: UserRole");
        return {
          replyText:
            '```json\n{"completedTasks": ["#1"], "milestoneSummary": "Added required `role: UserRole` field to UserSchema in src/shared/schema.ts", "exportedSymbolsChanged": ["UserSchema"]}\n```',
        };
      },
      { gitDiffSnippet: "+role: UserRole" }
    );

    expect(passResult.updated).toBe(true);
    expect(passResult.newlyCompleted).toEqual(["Update UserSchema in src/shared/schema.ts"]);
    expect(backendWatcher.activeTask()?.id).toBe("#2");
    expect(passResult.routedPeerMessages).toHaveLength(1);
    expect(passResult.routedPeerMessages[0]?.toPeerId).toBe("frontend");

    const frontendNextStep = frontendWatcher.onToolResult({
      toolName: "read",
      input: { path: "src/components/ProfileForm.tsx" },
    });

    expect(frontendNextStep.additionalContext).toContain('<peer-sync from="@backend"');
    expect(frontendNextStep.additionalContext).toContain("Added required `role: UserRole` field to UserSchema");
    expect(frontendNextStep.additionalContext).toContain("zero-ack");

    const frontendLaterStep = frontendWatcher.onToolResult({
      toolName: "read",
      input: { path: "src/components/ProfileForm.tsx" },
    });
    expect(frontendLaterStep.additionalContext).toBeUndefined();

    broker.close();
  });

  test("4. detects immediate Write-Write conflicts across peers and notifies both sides", () => {
    const broker = new PeerSyncBroker(":memory:", "/repo");
    const peerA = new SidecarTodoWatcher({ peerId: "peer-a", broker });
    const peerB = new SidecarTodoWatcher({ peerId: "peer-b", broker });

    peerA.onToolResult({
      toolName: "edit",
      input: { path: "src/router.ts" },
    });

    const bOutcome = peerB.onToolResult({
      toolName: "write",
      input: { path: "src/router.ts" },
    });

    expect(bOutcome.additionalContext).toContain('kind="write_conflict"');
    expect(bOutcome.additionalContext).toContain("src/router.ts");

    const aOutcome = peerA.onToolResult({
      toolName: "read",
      input: { path: "src/router.ts" },
    });
    expect(aOutcome.additionalContext).toContain('kind="write_conflict"');
    expect(aOutcome.additionalContext).toContain("peer @peer-b");

    broker.close();
  });

  test("5. session_stop gate blocks premature stop when todos remain incomplete and allows stop once all complete", async () => {
    const broker = new PeerSyncBroker(":memory:", "/repo");
    const watcher = new SidecarTodoWatcher({
      peerId: "worker-1",
      broker,
      maxStopBlocks: 2,
      initialPhases: [
        {
          name: "Tasks",
          tasks: [
            { id: "#1", content: "Implement feature", status: "completed" },
            { id: "#2", content: "Write regression test", status: "in_progress" },
          ],
        },
      ],
    });

    const gate1 = await watcher.evaluateStopGate(async () => ({
      replyText: '{"completedTasks": []}',
    }));
    expect(gate1.decision).toBe("block");
    expect(gate1.reason).toContain("[#2] Write regression test");

    watcher.onToolResult({
      toolName: "write",
      input: { path: "tests/feature.test.ts" },
    });
    const gate2 = await watcher.evaluateStopGate(async () => ({
      replyText: '{"completedTasks": ["#2"]}',
    }));
    expect(gate2.decision).toBeUndefined();
    expect(watcher.incompleteTasks()).toHaveLength(0);

    broker.close();
  });

  test("6. task-switch auto-reset (#41359 fix), dynamic appendTasks/dropTasks, branch restore, and dead-PID pruning", async () => {
    const alivePids = new Set<number>([1001, 1002]);
    const broker = new PeerSyncBroker(":memory:", "/repo", {
      stalePeerTtlMs: 60_000,
      checkProcessLiveness: pid => alivePids.has(pid),
    });

    broker.registerPeer("peer-alive", 1_000, 1001);
    broker.registerPeer("peer-crashed", 1_000, 9999);
    expect(broker.pruneStalePeers(2_000)).toEqual(["peer-crashed"]);
    expect(broker.listPeers(2_000).map(p => p.peerId)).toEqual(["peer-alive"]);

    const watcher = new SidecarTodoWatcher({
      peerId: "peer-alive",
      broker,
      initialPhases: [
        {
          name: "Tasks",
          tasks: [
            { id: "#1", content: "Step A", status: "in_progress" },
            { id: "#2", content: "Obsolete Step B", status: "pending" },
          ],
        },
      ],
    });

    watcher.onToolResult({ toolName: "edit", input: { path: "src/a.ts" } });
    const evo = await watcher.runWatcherPass(async () => ({
      replyText: JSON.stringify({
        completedTasks: ["#1"],
        dropTasks: ["#2"],
        appendTasks: ["Step C: Add rate limiter"],
      }),
    }));
    expect(evo.newlyCompleted).toEqual(["Step A"]);
    expect(evo.newlyDropped).toEqual(["Obsolete Step B"]);
    expect(evo.newlyAppended).toEqual(["Step C: Add rate limiter"]);
    expect(watcher.activeTask()?.content).toBe("Step C: Add rate limiter");

    watcher.markTaskCompleted("#3");
    expect(watcher.incompleteTasks()).toHaveLength(0);

    const inputRes = watcher.onUserInput("Now build the billing webhook handler");
    expect(inputRes.archivedPreviousList).toBe(true);
    expect(watcher.phases).toHaveLength(0);
    expect(watcher.archivedBatches).toHaveLength(1);

    const restored = restorePhasesFromBranchEntries([
      {
        type: "custom",
        customType: SIDECAR_CUSTOM_ENTRY_TYPE,
        data: {
          phases: [
            {
              name: "Restored",
              tasks: [{ id: "#1", content: "Restored branch task", status: "pending" }],
            },
          ],
        },
      },
    ]);
    expect(restored[0]?.tasks[0]?.status).toBe("in_progress");

    expect(shouldManageSession({ agent: { name: "scout" }, activeTools: ["read", "grep"] })).toBe(false);
    expect(shouldManageSession({ agent: { id: "advisor" }, activeTools: ["read", "edit"] })).toBe(false);
    expect(shouldManageSession({ agent: { kind: "main" }, activeTools: ["read", "edit"] })).toBe(true);

    broker.close();
  });

  test("7. full omp extension lifecycle + /peer-todos slash commands integration test", async () => {
    process.env.OMP_PEER_BROKER_DB = ":memory:";
    let activeTools = ["read", "edit", "bash", "todo"];
    const handlers: Record<string, (...args: unknown[]) => unknown> = {};
    const commands: Record<string, (args: string, ctx: OmpExtensionContext) => Promise<void> | void> = {};
    const persistedEntries: Array<{ customType: string; data: unknown }> = [];
    const notifications: string[] = [];
    let latestWidget: string[] | undefined;

    const mockPi: OmpExtensionAPI = {
      getActiveTools: () => activeTools,
      setActiveTools: (names: string[]) => {
        activeTools = names;
      },
      appendEntry: (customType: string, data: unknown) => {
        persistedEntries.push({ customType, data });
      },
      exec: async () => ({ stdout: "+export const PORT = 8080;\n", stderr: "", code: 0 }),
      on(event: string, handler: (...args: unknown[]) => unknown) {
        handlers[event] = handler;
      },
      registerCommand(name, def) {
        commands[name] = def.handler;
      },
    };

    sidecarTodoWatcherExtension(mockPi);

    let ephemeralReply = '{"initTasks": ["Step 1: Create config", "Step 2: Verify config"]}';
    const ctx: OmpExtensionContext = {
      cwd: "/repo",
      hasUI: true,
      ui: {
        setWidget(_key, lines) {
          latestWidget = lines;
        },
        notify(text) {
          notifications.push(text);
        },
      },
      sessionManager: {
        getSessionId: () => "session-alpha-001",
      },
      runEphemeralTurn: async () => ({ replyText: ephemeralReply }),
    };

    await handlers.session_start?.({}, ctx);
    expect(activeTools).toEqual(["read", "edit", "bash"]);

    await handlers.turn_end?.({}, ctx);
    expect(persistedEntries).toHaveLength(1);
    expect(latestWidget?.[0]).toContain("0/2 done · Active (#1): Step 1: Create config");

    ephemeralReply = '{"completedTasks": ["#1"], "milestoneSummary": "Created config.ts"}';
    await handlers.tool_result?.(
      { toolName: "write", input: { path: "src/config.ts" }, isError: false } satisfies OmpToolResultEvent,
      ctx
    );
    await handlers.tool_result?.(
      { toolName: "bash", input: { command: "bun test" }, isError: false } satisfies OmpToolResultEvent,
      ctx
    );
    await handlers.turn_end?.({}, ctx);

    const nextToolRes = (await handlers.tool_result?.(
      { toolName: "read", input: { path: "src/config.ts" }, isError: false } satisfies OmpToolResultEvent,
      ctx
    )) as { additionalContext?: string } | undefined;

    expect(latestWidget?.[0]).toContain("1/2 done · Active (#2): Step 2: Verify config");
    expect(nextToolRes?.additionalContext).toContain('Sidecar Watcher marked completed: "Step 1: Create config"');

    await commands["peer-todos"]?.("add Step 3: Update docs", ctx);
    expect(latestWidget?.[0]).toContain("1/3 done");

    await commands["peer-todos"]?.("done #2", ctx);
    expect(latestWidget?.[0]).toContain("2/3 done · Active (#3): Step 3: Update docs");

    await commands["peer-todos"]?.("done #3", ctx);
    expect(latestWidget?.[0]).toContain("3/3 done · All complete ✓");

    await handlers.input?.({ text: "Start next feature", source: "interactive" } satisfies OmpInputEvent, ctx);
    expect(latestWidget).toBeUndefined();

    await handlers.session_shutdown?.({}, ctx);
  });

  test("8. detached-smol optimizations: AST declaration extraction on large files & deterministic verification veto", async () => {
    const broker = new PeerSyncBroker(":memory:", "/repo");
    const watcher = new SidecarTodoWatcher({
      peerId: "peer-opt",
      broker,
      initialPhases: [
        {
          name: "Tasks",
          tasks: [
            { id: "#1", content: "Implement add and divide in src/calc.ts", status: "in_progress" },
            { id: "#2", content: "Run bun test and verify all tests pass", status: "pending" },
          ],
        },
      ],
    });

    const padding = "// comment padding line\n".repeat(60);
    const largeCode = `export function add(a: number, b: number) { return a + b; }\n${padding}\nexport function divide(a: number, b: number) { return a / b; }`;
    const summary = summarizeCodeChange("src/calc.ts", "write", largeCode);
    expect(summary).toContain("Declarations (2): export function add");
    expect(summary).toContain("export function divide");

    watcher.onToolResult({
      toolName: "write",
      input: { path: "src/calc.ts", content: largeCode },
      isError: false,
    });
    watcher.onToolResult({
      toolName: "bash",
      input: { command: "bun test" },
      outputSnippet: "1 fail, 0 pass",
      isError: true,
    });

    const res = await watcher.runWatcherPass(async ({ promptText }) => {
      expect(promptText).toContain("[STATIC TASK CONTEXT]");
      expect(promptText).toContain("Declarations (2):");
      return {
        replyText: JSON.stringify({
          completedTasks: ["#1", "#2"],
        }),
      };
    });

    expect(res.newlyCompleted).toEqual(["Implement add and divide in src/calc.ts"]);
    expect(watcher.activeTask()?.id).toBe("#2");

    broker.close();
  });

  test("9. pure read/investigation Todo: stays silent on intermediate reads, triggers on analytical synthesis, and blocks premature checkoff without findings", async () => {
    const broker = new PeerSyncBroker(":memory:", "/repo");
    const watcher = new SidecarTodoWatcher({
      peerId: "peer-investigator",
      broker,
      initialPhases: [
        {
          name: "Audit",
          tasks: [
            { id: "#1", content: "调研 src/auth.ts 与 src/session.ts 并分析会话过期根因", status: "in_progress" },
            { id: "#2", content: "修复 src/session.ts 中的过期时间计算错误", status: "pending" },
          ],
        },
      ],
    });

    watcher.onToolResult({
      toolName: "read",
      input: { path: "src/auth.ts" },
      outputSnippet: "export function verifyToken(token: string) { return true; }",
      isError: false,
    });
    watcher.recordTurnAssistantSummary("先读一下文件 | ToolCall: read", 6);

    expect(watcher.hasPendingActivity).toBe(false);

    const premature = await watcher.runWatcherPass(async () => ({
      replyText: '{"completedTasks": ["#1"]}',
    }));
    expect(premature.newlyCompleted).toHaveLength(0);
    expect(watcher.activeTask()?.id).toBe("#1");

    watcher.onToolResult({
      toolName: "read",
      input: { path: "src/session.ts" },
      outputSnippet: "export class SessionStore { isExpired(ts: number) { return Date.now() - ts > 1000; } }",
      isError: false,
    });
    const analysisText =
      "根因定位完成：对比 src/auth.ts 与 src/session.ts 发现，SessionStore.isExpired 将 TTL 单位秒误作毫秒计算（1000ms），导致会话在 1 秒后即过期。接下来准备修改 src/session.ts。";
    watcher.recordTurnAssistantSummary(analysisText, analysisText.length);

    expect(watcher.hasPendingActivity).toBe(true);

    const validSynthesis = await watcher.runWatcherPass(async ({ promptText }) => {
      expect(promptText).toContain("Investigated/Read files so far: src/auth.ts, src/session.ts");
      expect(promptText).toContain("symbols=[export class SessionStore");
      expect(promptText).toContain("SessionStore.isExpired");
      return {
        replyText: '{"completedTasks": ["#1"], "milestoneSummary": "Identified TTL ms/sec unit bug in SessionStore.isExpired"}',
      };
    });

    expect(validSynthesis.newlyCompleted).toEqual(["调研 src/auth.ts 与 src/session.ts 并分析会话过期根因"]);
    expect(watcher.activeTask()?.id).toBe("#2");
    expect(summarizeReadEvidence("grep", ["src/"], { pattern: "isExpired" }, "12: export function isExpired() {}")).toContain(
      "symbols=[export function isExpired() {}]"
    );

    broker.close();
  });

  test("10. privacy & secret protection: blocks sensitive files (.env, keys) and scrubs API tokens/PEM keys from prompts", () => {
    expect(isSensitiveFilePath(".env")).toBe(true);
    expect(isSensitiveFilePath("config/.env.production")).toBe(true);
    expect(isSensitiveFilePath("/home/user/.ssh/id_rsa")).toBe(true);
    expect(isSensitiveFilePath("certs/server.pem")).toBe(true);
    expect(isSensitiveFilePath("config/secrets.json")).toBe(true);
    expect(isSensitiveFilePath("src/auth.ts")).toBe(false);

    // Sensitive file content is completely blocked from code change summaries and read evidence
    const envSummary = summarizeCodeChange(".env.local", "write", "OPENAI_API_KEY=sk-proj-1234567890abcdefghij");
    expect(envSummary).toContain("[REDACTED_SENSITIVE_FILE]");
    expect(envSummary).not.toContain("sk-proj-");

    const keyRead = summarizeReadEvidence("read", ["~/.ssh/id_ed25519"], {}, "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----");
    expect(keyRead).toContain("[REDACTED_SENSITIVE_FILE]");
    expect(keyRead).not.toContain("PRIVATE KEY");

    // Inline secrets in normal source files or command outputs are scrubbed
    const dirtyText = [
      "const key = 'sk-1234567890abcdefghijklmnop';",
      "const gh = \"ghp_1234567890abcdefghijklmnopqrstuv\";",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
    ].join("\n");

    const scrubbed = redactSecrets(dirtyText);
    expect(scrubbed).not.toContain("sk-1234567890");
    expect(scrubbed).not.toContain("ghp_1234567890");
    expect(scrubbed).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(scrubbed).not.toContain("wJalrXUtnFEMI");
    expect(scrubbed).not.toContain("MIIEowIBAAKCAQEA");
    expect(scrubbed).toContain("[REDACTED_SECRET]");
    expect(scrubbed).toContain("[REDACTED_PRIVATE_KEY]");
  });
});
