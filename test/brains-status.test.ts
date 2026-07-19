import type { ExtensionCommandContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  isSuccessfulExpertsInit,
  showBrainsStatus,
  type BrainsStatusController,
} from "../extensions/pi-brains/brains-status.ts";

function bashResult(command: string, isError = false): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "tool-1",
    toolName: "bash",
    input: { command },
    content: [],
    details: undefined,
    isError,
  };
}

function createContext() {
  const notify = vi.fn();
  return {
    ctx: { ui: { notify } } as unknown as ExtensionCommandContext,
    notify,
  };
}

function renderedStatus(notify: ReturnType<typeof vi.fn>): string {
  return notify.mock.calls[0]?.[0] as string;
}

describe("brains status", () => {
  it("recognizes a successful experts init command", () => {
    expect(isSuccessfulExpertsInit(bashResult("gsc experts init"))).toBe(true);
    expect(isSuccessfulExpertsInit(bashResult("cd /repo && gsc experts init --force"))).toBe(true);
    expect(isSuccessfulExpertsInit(bashResult("gsc experts init", true))).toBe(false);
    expect(isSuccessfulExpertsInit(bashResult("gsc experts status"))).toBe(false);
  });

  it("renders current knowledge, discovery, observability, and rule settings", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args[0] === "experts") {
        return { code: 0, stdout: "Expertise  Current", stderr: "" };
      }
      if (args[0] === "brains") {
        return { code: 0, stdout: JSON.stringify({ databases: [{}, {}, {}] }), stderr: "" };
      }
      return {
        code: 0,
        stdout: JSON.stringify([
          {
            source: "personal",
            rule: {
              id: "rule_pi_bash_observability_v1",
              trigger: { entry: "gsc-bash-observability-advisory-v1/trigger.mjs" },
            },
          },
          { source: "repo", rule: { id: "rule-project" } },
          {
            source: "repo",
            rule: {
              id: "rule_pi_bash_observability_v1",
              trigger: { entry: "gsc-bash-observability-strict-v1/trigger.mjs" },
            },
          },
        ]),
        stderr: "",
      };
    });
    const controller: BrainsStatusController = {
      runGscCommand,
      isRulesEnabled: () => true,
      isGitSenseGuidanceLoaded: () => true,
    };
    const { ctx, notify } = createContext();

    await showBrainsStatus(controller, ctx);

    const message = renderedStatus(notify);
    expect(message).toContain("[Brains Status]");
    expect(message).toContain("GitSense guidance   In context");
    expect(message).toContain("Brains              3 active");
    expect(message).toContain("Advisory (personal) · Strict (repository)");
    expect(message).toContain("Observability       Enforced · supported discovery must use gsc bash");
    expect(message).toContain("Rules               ON · 1 personal · 2 repository");
    expect(notify).toHaveBeenCalledWith(expect.any(String), "info");
  });

  it("does not report zero rules when the rules query fails", async () => {
    const controller: BrainsStatusController = {
      runGscCommand: vi.fn(async (...args: string[]) => args[0] === "rules"
        ? { code: 1, stdout: "", stderr: "failed" }
        : { code: 0, stdout: args[0] === "brains" ? '{"databases":[]}' : "Current", stderr: "" }),
      isRulesEnabled: () => true,
      isGitSenseGuidanceLoaded: () => false,
    };
    const { ctx, notify } = createContext();

    await showBrainsStatus(controller, ctx);

    const message = renderedStatus(notify);
    expect(message).toContain("Rules               Unavailable");
    expect(message).toContain("Discovery           Unavailable");
    expect(message).toContain("Observability       Unavailable");
  });

  it("distinguishes an unconfigured policy from disabled rule checking", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => ({
      code: 0,
      stdout: args[0] === "brains" ? '{"databases":[]}' : "[]",
      stderr: "",
    }));
    const context = createContext();
    await showBrainsStatus({
      runGscCommand,
      isRulesEnabled: () => true,
      isGitSenseGuidanceLoaded: () => false,
    }, context.ctx);
    expect(renderedStatus(context.notify)).toContain(
      "Observability       Off · observable shell policy not configured",
    );

    const disabledContext = createContext();
    await showBrainsStatus({
      runGscCommand,
      isRulesEnabled: () => false,
      isGitSenseGuidanceLoaded: () => false,
    }, disabledContext.ctx);
    expect(renderedStatus(disabledContext.notify)).toContain(
      "Observability       Disabled · rules checking is off",
    );
  });

  it("describes advisory observability as best effort", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => ({
      code: 0,
      stdout: args[0] === "brains"
        ? '{"databases":[]}'
        : JSON.stringify([{
            source: "personal",
            rule: {
              id: "rule_pi_bash_observability_v1",
              trigger: { entry: "gsc-bash-observability-advisory-v1/trigger.mjs" },
            },
          }]),
      stderr: "",
    }));
    const context = createContext();

    await showBrainsStatus({
      runGscCommand,
      isRulesEnabled: () => true,
      isGitSenseGuidanceLoaded: () => true,
    }, context.ctx);

    expect(renderedStatus(context.notify)).toContain(
      "Observability       Best effort · unwrapped commands allowed",
    );
  });
});
