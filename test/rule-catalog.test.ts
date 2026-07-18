import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
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

  it("reports configured modes in both scopes", async () => {
    const records = [
      {
        source: "personal",
        rule: {
          id: "rule_pi_bash_observability_v1",
          trigger: { entry: "gsc-bash-observability-advisory-v1/trigger.mjs" },
        },
      },
      {
        source: "repo",
        rule: {
          id: "rule_pi_bash_observability_v1",
          trigger: { entry: "gsc-bash-observability-strict-v1/trigger.mjs" },
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
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Personal    Advisory"), "info");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Repository  Strict"), "info");
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
