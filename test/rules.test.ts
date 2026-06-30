import type { AgentEndEvent, BeforeAgentStartEvent, ContextEvent, ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
import { PiBrainsController } from "../extensions/pi-brains/controller.ts";
import { normalizeToolPath } from "../extensions/pi-brains/rules/adapters.ts";
import { buildDeliveryKey, RuleDeliveryTracker } from "../extensions/pi-brains/rules/delivery.ts";
import { renderInstructionTemplate } from "../extensions/pi-brains/rules/instructions.ts";
import type { ExecutionResult, GscRulesResponse, MatchedGscRule, RulesJsonResponse } from "../extensions/pi-brains/rules/types.ts";

const matchedRule: MatchedGscRule = {
  rule: {
    id: "rule-1",
    summary: "Accounting read guidance",
    instructions: ["Run `gsc query --file {{normalized_file}} --topic accounting` before {{action}}."],
  },
  match: {
    kind: "glob",
    value: "data/accounting/**",
    file: "data/accounting/q1.ledger",
    action: "read",
  },
  ruleHash: "sha256:abc",
};

const rulesResponse: GscRulesResponse = {
  query: {
    file: "/repo/data/accounting/q1.ledger",
    normalized_file: "data/accounting/q1.ledger",
    action: "read",
  },
  git_root: "/repo",
  rules: [matchedRule],
};

const rulesJsonResponse: RulesJsonResponse = {
  schemaVersion: 1,
  query: {
    event: "pre_tool_use",
    action: "read",
    file: "/repo/data/accounting/q1.ledger",
  },
  gitRoot: "/repo",
  rules: [
    {
      id: "rule-1",
      type: "declarative",
      event: "pre_tool_use",
      summary: "Accounting read guidance",
      instructions: ["Run `gsc query --file {{normalized_file}} --topic accounting` before {{action}}."],
      match: {
        kind: "glob",
        value: "data/accounting/**",
        file: "data/accounting/q1.ledger",
        action: "read",
      },
      ruleHash: "sha256:abc",
      priority: 0,
      importance: "medium",
    },
  ],
  summary: {
    total: 1,
    declarative: 1,
    executable: 0,
  },
};

const executionResult: ExecutionResult = {
  schemaVersion: 1,
  block: true,
  reason: "GitSense matched repository rules before this lifecycle event.\n\nEvent: pre_tool_use\nRuntime: pi\n\nOriginal event:\n- Tool: read\n- Action: read\n- File: /repo/data/accounting/q1.ledger\n\nMatched rules:\n\n1. Accounting read guidance [instruction]\n   Rule: rule-1\n   Match: glob: data/accounting/**\n   Instructions:\n   - Run `gsc query --file data/accounting/q1.ledger --topic accounting` before read.\n\nRequired next steps:\n- Apply all deterministic instructions above.",
  notices: [],
  matchedRules: [
    {
      ruleId: "rule-1",
      ruleHash: "sha256:abc",
      type: "declarative",
      summary: "Accounting read guidance",
      instructions: ["Run `gsc query --file data/accounting/q1.ledger --topic accounting` before read."],
      priority: 0,
      match: {
        kind: "glob",
        value: "data/accounting/**",
      },
    },
  ],
  triggerResults: [],
  errors: [],
  subagentTasks: [],
};

interface TestExtensionContext extends ExtensionContext {
  ui: ExtensionContext["ui"] & {
    notify: ReturnType<typeof vi.fn>;
    setWidget: ReturnType<typeof vi.fn>;
  };
}

function createContext(): TestExtensionContext {
  return {
    cwd: "/repo",
    getContextUsage: () => null,
    model: null,
    sessionManager: {
      getBranch: () => [],
      getSessionId: () => "session-1",
      getSessionFile: () => "/repo/session.jsonl",
    },
    ui: { notify: vi.fn(), setWidget: vi.fn() },
  } as unknown as TestExtensionContext;
}

function createReadEvent(path: string): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: "call-1",
    toolName: "read",
    input: { path },
  } as ToolCallEvent;
}

function createBeforeAgentStartEvent(systemPrompt = "base system prompt"): BeforeAgentStartEvent {
  return {
    type: "before_agent_start",
    prompt: "update a GitSense trigger rule",
    systemPrompt,
    systemPromptOptions: {
      cwd: "/repo",
      selectedTools: [],
      contextFiles: [],
      skills: [],
    },
  } as unknown as BeforeAgentStartEvent;
}

function createAgentEndEvent(): AgentEndEvent {
  return {
    type: "agent_end",
    messages: [],
  } as unknown as AgentEndEvent;
}

