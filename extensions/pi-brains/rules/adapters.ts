import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import type { AgentEndEvent, AgentStartEvent, BeforeAgentStartEvent, ContextEvent, ExtensionContext, InputEvent, SessionBeforeCompactEvent, SessionCompactEvent, ToolCallEvent, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import type { RuleAction, RuleQuery } from "./types.ts";

interface ToolAdapter {
  toolName: string;
  action: RuleAction;
  pathField: string;
}

const BUILTIN_TOOL_ADAPTERS: ToolAdapter[] = [
  { toolName: "read", action: "read", pathField: "path" },
  { toolName: "edit", action: "edit", pathField: "path" },
  { toolName: "write", action: "write", pathField: "path" },
];

export function getRuleQueries(event: ToolCallEvent, ctx: ExtensionContext): RuleQuery[] {
  // Handle bash commands specially
  if (event.toolName === "bash") {
    const command = readStringField(event.input, "command");
    if (!command) return [];

    return [{
      action: "bash",
      file: null,
      toolName: "bash",
      command,
    }];
  }

  // Handle file-based tools
  const adapter = BUILTIN_TOOL_ADAPTERS.find((item) => item.toolName === event.toolName);
  if (!adapter) return [];

  const file = readStringField(event.input, adapter.pathField);
  if (!file) return [];

  return [
    {
      action: adapter.action,
      file: normalizeToolPath(file, ctx.cwd),
      toolName: event.toolName,
    },
  ];
}

export function getInputRuleQueries(event: InputEvent, ctx: ExtensionContext): RuleQuery[] {
  return [{
    action: "prompt",
    file: null,
    toolName: "input",
    event: "user_prompt_submit",
  }];
}

export function getBeforeAgentStartRuleQueries(event: BeforeAgentStartEvent, ctx: ExtensionContext): RuleQuery[] {
  return [{
    action: "prompt",
    file: null,
    toolName: "before_agent_start",
    event: "before_agent_start",
  }];
}

export function getToolResultRuleQueries(event: ToolResultEvent, ctx: ExtensionContext): RuleQuery[] {
  // Map tool name to appropriate action
  let action: RuleAction = "tool";
  if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
    action = event.toolName;
  } else if (event.toolName === "bash") {
    action = "bash";
  } else if (event.toolName.startsWith("mcp_")) {
    action = "mcp_tool";
  }

  return [{
    action,
    file: null,
    toolName: event.toolName,
    event: "post_tool_use",
  }];
}

export function getStopRuleQueries(event: AgentEndEvent, ctx: ExtensionContext): RuleQuery[] {
  return [{
    action: "agent_end",
    file: null,
    toolName: "agent_end",
    event: "agent_end",
  }];
}

export function getAgentStartRuleQueries(event: AgentStartEvent, ctx: ExtensionContext): RuleQuery[] {
  return [{
    action: "agent_end" as RuleAction, // agent_start has no action, reuse agent_end for query
    file: null,
    toolName: "agent_start",
    event: "agent_start",
  }];
}

export function getContextRuleQueries(event: ContextEvent, ctx: ExtensionContext): RuleQuery[] {
  return [{
    action: "agent_end" as RuleAction, // context has no action, reuse agent_end for query
    file: null,
    toolName: "context",
    event: "context",
  }];
}

export function getSessionBeforeCompactRuleQueries(event: SessionBeforeCompactEvent, ctx: ExtensionContext): RuleQuery[] {
  return [{
    action: "agent_end" as RuleAction, // session_before_compact has no action, reuse agent_end for query
    file: null,
    toolName: "session_before_compact",
    event: "session_before_compact",
  }];
}

export function getSessionCompactRuleQueries(event: SessionCompactEvent, ctx: ExtensionContext): RuleQuery[] {
  return [{
    action: "agent_end" as RuleAction, // session_compact has no action, reuse agent_end for query
    file: null,
    toolName: "session_compact",
    event: "session_compact",
  }];
}

export function normalizeToolPath(file: string, cwd: string): string {
  const expanded = file === "~" ? homedir() : file.startsWith("~/") ? resolve(homedir(), file.slice(2)) : file;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function readStringField(input: unknown, field: string): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}
