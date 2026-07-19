import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const SHELL_RULE_ID = "rule_pi_bash_observability_v1";
const BUNDLE_REVISION_TAG_PREFIX = "bundle-revision-";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type RuleScope = "personal" | "repo";
type ShellRuleMode = "advisory" | "strict";

export interface RuleCatalogController {
  runGscCommand(...args: string[]): Promise<{ code: number; stdout: string; stderr: string } | null>;
  isRulesEnabled(): boolean;
  setRulesEnabled(enabled: boolean): void;
}

interface ListedRule {
  source?: unknown;
  rule?: {
    id?: unknown;
    trigger?: { entry?: unknown };
    frequency?: { mode?: unknown };
    tags?: unknown;
  };
}

interface RulesImportResult {
  warnings?: unknown;
  rulesAdded?: unknown;
  rulesReplaced?: unknown;
}

interface PackagedShellRule {
  frequency: string;
  revision: string;
}

export async function handleShellRulesCommand(
  value: string,
  controller: RuleCatalogController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  let action = parts[0];

  if (!action) {
    const selected = await ctx.ui.select("Observable shell discovery", [
      "Advisory - remind for every unwrapped discovery command",
      "Strict - block unwrapped discovery commands",
      "Status",
      "Off - remove the policy",
      "Cancel",
    ]);
    if (!selected || selected === "Cancel") return;
    action = selected.startsWith("Advisory")
      ? "advisory"
      : selected.startsWith("Strict")
        ? "strict"
        : selected.startsWith("Off")
          ? "off"
          : "status";
  }

  if (action === "status") {
    await showShellRuleStatus(controller, ctx);
    return;
  }
  if (action !== "advisory" && action !== "strict" && action !== "off") {
    notifyUsage(ctx);
    return;
  }

  const scope = await resolveScope(parts[1], ctx);
  if (!scope) return;
  if (parts.length > 2) {
    notifyUsage(ctx);
    return;
  }

  if (action === "off") {
    await removeShellRule(scope, controller, ctx);
    return;
  }

  await installShellRule(action, scope, controller, ctx);
}

async function resolveScope(value: string | undefined, ctx: ExtensionCommandContext): Promise<RuleScope | null> {
  if (value === "personal" || value === "repo") return value;
  if (value) {
    ctx.ui.notify(`Unknown rule scope: ${value}. Use personal or repo.`, "warning");
    return null;
  }
  const selected = await ctx.ui.select("Install observable shell discovery rule", [
    "Personal - use across repositories",
    "Repository - share with this project",
    "Cancel",
  ]);
  if (!selected || selected === "Cancel") return null;
  return selected.startsWith("Personal") ? "personal" : "repo";
}

async function installShellRule(
  mode: ShellRuleMode,
  scope: RuleScope,
  controller: RuleCatalogController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const behavior = mode === "strict"
    ? "Blocks supported discovery commands unless every segment uses gsc bash."
    : "Evaluates every violation and passively reminds the agent; commands are not blocked.";
  const destination = scope === "personal"
    ? "This applies across your repositories."
    : "This writes executable rule metadata and trigger assets into this repository.";
  const confirmed = await ctx.ui.confirm(
    `Install ${mode} observable shell rule?`,
    `${behavior}\n\n${destination}\n\nThe trigger only inspects bash command text and does not execute or rewrite it.`,
  );
  if (!confirmed) return;

  const bundle = resolve(packageRoot, "rules", "gsc-bash-observability", `${mode}.bundle.json`);
  const result = await controller.runGscCommand(
    "rules", "import", bundle,
    "--target", scope,
    "--allow-executable",
    "--on-conflict", "replace",
    "--format", "json",
  );
  if (!result || result.code !== 0) {
    notifyFailure(ctx, "install observable shell rule", result);
    return;
  }

  if (!controller.isRulesEnabled()) controller.setRulesEnabled(true);
  const warnings = parseImportWarnings(result.stdout);
  const outcome = parseImportOutcome(result.stdout);
  const warningText = warnings.length > 0 ? `\n\nWarnings:\n${warnings.map(item => `- ${item}`).join("\n")}` : "";
  ctx.ui.notify(
    `${outcome} observable shell discovery: ${capitalize(mode)} (${scope})\nRules checking: ON${warningText}`,
    warnings.length > 0 ? "warning" : "info",
  );
}

async function removeShellRule(
  scope: RuleScope,
  controller: RuleCatalogController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const configured = await loadShellRuleStatus(controller);
  if (!configured) {
    ctx.ui.notify("Could not read configured GitSense rules.", "error");
    return;
  }
  if (!configured.has(scope)) {
    ctx.ui.notify(`Observable shell discovery is not configured in ${scope} scope.`, "info");
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Remove observable shell discovery rule?",
    `Remove the policy from ${scope} scope? Other GitSense rules are not affected.`,
  );
  if (!confirmed) return;

  const result = await controller.runGscCommand(
    "rules", "delete", SHELL_RULE_ID, "--target", scope, "--force",
  );
  if (!result || result.code !== 0) {
    notifyFailure(ctx, "remove observable shell rule", result);
    return;
  }
  ctx.ui.notify(`Observable shell discovery removed from ${scope} scope.`, "info");
}

