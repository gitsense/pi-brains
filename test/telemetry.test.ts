import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DebugLogger } from "../extensions/pi-brains/debug.ts";
import {
  buildTelemetryEvent,
  deriveSidecarPath,
  resolveOutcome,
  RuleTelemetryWriter,
  RULE_TELEMETRY_SCHEMA_VERSION,
  type RuleTelemetryEventV1,
} from "../extensions/pi-brains/rules/telemetry.ts";

function createTestWriter(tmpDir: string): RuleTelemetryWriter {
  const debug = new DebugLogger(() => ({ debug: false } as any));
  return new RuleTelemetryWriter(debug);
}

function createTestEvent(overrides?: Partial<RuleTelemetryEventV1>): RuleTelemetryEventV1 {
  return {
    schemaVersion: RULE_TELEMETRY_SCHEMA_VERSION,
    type: "rule_event",
    id: "ruleevt_test_1",
    timestamp: "2026-07-04T12:34:56.000Z",
    session: {
      id: "session-1",
      path: "/repo/session.jsonl",
      cwd: "/repo",
      entryId: "entry-1",
      parentId: "entry-0",
      leafId: "entry-1",
    },
    event: {
      lifecycle: "pre_tool_use",
      action: "read",
      toolName: "read",
      toolCallId: "call_123",
      command: null,
      filePath: "/repo/src/index.ts",
      normalizedFile: "src/index.ts",
      repoRoot: "/repo",
    },
    rule: {
      id: "rule-1",
      hash: "sha256:abc123",
      triggerHash: null,
      type: "declarative",
      source: "repo",
      summary: "Test rule",
      instructions: ["Run tests before committing."],
      event: "pre_tool_use",
      priority: 0,
      importance: "medium",
      frequencyMode: null,
    },
    match: {
      kind: "glob",
      value: "src/**/*.ts",
      file: "src/index.ts",
      action: "read",
    },
    result: {
      outcome: "blocked",
      matched: true,
      executed: false,
      triggerMatched: false,
      blocked: true,
      deliveryPaused: false,
      policyBlocked: true,
      skipped: false,
      delivered: true,
      deliveryMode: null,
      durationMs: null,
      notice: null,
      message: null,
      error: null,
    },
    ...overrides,
  };
}

describe("sidecar path derivation", () => {
  it("replaces .jsonl extension with .rules.jsonl", () => {
    expect(deriveSidecarPath("/repo/session.jsonl")).toBe("/repo/session.rules.jsonl");
  });

  it("appends .rules.jsonl if path does not end with .jsonl", () => {
    expect(deriveSidecarPath("/repo/session")).toBe("/repo/session.rules.jsonl");
  });

  it("handles nested paths", () => {
    expect(deriveSidecarPath("/home/user/.pi/sessions/abc123.jsonl")).toBe(
      "/home/user/.pi/sessions/abc123.rules.jsonl",
    );
  });
});

describe("outcome resolution", () => {
  it("returns error when hasError is true", () => {
    expect(
      resolveOutcome({
        hasError: true,
        blocked: true,
        triggerMatched: true,
        executed: true,
        delivered: true,
        matched: true,
        skipped: true,
      }),
    ).toBe("error");
  });

  it("returns blocked when blocked is true (no error)", () => {
    expect(
      resolveOutcome({
        hasError: false,
        blocked: true,
        triggerMatched: true,
        executed: true,
        delivered: true,
        matched: true,
        skipped: false,
      }),
    ).toBe("blocked");
  });

  it("returns delivery_paused when declarative instructions pause the call", () => {
    expect(
      resolveOutcome({
        hasError: false,
        blocked: false,
        deliveryPaused: true,
        triggerMatched: false,
        executed: false,
        delivered: true,
        matched: true,
        skipped: false,
      }),
    ).toBe("delivery_paused");
  });

  it("returns triggered when triggerMatched is true (no error/block)", () => {
    expect(
      resolveOutcome({
        hasError: false,
        blocked: false,
        triggerMatched: true,
        executed: true,
        delivered: true,
        matched: true,
        skipped: false,
      }),
    ).toBe("triggered");
  });

  it("returns executed when executed is true (no error/block/triggerMatched)", () => {
    expect(
      resolveOutcome({
        hasError: false,
        blocked: false,
        triggerMatched: false,
        executed: true,
        delivered: true,
        matched: true,
        skipped: false,
      }),
    ).toBe("executed");
  });

  it("returns delivered when delivered is true (no error/block/triggerMatched/executed)", () => {
    expect(
      resolveOutcome({
        hasError: false,
        blocked: false,
        triggerMatched: false,
        executed: false,
        delivered: true,
        matched: true,
        skipped: false,
      }),
    ).toBe("delivered");
  });

  it("returns matched when matched is true (no error/block/triggerMatched/executed/delivered)", () => {
    expect(
      resolveOutcome({
        hasError: false,
        blocked: false,
        triggerMatched: false,
        executed: false,
        delivered: false,
        matched: true,
        skipped: false,
      }),
    ).toBe("matched");
  });

  it("returns skipped when no other flags are true", () => {
    expect(
      resolveOutcome({
        hasError: false,
        blocked: false,
        triggerMatched: false,
        executed: false,
        delivered: false,
        matched: false,
        skipped: true,
      }),
    ).toBe("skipped");
  });
});