function createContextEvent(): ContextEvent {
  return {
    type: "context",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "continue" }],
      },
    ],
  } as unknown as ContextEvent;
}

function createMockPi(exec: ReturnType<typeof vi.fn>): ExtensionAPI {
  return {
    exec,
    getThinkingLevel: () => "off",
    on: vi.fn(),
    sendUserMessage: vi.fn(),
  } as unknown as ExtensionAPI;
}

function createTriggerRule(id: string, summary: string, frequencyMode?: string): MatchedGscRule {
  return {
    rule: {
      id,
      type: "tool-trigger",
      summary,
      trigger: { runtime: "node", entry: `${id}.mjs` },
      frequency: frequencyMode ? { mode: frequencyMode } : undefined,
    },
    match: {
      kind: "glob",
      value: "data/accounting/**",
      file: "data/accounting/q1.ledger",
      action: "read",
    },
    ruleHash: `sha256:${id}-rule`,
    triggerHash: `sha256:${id}-trigger`,
  };
}

describe("rule instruction rendering", () => {
  it("renders supported placeholders and leaves unknown placeholders visible", () => {
    expect(
      renderInstructionTemplate("{{repo_root}} {{normalized_file}} {{action}} {{match_kind}} {{match_value}} {{rule_id}} {{missing}}", "/repo/data/accounting/q1.ledger", "read", rulesResponse, matchedRule),
    ).toBe("/repo data/accounting/q1.ledger read glob data/accounting/** rule-1 {{missing}}");
  });
});

describe("rule tool path normalization", () => {
  it("expands home-relative tool paths before resolving against cwd", () => {
    expect(normalizeToolPath("~/gsc-trigger-test/data/accounting/q1.ledger", "/tmp")).toBe(
      `${process.env.HOME}/gsc-trigger-test/data/accounting/q1.ledger`,
    );
  });
});

describe("rule delivery", () => {
  it("keys delivery by rule hash and match provenance instead of concrete file only", () => {
    const first = buildDeliveryKey(rulesResponse, matchedRule, "read");
    const changedHash = buildDeliveryKey(rulesResponse, { ...matchedRule, ruleHash: "sha256:def" }, "read");
    const changedGlob = buildDeliveryKey(
      rulesResponse,
      { ...matchedRule, match: { kind: "glob", value: "data/**", file: "data/accounting/q1.ledger", action: "read" } },
      "read",
    );

    expect(first).toBe(buildDeliveryKey(rulesResponse, matchedRule, "read"));
    expect(first).not.toBe(changedHash);
    expect(first).not.toBe(changedGlob);
  });

  it("formats recent block and skip decisions for rules status", () => {
    const tracker = new RuleDeliveryTracker();
    tracker.record({
      timestamp: "2026-06-23T00:00:00Z",
      outcome: "blocked",
      action: "read",
      file: "/repo/data/accounting/q1.ledger",
      normalizedFile: "data/accounting/q1.ledger",
      ruleId: "rule-1",
      ruleHash: "sha256:abc",
      ruleSummary: "Accounting read guidance",
      matchKind: "glob",
      matchValue: "data/accounting/**",
      reason: "instructions delivered",
    });

    expect(tracker.formatStatus()).toContain("blocked read  data/accounting/q1.ledger");
    expect(tracker.formatStatus()).toContain("Accounting read guidance");
  });
});