async function showShellRuleStatus(
  controller: RuleCatalogController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const configured = await loadShellRuleStatus(controller);
  if (!configured) {
    ctx.ui.notify("Could not read configured GitSense rules.", "error");
    return;
  }
  const personal = configured.get("personal") ?? "Not configured";
  const repo = configured.get("repo") ?? "Not configured";
  ctx.ui.notify(
    `Observable shell discovery\n\nPersonal    ${personal}\nRepository  ${repo}\nRules check ${controller.isRulesEnabled() ? "ON" : "OFF"}`,
    "info",
  );
}

async function loadShellRuleStatus(
  controller: RuleCatalogController,
): Promise<Map<RuleScope, string> | null> {
  const result = await controller.runGscCommand("rules", "list", "--scope", "all", "--format", "json");
  if (!result || result.code !== 0) return null;
  try {
    const records = JSON.parse(result.stdout) as ListedRule[];
    const packaged = loadPackagedShellRules();
    const status = new Map<RuleScope, string>();
    for (const record of records) {
      if (record.rule?.id !== SHELL_RULE_ID) continue;
      if (record.source !== "personal" && record.source !== "repo") continue;
      const entry = record.rule.trigger?.entry;
      const mode: ShellRuleMode | "custom" = typeof entry === "string" && entry.includes("strict")
        ? "strict"
        : typeof entry === "string" && entry.includes("advisory")
          ? "advisory"
          : "custom";
      const frequency = typeof record.rule.frequency?.mode === "string"
        ? record.rule.frequency.mode
        : "unknown";
      const revision = findBundleRevision(record.rule.tags);
      const version = revision ? revision.slice(BUNDLE_REVISION_TAG_PREFIX.length) : "unknown";
      let freshness = "Custom";
      if (mode !== "custom") {
        const expected = packaged.get(mode);
        freshness = expected && expected.frequency === frequency && expected.revision === revision
          ? "Current"
          : "Update available";
      }
      status.set(
        record.source,
        `${capitalize(mode)} · frequency ${frequency} · version ${version} · ${freshness}`,
      );
    }
    return status;
  } catch {
    return null;
  }
}

function loadPackagedShellRules(): Map<ShellRuleMode, PackagedShellRule> {
  const packaged = new Map<ShellRuleMode, PackagedShellRule>();
  for (const mode of ["advisory", "strict"] as const) {
    try {
      const bundlePath = resolve(packageRoot, "rules", "gsc-bash-observability", `${mode}.bundle.json`);
      const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as {
        rules?: Array<{ rule?: { frequency?: { mode?: unknown }; tags?: unknown } }>;
      };
      const rule = bundle.rules?.[0]?.rule;
      const frequency = rule?.frequency?.mode;
      const revision = findBundleRevision(rule?.tags);
      if (typeof frequency === "string" && revision) packaged.set(mode, { frequency, revision });
    } catch {
      // Missing or malformed package metadata makes recognized installations stale.
    }
  }
  return packaged;
}

function findBundleRevision(tags: unknown): string | undefined {
  return Array.isArray(tags)
    ? tags.find((tag): tag is string => typeof tag === "string" && tag.startsWith(BUNDLE_REVISION_TAG_PREFIX))
    : undefined;
}

function parseImportWarnings(stdout: string): string[] {
  try {
    const parsed = JSON.parse(stdout) as RulesImportResult;
    return Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
}

function parseImportOutcome(stdout: string): "Installed" | "Updated" | "Applied" {
  try {
    const parsed = JSON.parse(stdout) as RulesImportResult;
    if (Array.isArray(parsed.rulesReplaced) && parsed.rulesReplaced.includes(SHELL_RULE_ID)) return "Updated";
    if (Array.isArray(parsed.rulesAdded) && parsed.rulesAdded.includes(SHELL_RULE_ID)) return "Installed";
  } catch {
    // Keep a truthful generic result for older gsc versions or non-JSON output.
  }
  return "Applied";
}

function notifyFailure(
  ctx: ExtensionCommandContext,
  action: string,
  result: { stderr: string; stdout: string } | null,
): void {
  const detail = result ? (result.stderr || result.stdout).trim() : "gsc command failed";
  ctx.ui.notify(`Could not ${action}${detail ? `:\n${detail}` : "."}`, "error");
}

function notifyUsage(ctx: ExtensionCommandContext): void {
  ctx.ui.notify(
    "Usage: /brains rules shell [advisory|strict|off|status] [personal|repo]",
    "warning",
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