describe("telemetry event builder", () => {
  it("generates unique UUID-based event IDs", () => {
    const event1 = buildTelemetryEvent({
      session: createTestEvent().session,
      event: createTestEvent().event,
      rule: createTestEvent().rule,
      match: createTestEvent().match,
      result: createTestEvent().result,
    });
    const event2 = buildTelemetryEvent({
      session: createTestEvent().session,
      event: createTestEvent().event,
      rule: createTestEvent().rule,
      match: createTestEvent().match,
      result: createTestEvent().result,
    });

    expect(event1.id).not.toBe(event2.id);
    // Should be ruleevt_<uuid> format
    expect(event1.id).toMatch(/^ruleevt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("sets schemaVersion to 1", () => {
    const event = buildTelemetryEvent({
      session: createTestEvent().session,
      event: createTestEvent().event,
      rule: createTestEvent().rule,
      match: createTestEvent().match,
      result: createTestEvent().result,
    });

    expect(event.schemaVersion).toBe(1);
  });

  it("sets type to rule_event", () => {
    const event = buildTelemetryEvent({
      session: createTestEvent().session,
      event: createTestEvent().event,
      rule: createTestEvent().rule,
      match: createTestEvent().match,
      result: createTestEvent().result,
    });

    expect(event.type).toBe("rule_event");
  });

  it("generates ISO timestamp", () => {
    const event = buildTelemetryEvent({
      session: createTestEvent().session,
      event: createTestEvent().event,
      rule: createTestEvent().rule,
      match: createTestEvent().match,
      result: createTestEvent().result,
    });

    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("telemetry writer", () => {
  it("writes valid JSONL to sidecar file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const sessionPath = join(tmpDir, "session.jsonl");
    const sidecarPath = join(tmpDir, "session.rules.jsonl");

    const writer = createTestWriter(tmpDir);
    writer.setSession(sessionPath);

    const event = createTestEvent();
    const written = await writer.write(event);

    expect(written).toBe(true);

    const content = readFileSync(sidecarPath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.type).toBe("rule_event");
    expect(parsed.id).toBe("ruleevt_test_1");

    rmSync(tmpDir, { recursive: true });
  });

  it("appends multiple events", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const sessionPath = join(tmpDir, "session.jsonl");
    const sidecarPath = join(tmpDir, "session.rules.jsonl");

    const writer = createTestWriter(tmpDir);
    writer.setSession(sessionPath);

    await writer.write(createTestEvent({ id: "evt-1" }));
    await writer.write(createTestEvent({ id: "evt-2" }));
    await writer.write(createTestEvent({ id: "evt-3" }));

    const content = readFileSync(sidecarPath, "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(3);

    const parsed1 = JSON.parse(lines[0]);
    const parsed2 = JSON.parse(lines[1]);
    const parsed3 = JSON.parse(lines[2]);

    expect(parsed1.id).toBe("evt-1");
    expect(parsed2.id).toBe("evt-2");
    expect(parsed3.id).toBe("evt-3");

    rmSync(tmpDir, { recursive: true });
  });

  it("returns false when session path is not set", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const writer = createTestWriter(tmpDir);

    const event = createTestEvent();
    const written = await writer.write(event);

    expect(written).toBe(false);

    rmSync(tmpDir, { recursive: true });
  });

  it("derives sidecar path from session path", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const sessionPath = join(tmpDir, "my-session.jsonl");

    const writer = createTestWriter(tmpDir);
    writer.setSession(sessionPath);

    expect(writer.getSidecarPath()).toBe(join(tmpDir, "my-session.rules.jsonl"));

    rmSync(tmpDir, { recursive: true });
  });

  it("handles missing session path without throwing", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const writer = createTestWriter(tmpDir);

    // Don't set session path
    const event = createTestEvent();
    const written = await writer.write(event);

    expect(written).toBe(false);

    rmSync(tmpDir, { recursive: true });
  });

  it("includes all required fields in written event", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const sessionPath = join(tmpDir, "session.jsonl");
    const sidecarPath = join(tmpDir, "session.rules.jsonl");

    const writer = createTestWriter(tmpDir);
    writer.setSession(sessionPath);

    const event = createTestEvent();
    await writer.write(event);

    const content = readFileSync(sidecarPath, "utf8");
    const parsed = JSON.parse(content.trim());

    // Check top-level fields
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.type).toBe("rule_event");
    expect(parsed.id).toMatch(/^ruleevt_/);
    expect(parsed.timestamp).toBeDefined();

    // Check session
    expect(parsed.session).toMatchObject({
      id: "session-1",
      path: "/repo/session.jsonl",
      cwd: "/repo",
    });

    // Check event
    expect(parsed.event).toMatchObject({
      lifecycle: "pre_tool_use",
      action: "read",
      toolName: "read",
    });

    // Check rule snapshot
    expect(parsed.rule).toMatchObject({
      id: "rule-1",
      hash: "sha256:abc123",
      type: "declarative",
      source: "repo",
      summary: "Test rule",
    });
    expect(parsed.rule.instructions).toEqual(["Run tests before committing."]);

    // Check match
    expect(parsed.match).toMatchObject({
      kind: "glob",
      value: "src/**/*.ts",
    });

    // Check result
    expect(parsed.result).toMatchObject({
      outcome: "blocked",
      matched: true,
      blocked: true,
      delivered: true,
    });

    rmSync(tmpDir, { recursive: true });
  });

  it("creates directory if it does not exist", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const nestedDir = join(tmpDir, "nested", "dir");
    const sessionPath = join(nestedDir, "session.jsonl");
    const sidecarPath = join(nestedDir, "session.rules.jsonl");

    const writer = createTestWriter(tmpDir);
    writer.setSession(sessionPath);

    const event = createTestEvent();
    const written = await writer.write(event);

    expect(written).toBe(true);

    const content = readFileSync(sidecarPath, "utf8");
    expect(content.trim()).toBeTruthy();

    rmSync(tmpDir, { recursive: true });
  });
});

