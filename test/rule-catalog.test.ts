import { readFileSync } from "node:fs";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
	handleRecorderRulesCommand,
	handleShellRulesCommand,
  type RuleCatalogController,
} from "../extensions/pi-brains/rule-catalog.ts";

function createContext(options?: {
  selections?: string[];
  confirmations?: boolean[];
}) {
  const selections = [...(options?.selections ?? [])];
  const confirmations = [...(options?.confirmations ?? [])];
  const notify = vi.fn();
  const ctx = {
    cwd: "/repo",
    ui: {
      select: vi.fn(async () => selections.shift()),
      confirm: vi.fn(async () => confirmations.shift() ?? false),
      notify,
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notify };
}

function createController(
  runGscCommand: RuleCatalogController["runGscCommand"],
  enabled = true,
) {
  let rulesEnabled = enabled;
  const setRulesEnabled = vi.fn((value: boolean) => {
    rulesEnabled = value;
  });
  const controller: RuleCatalogController = {
    runGscCommand,
    isRulesEnabled: () => rulesEnabled,
    setRulesEnabled,
  };
  return { controller, setRulesEnabled };
}

describe("observable shell rule catalog", () => {
  it("installs advisory mode into an explicit personal scope", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const { controller, setRulesEnabled } = createController(runGscCommand, false);
    const { ctx, notify } = createContext({ confirmations: [true] });

    await handleShellRulesCommand("advisory personal", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith(
      "rules", "import", expect.stringMatching(/rules\/gsc-bash-observability\/advisory\.bundle\.json$/),
      "--target", "personal", "--allow-executable", "--on-conflict", "replace", "--format", "json",
    );
    expect(setRulesEnabled).toHaveBeenCalledWith(true);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Advisory (personal)"), "info");
  });

  it("reports when an existing rule was updated", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ rulesReplaced: ["rule_pi_bash_observability_v1"] }),
      stderr: "",
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext({ confirmations: [true] });

    await handleShellRulesCommand("advisory personal", controller, ctx);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Updated observable shell discovery"), "info");
  });

  it("prompts for mode and repository scope", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({ code: 0, stdout: "{}", stderr: "" });
    const { controller } = createController(runGscCommand);
    const { ctx } = createContext({
      selections: [
        "Strict - block unwrapped discovery commands",
        "Repository - share with this project",
      ],
      confirmations: [true],
    });

    await handleShellRulesCommand("", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith(
      "rules", "import", expect.stringMatching(/strict\.bundle\.json$/),
      "--target", "repo", "--allow-executable", "--on-conflict", "replace", "--format", "json",
    );
  });

  it("surfaces successful import warnings", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ warnings: ["Rules Brain rebuild was skipped"] }),
      stderr: "",
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext({ confirmations: [true] });

    await handleShellRulesCommand("advisory personal", controller, ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Rules Brain rebuild was skipped"),
      "warning",
    );
  });

  it("reports a current installed rule with frequency and bundle version", async () => {
    const bundle = JSON.parse(readFileSync(new URL(
      "../rules/gsc-bash-observability/advisory.bundle.json",
      import.meta.url,
    ), "utf8")) as { rules: Array<{ rule: { tags: string[] } }> };
    const revisionTag = bundle.rules[0].rule.tags.find(tag => tag.startsWith("bundle-revision-"));
    const records = [
      {
        source: "personal",
        rule: {
          id: "rule_pi_bash_observability_v1",
          trigger: { entry: "gsc-bash-observability-advisory-v1/trigger.mjs" },
          frequency: { mode: "always" },
          tags: [revisionTag],
        },
      },
    ];
    const runGscCommand = vi.fn().mockResolvedValue({
      code: 0, stdout: JSON.stringify(records), stderr: "",
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext();

    await handleShellRulesCommand("status", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith("rules", "list", "--scope", "all", "--format", "json");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("frequency always"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Current"), "info");
  });

  it("reports a stale recognized rule as update available", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{
        source: "repo",
        rule: {
          id: "rule_pi_bash_observability_v1",
          trigger: { entry: "gsc-bash-observability-strict-v1/trigger.mjs" },
          frequency: { mode: "once-per-context" },
          tags: ["bundle-revision-stale"],
        },
      }]),
      stderr: "",
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext();

    await handleShellRulesCommand("status", controller, ctx);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("frequency once-per-context"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Update available"), "info");
  });

  it("preserves custom-rule identity in status", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([{
        source: "personal",
        rule: {
          id: "rule_pi_bash_observability_v1",
          trigger: { entry: "my-observable-shell/trigger.mjs" },
          frequency: { mode: "once-per-session" },
          tags: ["owner-custom"],
        },
      }]),
      stderr: "",
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext();

    await handleShellRulesCommand("status", controller, ctx);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Custom · frequency once-per-session"), "info");
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("Update available"), "info");
  });

  it("removes only the selected shell policy", async () => {
    const runGscCommand = vi.fn(async (...args: string[]) => {
      if (args[1] === "list") {
        return {
          code: 0,
          stdout: JSON.stringify([{
            source: "personal",
            rule: {
              id: "rule_pi_bash_observability_v1",
              trigger: { entry: "gsc-bash-observability-advisory-v1/trigger.mjs" },
            },
          }]),
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    });
    const { controller, setRulesEnabled } = createController(runGscCommand);
    const { ctx } = createContext({ confirmations: [true] });

    await handleShellRulesCommand("off personal", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith(
      "rules", "delete", "rule_pi_bash_observability_v1", "--target", "personal", "--force",
    );
    expect(setRulesEnabled).not.toHaveBeenCalled();
  });

  it("does nothing when configuration is cancelled", async () => {
    const runGscCommand = vi.fn();
    const { controller } = createController(runGscCommand);
    const { ctx } = createContext({ selections: ["Cancel"] });

    await handleShellRulesCommand("", controller, ctx);

    expect(runGscCommand).not.toHaveBeenCalled();
  });
});

describe("Pi edit recorder rule catalog", () => {
  it("installs the recorder in personal scope", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({ rulesAdded: ["gsc-pi-edit-history-pre", "gsc-pi-edit-history-post"] }),
      stderr: "",
    });
    const { controller, setRulesEnabled } = createController(runGscCommand, false);
    const { ctx, notify } = createContext({ confirmations: [true] });

    await handleRecorderRulesCommand("personal", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith(
      "pi", "rules", "recorder", "install", "--format", "json",
    );
    expect(setRulesEnabled).toHaveBeenCalledWith(true);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Installed personal Pi edit recorder"), "info");
  });

  it("rejects repository scope", async () => {
    const runGscCommand = vi.fn();
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext();

    await handleRecorderRulesCommand("install repo", controller, ctx);

    expect(runGscCommand).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("personal-only"), "warning");
  });

  it("shows recorder status", async () => {
    const runGscCommand = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify({
        installed: true,
        storageRoot: "/Users/test/gitsense/data/pi/edit-history",
        rules: {
          "gsc-pi-edit-history-pre": true,
          "gsc-pi-edit-history-post": true,
        },
      }),
      stderr: "",
    });
    const { controller } = createController(runGscCommand);
    const { ctx, notify } = createContext();

    await handleRecorderRulesCommand("status", controller, ctx);

    expect(runGscCommand).toHaveBeenCalledWith(
      "pi", "rules", "recorder", "status", "--format", "json",
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Pre-capture   Installed"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("/Users/test/gitsense/data/pi/edit-history/<session-id>"), "info");
  });
});
