import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rulesDir = resolve(root, "rules/gsc-bash-observability");
const exportedAt = "2026-07-17T00:00:00Z";
const ruleID = "rule_pi_bash_observability_v1";
const commandFilter = String.raw`(^|[|;&\n])[ \t]*[^|;&\n]*(rg|grep|find|ls|head|tail|wc|sort|uniq)([ \t]|$)`;

const variants = {
  advisory: {
    summary: "Recommend observable wrappers for shell discovery",
    details: "Passively reminds Pi to run supported discovery commands through gsc bash so command intent and evidence can be correlated with the session.",
    importance: "medium",
    frequency: "once-per-context",
    instruction: "Use gsc bash with the session alias for supported discovery commands and wrap every pipeline segment separately.",
    priority: 60,
  },
  strict: {
    summary: "Require observable wrappers for shell discovery",
    details: "Blocks supported discovery commands that do not use gsc bash, preserving structured command intent and evidence for the Pi session.",
    importance: "high",
    frequency: "always",
    instruction: "Run supported discovery commands through gsc bash with the session alias and wrap every pipeline segment separately.",
    priority: 100,
  },
};

for (const [name, variant] of Object.entries(variants)) {
  const triggerSource = readFileSync(resolve(rulesDir, `${name}-trigger.mjs`));
  const entry = `gsc-bash-observability-${name}-v1/trigger.mjs`;
  const bundle = {
    schemaVersion: "gsc.rules.bundle.v1",
    exportedAt,
    source: { scope: "repo" },
    topics: [{
      slug: "agent-observability",
      description: "Structured evidence and analytics for agent tool usage",
      created_at: exportedAt,
      updated_at: exportedAt,
    }],
    rules: [{
      source: "repo",
      rule: {
        id: ruleID,
        schema_version: "3.0.0",
        created_at: exportedAt,
        updated_at: exportedAt,
        summary: variant.summary,
        details: variant.details,
        topic: "agent-observability",
        related_topics: [],
        event: "pre_tool_use",
        instructions: [],
        actions: ["bash"],
        command_filter: commandFilter,
        glob_patterns: [],
        exclude_globs: [],
        applies_to: { files: [], linked_files: [], commands: [] },
        tags: ["gsc-bash", "pi", "observability"],
        keywords: ["bash", "discovery", "observability", "pi"],
        parent_keywords: ["agent-observability", "topic-knowledge"],
        importance: variant.importance,
        ai: { provider: "", model_id: "", agent: "" },
        confirmed_at: exportedAt,
        type: "executable",
        trigger: { runtime: "node", entry, timeoutMs: 3000 },
        instruction: { mode: "inline", text: variant.instruction },
        frequency: { mode: variant.frequency },
        priority: variant.priority,
        enabled: true,
      },
    }],
    assets: [{
      kind: "trigger",
      entry,
      sha256: `sha256:${createHash("sha256").update(triggerSource).digest("hex")}`,
      mode: 420,
      encoding: "base64",
      contentBase64: triggerSource.toString("base64"),
    }],
  };
  writeFileSync(resolve(rulesDir, `${name}.bundle.json`), `${JSON.stringify(bundle, null, 2)}\n`);
}