describe("rule controller integration", () => {
  it("injects baseline GitSense context before every agent turn even when rules are disabled", async () => {
    const exec = vi.fn();
    const controller = new PiBrainsController(createMockPi(exec), { ...DEFAULT_CONFIG, rulesEnabled: false });
    const ctx = createContext();

    const result = await controller.handleBeforeAgentStart(createBeforeAgentStartEvent(), ctx);

    expect(result?.systemPrompt).toContain("base system prompt");
    expect(result?.systemPrompt).toContain("GitSense / pi-brains context:");
    expect(result?.systemPrompt).toContain("Trigger rules");
    expect(result?.systemPrompt).toContain("gsc experts guide triggers");
    expect(exec).not.toHaveBeenCalled();
  });

  it("keeps baseline GitSense context when before-agent rules inject messages", async () => {
    const rulesForBeforeAgent: RulesJsonResponse = {
      schemaVersion: 1,
      query: {
        event: "before_agent_start",
        action: "prompt",
      },
      gitRoot: "/repo",
      rules: [
        {
          id: "rule-before-agent",
          type: "declarative",
          event: "before_agent_start",
          summary: "Before agent instruction",
          instructions: ["Read the trigger guide before changing trigger rules."],
          match: {
            kind: "event",
            value: "before_agent_start",
          },
          ruleHash: "sha256:before-agent",
          priority: 0,
          importance: "medium",
        },
      ],
      summary: {
        total: 1,
        declarative: 1,
        executable: 0,
      },
    };
    const executionForBeforeAgent: ExecutionResult = {
      schemaVersion: 1,
      block: false,
      notices: [],
      matchedRules: [
        {
          ruleId: "rule-before-agent",
          ruleHash: "sha256:before-agent",
          type: "declarative",
          summary: "Before agent instruction",
          instructions: ["Read the trigger guide before changing trigger rules."],
          priority: 0,
          match: { kind: "event", value: "before_agent_start" },
        },
      ],
      triggerResults: [],
      errors: [],
      subagentTasks: [],
    };
    const exec = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesForBeforeAgent),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(executionForBeforeAgent),
        stderr: "",
        code: 0,
        killed: false,
      });
    const controller = new PiBrainsController(createMockPi(exec), { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = createContext();

    const result = await controller.handleBeforeAgentStart(createBeforeAgentStartEvent(), ctx);

    expect(result?.systemPrompt).toContain("GitSense / pi-brains context:");
    expect(result?.message).toMatchObject({
      customType: "brains-context",
      content: "Read the trigger guide before changing trigger rules.",
      display: true,
    });
  });

  it("renders agent_end trigger warnings and buffers passiveSteer for the next context event", async () => {
    const agentEndRules: RulesJsonResponse = {
      schemaVersion: 1,
      query: {
        event: "agent_end",
        action: "agent_end",
      },
      gitRoot: "/repo",
      rules: [
        {
          id: "provenance-agent-end",
          type: "executable",
          event: "agent_end",
          summary: "Verify AI provenance",
          trigger: { runtime: "node", entry: "ai-provenance-agent-end.mjs" },
          match: {
            kind: "event",
            value: "agent_end",
          },
          ruleHash: "sha256:provenance-rule",
          triggerHash: "sha256:provenance-trigger",
          priority: 0,
          importance: "high",
        },
      ],
      summary: {
        total: 1,
        declarative: 0,
        executable: 1,
      },
    };
    const agentEndExecution: ExecutionResult = {
      schemaVersion: 1,
      block: false,
      notices: [],
      matchedRules: [
        {
          ruleId: "provenance-agent-end",
          ruleHash: "sha256:provenance-rule",
          triggerHash: "sha256:provenance-trigger",
          type: "executable",
          summary: "Verify AI provenance",
          priority: 0,
          match: { kind: "event", value: "agent_end" },
        },
      ],
      triggerResults: [
        {
          ruleId: "provenance-agent-end",
          matched: true,
          block: false,
          notice: "AI provenance is incomplete. The next turn will be guided to fix it.",
          level: "warning",
          message: "Update the pending AI provenance entry before continuing.",
          deliveryMode: "passiveSteer",
        },
      ],
      errors: [],
      subagentTasks: [],
    };
    const emptyContextRules: RulesJsonResponse = {
      schemaVersion: 1,
      query: {
        event: "context",
        action: "agent_end",
      },
      gitRoot: "/repo",
      rules: [],
      summary: {
        total: 0,
        declarative: 0,
        executable: 0,
      },
    };
    const exec = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(agentEndRules),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(agentEndExecution),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(emptyContextRules),
        stderr: "",
        code: 0,
        killed: false,
      });
    const pi = createMockPi(exec);
    const controller = new PiBrainsController(pi, { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = createContext();

    await controller.handleStop(createAgentEndEvent(), ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "AI provenance is incomplete. The next turn will be guided to fix it.",
      "warning",
    );
    expect(pi.sendUserMessage).not.toHaveBeenCalled();

    const result = await controller.handleContext(createContextEvent(), ctx);

    expect(result?.messages.at(-1)?.content?.[0]?.text).toContain("Passive repository guidance for the next action:");
    expect(result?.messages.at(-1)?.content?.[0]?.text).toContain("Update the pending AI provenance entry before continuing.");
  });

  it("blocks the first matching read and skips the same rule hash after delivery", async () => {
    const exec = vi.fn()
      // First read: getRules returns the declarative rule
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesJsonResponse),
        stderr: "",
        code: 0,
        killed: false,
      })
      // First read: executeRules blocks with instructions
      .mockResolvedValueOnce({
        stdout: JSON.stringify(executionResult),
        stderr: "",
        code: 0,
        killed: false,
      })
      // Second read: getRules returns the same declarative rule
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesJsonResponse),
        stderr: "",
        code: 0,
        killed: false,
      });
    const pi = {
      exec,
      getThinkingLevel: () => "off",
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    const controller = new PiBrainsController(pi, { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = createContext();

    // First read should block
    const first = await controller.handleToolCall(createReadEvent("data/accounting/q1.ledger"), ctx);

    expect(first).toMatchObject({ block: true });
    expect(first?.reason).toContain("GitSense matched repository rules before this lifecycle event.");
    expect(first?.reason).toContain("Event: pre_tool_use");
    expect(first?.reason).toContain("Runtime: pi");
    expect(first?.reason).toContain("Required next steps:");
    expect(exec).toHaveBeenCalledWith(
      "gsc",
      ["rules", "get", "--event", "pre_tool_use", "--format", "rules-json", "--action", "read", "--file", "/repo/data/accounting/q1.ledger"],
      expect.objectContaining({ timeout: 3_000 }),
    );

    // Second read should NOT block (declarative rule already delivered)
    const second = await controller.handleToolCall(createReadEvent("data/accounting/q1.ledger"), ctx);
    expect(second).toBeUndefined();
    // executeRules should not be called for the second read
    expect(exec).toHaveBeenCalledTimes(3); // 2 for first read, 1 for second read's getRules
  });

  it("passes home-expanded read paths to gsc from sessions outside the repo", async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesJsonResponse),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(executionResult),
        stderr: "",
        code: 0,
        killed: false,
      });
    const pi = {
      exec,
      getThinkingLevel: () => "off",
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    const controller = new PiBrainsController(pi, { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = { ...createContext(), cwd: "/tmp" } as ExtensionContext;

    await controller.handleToolCall(createReadEvent("~/gsc-trigger-test/data/accounting/q1.ledger"), ctx);

    expect(exec).toHaveBeenCalledWith(
      "gsc",
      ["rules", "get", "--event", "pre_tool_use", "--format", "rules-json", "--action", "read", "--file", `${process.env.HOME}/gsc-trigger-test/data/accounting/q1.ledger`],
      expect.objectContaining({ timeout: 3_000 }),
    );
  });

  it("blocks with both deterministic instructions and blocking trigger output", async () => {
    const executionResultWithTrigger: ExecutionResult = {
      schemaVersion: 1,
      block: true,
      reason: "GitSense matched repository rules before this lifecycle event.\n\nEvent: pre_tool_use\nRuntime: pi\n\nOriginal event:\n- Tool: read\n- Action: read\n- File: /repo/data/accounting/q1.ledger\n\nMatched rules:\n\n1. Accounting read guidance [instruction]\n   Rule: rule-1\n   Match: glob: data/accounting/**\n   Instructions:\n   - Run `gsc query --file data/accounting/q1.ledger --topic accounting` before read.\n\n2. Accounting write trigger [tool-trigger]\n   Rule: trigger-1\n   Match: glob: data/accounting/**\n   Trigger result:\n   - BLOCKED: Load accounting policy first.\n\nRequired next steps:\n- Apply all deterministic instructions above.\n- Address all blocking trigger results above.",
      notices: ["Accounting trigger blocked the read."],
      matchedRules: [
        {
          ruleId: "rule-1",
          ruleHash: "sha256:abc",
          type: "declarative",
          summary: "Accounting read guidance",
          instructions: ["Run `gsc query --file data/accounting/q1.ledger --topic accounting` before read."],
          priority: 0,
          match: { kind: "glob", value: "data/accounting/**" },
        },
        {
          ruleId: "trigger-1",
          ruleHash: "sha256:trigger-1-rule",
          triggerHash: "sha256:trigger-1-trigger",
          type: "executable",
          summary: "Accounting write trigger",
          priority: 0,
          match: { kind: "glob", value: "data/accounting/**" },
        },
      ],
      triggerResults: [
        {
          ruleId: "trigger-1",
          matched: true,
          block: true,
          message: "Load accounting policy first.",
          notice: "Accounting trigger blocked the read.",
        },
      ],
      errors: [],
      subagentTasks: [],
    };

    const exec = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesJsonResponse),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(executionResultWithTrigger),
        stderr: "",
        code: 0,
        killed: false,
      });
    const controller = new PiBrainsController(createMockPi(exec), { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = createContext();

    const result = await controller.handleToolCall(createReadEvent("data/accounting/q1.ledger"), ctx);

    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("Accounting read guidance [instruction]");
    expect(result?.reason).toContain("Run `gsc query --file data/accounting/q1.ledger --topic accounting` before read.");
    expect(result?.reason).toContain("Accounting write trigger [tool-trigger]");
    expect(result?.reason).toContain("BLOCKED: Load accounting policy first.");
    expect(ctx.ui.notify).toHaveBeenCalledWith("Accounting trigger blocked the read.", "warning");
  });

  it("shows notice-only trigger output without blocking", async () => {
    const executionResultNoticeOnly: ExecutionResult = {
      schemaVersion: 1,
      block: false,
      notices: ["Accounting trigger allowed the read."],
      matchedRules: [
        {
          ruleId: "trigger-1",
          ruleHash: "sha256:trigger-1-rule",
          triggerHash: "sha256:trigger-1-trigger",
          type: "executable",
          summary: "Accounting notice trigger",
          priority: 0,
          match: { kind: "glob", value: "data/accounting/**" },
        },
      ],
      triggerResults: [
        {
          ruleId: "trigger-1",
          matched: true,
          block: false,
          notice: "Accounting trigger allowed the read.",
        },
      ],
      errors: [],
      subagentTasks: [],
    };

    const exec = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesJsonResponse),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(executionResultNoticeOnly),
        stderr: "",
        code: 0,
        killed: false,
      });
    const controller = new PiBrainsController(createMockPi(exec), { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = createContext();

    const result = await controller.handleToolCall(createReadEvent("data/accounting/q1.ledger"), ctx);

    expect(result).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith("Accounting trigger allowed the read.", "warning");
  });

  it("fails open and notifies when a trigger execution errors", async () => {
    const executionResultWithError: ExecutionResult = {
      schemaVersion: 1,
      block: false,
      notices: [],
      matchedRules: [
        {
          ruleId: "trigger-1",
          ruleHash: "sha256:trigger-1-rule",
          triggerHash: "sha256:trigger-1-trigger",
          type: "executable",
          summary: "Broken trigger",
          priority: 0,
          match: { kind: "glob", value: "data/accounting/**" },
        },
      ],
      triggerResults: [],
      errors: [
        {
          ruleId: "trigger-1",
          error: "trigger exploded",
        },
      ],
      subagentTasks: [],
    };

    const exec = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesJsonResponse),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(executionResultWithError),
        stderr: "",
        code: 0,
        killed: false,
      });
    const controller = new PiBrainsController(createMockPi(exec), { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = createContext();

    const result = await controller.handleToolCall(createReadEvent("data/accounting/q1.ledger"), ctx);

    expect(result).toBeUndefined();
  });

  it("renders skipped trigger state when another trigger blocks", async () => {
    const executionResultWithSkipped: ExecutionResult = {
      schemaVersion: 1,
      block: true,
      reason: "GitSense matched repository rules before this lifecycle event.\n\nEvent: pre_tool_use\nRuntime: pi\n\nOriginal event:\n- Tool: read\n- Action: read\n- File: /repo/data/accounting/q1.ledger\n\nMatched rules:\n\n1. Once trigger [tool-trigger]\n   Rule: trigger-1\n   Match: glob: data/accounting/**\n   Trigger result: (skipped - already executed)\n\n2. Blocking trigger [tool-trigger]\n   Rule: trigger-2\n   Match: glob: data/accounting/**\n   Trigger result:\n   - BLOCKED: Still blocked.\n\nRequired next steps:\n- Address all blocking trigger results above.",
      notices: [],
      matchedRules: [
        {
          ruleId: "trigger-1",
          ruleHash: "sha256:trigger-1-rule",
          triggerHash: "sha256:trigger-1-trigger",
          type: "executable",
          summary: "Once trigger",
          priority: 0,
          match: { kind: "glob", value: "data/accounting/**" },
        },
        {
          ruleId: "trigger-2",
          ruleHash: "sha256:trigger-2-rule",
          triggerHash: "sha256:trigger-2-trigger",
          type: "executable",
          summary: "Blocking trigger",
          priority: 0,
          match: { kind: "glob", value: "data/accounting/**" },
        },
      ],
      triggerResults: [
        {
          ruleId: "trigger-2",
          matched: true,
          block: true,
          message: "Still blocked.",
        },
      ],
      errors: [],
      subagentTasks: [],
    };

    const exec = vi.fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify(rulesJsonResponse),
        stderr: "",
        code: 0,
        killed: false,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify(executionResultWithSkipped),
        stderr: "",
        code: 0,
        killed: false,
      });
    const controller = new PiBrainsController(createMockPi(exec), { ...DEFAULT_CONFIG, rulesEnabled: true });
    const ctx = createContext();

    const result = await controller.handleToolCall(createReadEvent("data/accounting/q1.ledger"), ctx);

    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("Once trigger [tool-trigger]");
    expect(result?.reason).toContain("Trigger result: (skipped - already executed)");
    expect(result?.reason).toContain("BLOCKED: Still blocked.");
  });
});
