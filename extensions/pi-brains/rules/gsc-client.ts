import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DebugLogger } from "../debug.ts";
import type { ExecutionResult, GscRulesResponse, GscTriggerRunResult, LifecycleEvent, MatchedGscRule, RuleAction, RulesJsonResponse, V1ExecutionContext, V1TriggerContext } from "./types.ts";
import { DEFAULT_LIFECYCLE_EVENT } from "./types.ts";

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class GscRulesClient {
  private readonly pi: ExtensionAPI;
  private readonly signal: AbortSignal;
  private readonly debug: DebugLogger;

  constructor(pi: ExtensionAPI, signal: AbortSignal, debug: DebugLogger) {
    this.pi = pi;
    this.signal = signal;
    this.debug = debug;
  }

  async getRules(file: string, action: RuleAction, event?: LifecycleEvent, toolName?: string, command?: string): Promise<GscRulesResponse> {
    const lifecycleEvent = event || DEFAULT_LIFECYCLE_EVENT;
    const args = ["rules", "get", "--event", lifecycleEvent, "--action", action, "--format", "json"];

    // File is optional for command triggers
    if (file) {
      args.splice(4, 0, "--file", file);
    }

    // Add tool name for tool filtering (only for MCP tools)
    if (toolName && action === "mcp_tool") {
      args.push("--tool", toolName);
    }

    // Add command for bash command filtering
    if (command && action === "bash") {
      args.push("--command", command);
    }

    this.debug.log(`gsc rules get: ${args.join(" ")}`);

    const result = await this.pi.exec("gsc", args, {
      signal: this.signal,
      timeout: 3_000,
    });

    if (result.code !== 0 || !result.stdout) {
      throw new Error(result.stderr || `gsc rules get failed with exit code ${result.code}`);
    }

    const parsed = JSON.parse(result.stdout) as unknown;
    const validation = validateGscRulesResponse(parsed);
    if (!validation.valid) {
      this.debug.log(`gsc rules get validation failed: ${validation.reason}`);
      this.debug.log(`gsc response:`, JSON.stringify(parsed, null, 2));
      throw new Error(`gsc rules get validation failed: ${validation.reason}`);
    }

    return parsed as GscRulesResponse;
  }

  async runTrigger(ruleId: string, context: V1TriggerContext, timeoutMs?: number): Promise<GscTriggerRunResult> {
    // Create debug directory if debug is enabled
    if (context.debug && context.debugPath) {
      const debugDir = dirname(context.debugPath);
      await mkdir(debugDir, { recursive: true }).catch(() => {});
    }

    // Create temp directory and file for context
    const tempDir = await mkdtemp(join(tmpdir(), "gsc-trigger-"));
    const contextFile = join(tempDir, "context.json");

    try {
      await writeFile(contextFile, JSON.stringify(context, null, 2));

      this.debug.log(`gsc rules trigger run: ruleId=${ruleId}`);
      this.debug.log(`trigger context:`, JSON.stringify(context, null, 2));

      const result = await this.pi.exec("gsc", [
        "rules", "trigger", "run", ruleId,
        "--context", contextFile,
      ], {
        signal: this.signal,
        timeout: timeoutMs || 10_000,
      });

      if (result.code !== 0 || !result.stdout) {
        throw new Error(result.stderr || `gsc rules trigger run failed with exit code ${result.code}`);
      }

      const parsed = JSON.parse(result.stdout) as unknown;
      const validation = validateGscTriggerRunResult(parsed);
      if (!validation.valid) {
        this.debug.log(`gsc rules trigger run validation failed: ${validation.reason}`);
        this.debug.log(`trigger response:`, JSON.stringify(parsed, null, 2));
        throw new Error(`gsc rules trigger run validation failed: ${validation.reason}`);
      }

      return parsed as GscTriggerRunResult;
    } finally {
      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async getRulesJson(event: LifecycleEvent, action?: RuleAction, file?: string, command?: string, prompt?: string): Promise<RulesJsonResponse> {
    const args = ["rules", "get", "--event", event, "--format", "rules-json"];

    if (action) args.push("--action", action);
    if (file) args.push("--file", file);
    if (command) args.push("--command", command);
    if (prompt) args.push("--prompt", prompt);

    this.debug.log(`gsc rules get --format rules-json: ${args.join(" ")}`);

    const result = await this.pi.exec("gsc", args, {
      signal: this.signal,
      timeout: 3_000,
    });

    if (result.code !== 0 || !result.stdout) {
      throw new Error(result.stderr || `gsc rules get failed with exit code ${result.code}`);
    }

    const parsed = JSON.parse(result.stdout) as unknown;
    if (!isRecord(parsed) || !Array.isArray((parsed as Record<string, unknown>).rules)) {
      throw new Error(`gsc rules get returned invalid rules-json format`);
    }

    return parsed as unknown as RulesJsonResponse;
  }

  async executeRules(context: V1ExecutionContext, rules: RulesJsonResponse): Promise<ExecutionResult> {
    // Create debug directory if debug is enabled
    if (context.debug && context.debugPath) {
      const debugDir = dirname(context.debugPath);
      await mkdir(debugDir, { recursive: true }).catch(() => {});
    }

    // Create temp directory and files
    const tempDir = await mkdtemp(join(tmpdir(), "gsc-execute-"));
    const contextFile = join(tempDir, "context.json");
    const rulesFile = join(tempDir, "rules.json");

    try {
      await writeFile(contextFile, JSON.stringify(context, null, 2));
      await writeFile(rulesFile, JSON.stringify(rules, null, 2));

      this.debug.log(`gsc rules execute`);
      this.debug.log(`context:`, JSON.stringify(context, null, 2));
      this.debug.log(`rules:`, JSON.stringify(rules, null, 2));

      const result = await this.pi.exec("gsc", [
        "rules", "execute",
        "--context", contextFile,
        "--rules", rulesFile,
      ], {
        signal: this.signal,
        timeout: 30_000, // 30 second timeout for execution
      });

      if (result.code !== 0 || !result.stdout) {
        throw new Error(result.stderr || `gsc rules execute failed with exit code ${result.code}`);
      }

      const parsed = JSON.parse(result.stdout) as unknown;
      if (!isRecord(parsed) || typeof (parsed as Record<string, unknown>).block !== "boolean") {
        throw new Error(`gsc rules execute returned invalid format`);
      }

      return parsed as unknown as ExecutionResult;
    } finally {
      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function validateGscRulesResponse(value: unknown): ValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "response is not a record" };
  // gsc returns rules: null when no rules match
  if (value.rules !== null && !Array.isArray(value.rules)) return { valid: false, reason: "rules is not an array or null" };

  if (Array.isArray(value.rules)) {
    for (let i = 0; i < value.rules.length; i++) {
      const ruleValidation = validateMatchedGscRule(value.rules[i]);
      if (!ruleValidation.valid) {
        return { valid: false, reason: `rule[${i}]: ${ruleValidation.reason}` };
      }
    }
  }

  return { valid: true };
}

function validateMatchedGscRule(value: unknown): ValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "not a record" };
  if (!isRecord(value.rule)) return { valid: false, reason: "rule is not a record" };
  if (typeof value.rule.id !== "string" || value.rule.id.length === 0) return { valid: false, reason: `rule.id is ${typeof value.rule.id} (expected non-empty string)` };
  if ("ruleHash" in value && typeof value.ruleHash !== "string") return { valid: false, reason: `ruleHash is ${typeof value.ruleHash} (expected string)` };
  if ("instructions" in value.rule && value.rule.instructions !== null && !isStringArray(value.rule.instructions)) return { valid: false, reason: `instructions is ${typeof value.rule.instructions} (expected string[] or null)` };
  return { valid: true };
}

function validateGscTriggerRunResult(value: unknown): ValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "response is not a record" };
  if (typeof value.ruleId !== "string") return { valid: false, reason: `ruleId is ${typeof value.ruleId} (expected string)` };
  if (typeof value.matched !== "boolean") return { valid: false, reason: `matched is ${typeof value.matched} (expected boolean)` };
  if (typeof value.block !== "boolean") return { valid: false, reason: `block is ${typeof value.block} (expected boolean)` };
  return { valid: true };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
