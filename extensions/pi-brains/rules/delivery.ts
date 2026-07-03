import { createHash } from "node:crypto";
import type { GscRulesResponse, MatchedGscRule, RuleAction, RuleDecisionEvent } from "./types.ts";

const MAX_EVENTS = 100;

export class RuleDeliveryTracker {
  private readonly deliveredKeys = new Set<string>();
  private readonly events: RuleDecisionEvent[] = [];

  has(deliveryKey: string): boolean {
    return this.deliveredKeys.has(deliveryKey);
  }

  markDelivered(deliveryKey: string): void {
    this.deliveredKeys.add(deliveryKey);
  }

  record(event: RuleDecisionEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  getEvents(): RuleDecisionEvent[] {
    return [...this.events];
  }

  formatStatus(): string {
    if (this.events.length === 0) return "No rule decisions recorded yet.";

    const lines = ["Recent rule decisions:", ""];
    for (const event of this.events.slice(-20).reverse()) {
      const summary = event.ruleSummary ? ` - ${event.ruleSummary}` : "";
      const match = event.matchKind && event.matchValue ? ` (${event.matchKind}: ${event.matchValue})` : "";
      const notice = event.notice ? ` [notice: ${event.notice}]` : "";
      lines.push(`${event.outcome.padEnd(7)} ${event.action.padEnd(5)} ${event.normalizedFile || event.file}${match}${summary}${notice}`);
      lines.push(`        ${event.reason}`);
    }
    return lines.join("\n");
  }
}

// Delivery key for static instruction rules (once-per-rule-hash)
export function buildDeliveryKey(response: GscRulesResponse, matchedRule: MatchedGscRule, action: RuleAction): string {
  const repoHash = hashString(response.git_root || "unknown");
  const ruleId = matchedRule.rule.id;
  const ruleHash = matchedRule.ruleHash || "missing-rule-hash";
  const matchKind = matchedRule.match?.kind || "unknown";
  const matchValue = matchedRule.match?.value || response.query?.normalized_file || response.query?.file || "unknown";
  return ["static-rule", "once_per_rule_hash", repoHash, ruleId, ruleHash, action, matchKind, matchValue, "default"].join(":");
}

// Delivery key for executable triggers (runs every time by default)
// Only use delivery tracking if explicit frequency is set
export function buildTriggerDeliveryKey(
  matchedRule: MatchedGscRule,
  action: RuleAction,
  frequencyMode?: string
): string | null {
  // If no explicit frequency, don't track delivery (run every time)
  if (!frequencyMode || frequencyMode === "always") {
    return null;
  }

  const ruleId = matchedRule.rule.id;
  const ruleHash = matchedRule.ruleHash || "missing-rule-hash";
  const triggerHash = matchedRule.triggerHash || "missing-trigger-hash";
  return ["trigger", frequencyMode, ruleId, ruleHash, triggerHash, action].join(":");
}

export function createRuleEvent(
  outcome: RuleDecisionEvent["outcome"],
  action: RuleAction,
  file: string,
  response: GscRulesResponse | null,
  matchedRule: MatchedGscRule | null,
  reason: string,
  notice?: string,
): RuleDecisionEvent {
  return {
    timestamp: new Date().toISOString(),
    outcome,
    action,
    file,
    normalizedFile: response?.query?.normalized_file || matchedRule?.match?.file || file,
    ruleId: matchedRule?.rule.id,
    ruleHash: matchedRule?.ruleHash,
    triggerHash: matchedRule?.triggerHash,
    ruleSummary: matchedRule?.rule.summary,
    matchKind: matchedRule?.match?.kind,
    matchValue: matchedRule?.match?.value,
    reason,
    notice,
  };
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
