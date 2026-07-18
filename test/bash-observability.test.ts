import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { BashObservability } from "../extensions/pi-brains/bash-observability.ts";
import { DEFAULT_CONFIG } from "../extensions/pi-brains/config.ts";
import { DebugLogger } from "../extensions/pi-brains/debug.ts";

const sessionFile = "/repo/session.jsonl";

function registration(alias = "a1b2c3") {
  return JSON.stringify({
    schema_version: 1,
    alias,
    session_id: "session-id",
    session_file: sessionFile,
    sidecar_file: "/repo/session.bash.jsonl",
  });
}

function createSubject(exec: ReturnType<typeof vi.fn>) {
  const pi = { exec } as unknown as ExtensionAPI;
  return new BashObservability(pi, new DebugLogger(() => ({ ...DEFAULT_CONFIG, debug: false })));
}

function bashEvent(command: string): ToolCallEvent {
  return {
    type: "tool_call",
    toolName: "bash",
    toolCallId: "tool-call-1",
    input: { command },
  } as ToolCallEvent;
}

describe("BashObservability", () => {
  it("registers a session once and exposes the agent instruction", async () => {
    const exec = vi.fn().mockResolvedValue({
      stdout: registration(), stderr: "", code: 0, killed: false,
    });
    const subject = createSubject(exec);

    await subject.ensureRegistration("/repo");
    expect(exec).not.toHaveBeenCalled();

    subject.bindSession(sessionFile);
    await subject.ensureRegistration("/repo");
    await subject.ensureRegistration("/repo");

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("gsc", [
      "bash", "register", "--session-file", sessionFile, "--format", "json",
    ], expect.objectContaining({ cwd: "/repo" }));
    expect(subject.getInstruction()).toContain("gsc bash -s a1b2c3");
  });

  it("refreshes brains and decorates bash calls with correlation context", async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce({ stdout: registration(), stderr: "", code: 0, killed: false })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ databases: [
          { name: "code-intent" }, { name: "gsc-rules" }, { name: "code-intent" },
        ] }),
        stderr: "",
        code: 0,
        killed: false,
      });
    const subject = createSubject(exec);
    subject.bindSession(sessionFile);
    await subject.ensureRegistration("/repo");
    await subject.refreshBrains("/repo");
    const event = bashEvent("gsc bash -s a1b2c3 rg needle . | gsc bash -s a1b2c3 head -n 20");

    expect(subject.decorateToolCall(event)).toBe(true);
    const command = (event.input as { command: string }).command;
    expect(command).toContain("GSC_BASH_AGENT='pi'");
    expect(command).toContain("GSC_BASH_TOOL_CALL_ID='tool-call-1'");
    expect(command).toContain("GSC_BASH_COMPOSITION_ID='");
    expect(command).toContain("GSC_BASH_BRAINS='code-intent,gsc-rules'");
    expect(command.endsWith("gsc bash -s a1b2c3 rg needle . | gsc bash -s a1b2c3 head -n 20")).toBe(true);
  });

  it("fails open when registration or brain discovery fails", async () => {
    const exec = vi.fn()
      .mockResolvedValueOnce({ stdout: "", stderr: "missing", code: 1, killed: false })
      .mockRejectedValueOnce(new Error("unavailable"));
    const subject = createSubject(exec);
    subject.bindSession(sessionFile);

    await subject.ensureRegistration("/repo");
    await subject.refreshBrains("/repo");
    const event = bashEvent("rg needle .");

    expect(subject.getInstruction()).toBeNull();
    expect(subject.decorateToolCall(event)).toBe(false);
    expect((event.input as { command: string }).command).toBe("rg needle .");
  });

  it("re-registers when Pi creates or switches the session file", async () => {
    const secondSession = "/repo/second.jsonl";
    const exec = vi.fn()
      .mockResolvedValueOnce({ stdout: registration(), stderr: "", code: 0, killed: false })
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          schema_version: 1,
          alias: "d4e5f6",
          session_id: "second-id",
          session_file: secondSession,
          sidecar_file: "/repo/second.bash.jsonl",
        }),
        stderr: "",
        code: 0,
        killed: false,
      });
    const subject = createSubject(exec);

    subject.bindSession(sessionFile);
    await subject.ensureRegistration("/repo");
    subject.bindSession(secondSession);
    await subject.ensureRegistration("/repo");

    expect(exec).toHaveBeenCalledTimes(2);
    expect(subject.getAlias()).toBe("d4e5f6");
  });
});
