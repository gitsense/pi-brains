import type { ExtensionCommandContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { isExpertsInitCommand } from "./guidance-context.ts";
import { showOutputPanel } from "./output-panel.ts";

const SHELL_RULE_ID = "rule_pi_bash_observability_v1";

type RuleScope = "personal" | "repo";
type ShellMode = "Advisory" | "Strict" | "Custom";

export interface BrainsStatusController {
  runGscCommand(...args: string[]): Promise<{ code: number; stdout: string; stderr: string } | null>;
  isRulesEnabled(): boolean;
  isGitSenseGuidanceLoaded(): boolean;
}

interface ListedRule {
  source?: unknown;
  rule?: {
    id?: unknown;
    trigger?: { entry?: unknown };
  };
}

interface BrainsSummary {
  databases?: unknown;
}

interface StatusRow {
  label: string;
  value: string;
}

export function isSuccessfulExpertsInit(event: ToolResultEvent): boolean {
  if (event.toolName !== "bash" || event.isError) return false;
  const command = event.input?.command;
  if (typeof command !== "string") return false;
  return isExpertsInitCommand(command);
}

export async function showBrainsStatus(
  controller: BrainsStatusController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const [brainsResult, rulesResult] = await Promise.all([
    controller.runGscCommand("brains", "--summary"),
    controller.runGscCommand("rules", "list", "--scope", "all", "--format", "json"),
  ]);

  const expertContext = controller.isGitSenseGuidanceLoaded()
    ? "In context"
    : "Not in context";
  const brainCount = parseBrainCount(brainsResult);
  const rules = parseRules(rulesResult);
  const rulesEnabled = controller.isRulesEnabled();
  const discovery = rules.available ? formatDiscovery(rules.shellModes) : "Unavailable";
  const observability = rules.available ? formatObservability(rulesEnabled, rules.shellModes) : "Unavailable";
  const rulesStatus = rules.available
    ? `${rulesEnabled ? "ON" : "OFF"} · ${rules.personal} personal · ${rules.repo} repository`
    : "Unavailable";

  const rows: StatusRow[] = [
    { label: "GitSense guidance", value: expertContext },
    { label: "Brains", value: brainCount === null ? "Unavailable" : `${brainCount} active` },
    { label: "Discovery", value: discovery },
    { label: "Observability", value: observability },
    { label: "Rules", value: rulesStatus },
  ];

  const labelWidth = Math.max(...rows.map((row) => row.label.length)) + 3;
  const lines = ["[Brains Status]"];
  for (const row of rows) {
    lines.push(`  ${row.label.padEnd(labelWidth)}${row.value}`);
  }
  await showOutputPanel(ctx, "[Brains Status]", lines.slice(1).join("\n"));
}

function parseBrainCount(result: Awaited<ReturnType<BrainsStatusController["runGscCommand"]>>): number | null {
  if (!result || result.code !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as BrainsSummary;
    return Array.isArray(parsed.databases) ? parsed.databases.length : null;
  } catch {
    return null;
  }
}

function parseRules(result: Awaited<ReturnType<BrainsStatusController["runGscCommand"]>>): {
  available: boolean;
  personal: number;
  repo: number;
  shellModes: Map<RuleScope, ShellMode>;
} {
  const fallback = { available: false, personal: 0, repo: 0, shellModes: new Map<RuleScope, ShellMode>() };
  if (!result || result.code !== 0) return fallback;
  try {
    const records = JSON.parse(result.stdout) as ListedRule[];
    if (!Array.isArray(records)) return fallback;
    const shellModes = new Map<RuleScope, ShellMode>();
    let personal = 0;
    let repo = 0;
    for (const record of records) {
      if (record.source === "personal") personal++;
      if (record.source === "repo") repo++;
      if (record.rule?.id !== SHELL_RULE_ID) continue;
      if (record.source !== "personal" && record.source !== "repo") continue;
      const entry = record.rule.trigger?.entry;
      const mode = typeof entry === "string" && entry.includes("strict")
        ? "Strict"
        : typeof entry === "string" && entry.includes("advisory")
          ? "Advisory"
          : "Custom";
      shellModes.set(record.source, mode);
    }
    return { available: true, personal, repo, shellModes };
  } catch {
    return fallback;
  }
}

function formatDiscovery(modes: Map<RuleScope, ShellMode>): string {
  const values: string[] = [];
  const personal = modes.get("personal");
  const repo = modes.get("repo");
  if (personal) values.push(`${personal} (personal)`);
  if (repo) values.push(`${repo} (repository)`);
  return values.length > 0 ? values.join(" · ") : "Not configured";
}

function formatObservability(rulesEnabled: boolean, modes: Map<RuleScope, ShellMode>): string {
  if (!rulesEnabled) return "Disabled · rules checking is off";
  const configured = [...modes.values()];
  if (configured.includes("Strict")) return "Enforced · supported discovery must use gsc bash";
  if (configured.includes("Advisory")) return "Best effort · unwrapped commands allowed";
  if (configured.length > 0) return "Best effort · custom shell policy";
  return "Off · observable shell policy not configured";
}