describe("toolCallId preservation", () => {
  it("preserves toolCallId in telemetry events", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const sessionPath = join(tmpDir, "session.jsonl");
    const sidecarPath = join(tmpDir, "session.rules.jsonl");

    const writer = createTestWriter(tmpDir);
    writer.setSession(sessionPath);

    const event = createTestEvent({
      event: {
        lifecycle: "pre_tool_use",
        action: "bash",
        toolName: "bash",
        toolCallId: "call_456",
        command: "ls -la",
        filePath: null,
        normalizedFile: null,
        repoRoot: "/repo",
      },
    });
    const written = await writer.write(event);

    expect(written).toBe(true);

    const content = readFileSync(sidecarPath, "utf8");
    const parsed = JSON.parse(content.trim());

    expect(parsed.event.toolCallId).toBe("call_456");

    rmSync(tmpDir, { recursive: true });
  });

  it("preserves null toolCallId for non-tool lifecycle events", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "telemetry-test-"));
    const sessionPath = join(tmpDir, "session.jsonl");
    const sidecarPath = join(tmpDir, "session.rules.jsonl");

    const writer = createTestWriter(tmpDir);
    writer.setSession(sessionPath);

    const event = createTestEvent({
      event: {
        lifecycle: "session_start",
        action: "session_start",
        toolName: "session_start",
        toolCallId: null,
        command: null,
        filePath: null,
        normalizedFile: null,
        repoRoot: null,
      },
    });
    const written = await writer.write(event);

    expect(written).toBe(true);

    const content = readFileSync(sidecarPath, "utf8");
    const parsed = JSON.parse(content.trim());

    expect(parsed.event.toolCallId).toBeNull();

    rmSync(tmpDir, { recursive: true });
  });
});
