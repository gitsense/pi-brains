import type { GscRulesResponse, MatchedGscRule, RuleAction } from "./types.ts";

export function renderRuleBlockMessage(
  file: string,
  action: RuleAction,
  response: GscRulesResponse,
  matchedRules: MatchedGscRule[],
): string {
  const lines = [
    "GitSense rules matched this tool call. Apply these instructions, then retry.",
    "",
    `File: ${response.query?.normalized_file || file}`,
    `Action: ${action}`,
    "",
  ];

  for (const matchedRule of matchedRules) {
    const title = matchedRule.rule.summary || matchedRule.rule.id;
    lines.push(`${title}:`);

    const instructions = matchedRule.rule.instructions ?? [];
    if (instructions.length === 0) {
      lines.push("- No instructions were provided.");
    } else {
      for (const instruction of instructions) {
        lines.push(`- ${renderInstructionTemplate(instruction, file, action, response, matchedRule)}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function renderInstructionTemplate(
  instruction: string,
  file: string,
  action: RuleAction,
  response: GscRulesResponse,
  matchedRule: MatchedGscRule,
): string {
  const values = new Map<string, string>([
    ["file", file],
    ["normalized_file", response.query?.normalized_file || matchedRule.match?.file || ""],
    ["action", action],
    ["repo_root", response.git_root || ""],
    ["match_kind", matchedRule.match?.kind || ""],
    ["match_value", matchedRule.match?.value || ""],
    ["rule_id", matchedRule.rule.id],
  ]);

  return instruction.replace(/\{\{([a-z_]+)\}\}/g, (placeholder, name: string) => {
    const value = values.get(name);
    return value === undefined ? placeholder : value;
  });
}
