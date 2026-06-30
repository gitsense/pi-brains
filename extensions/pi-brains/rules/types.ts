export type RuleAction = "read" | "edit" | "write" | "bash" | "tool" | "mcp_tool" | "prompt" | "agent_end";

export type RuleType = "instruction" | "tool-trigger";

export type TriggerDeliveryMode = "steer" | "followUp" | "passiveSteer";

export type LifecycleEvent =
  | "session_start"
  | "user_prompt_submit"
  | "before_agent_start"
  | "agent_start"
  | "pre_tool_use"
  | "post_tool_use"
  | "post_tool_batch"
  | "context"
  | "session_before_compact"
  | "session_compact"
  | "agent_end"
  | "session_end";

export const DEFAULT_LIFECYCLE_EVENT: LifecycleEvent = "pre_tool_use";

export interface RuleQuery {
  action: RuleAction;
  file: string | null;
  toolName: string;
  command?: string;
  event?: LifecycleEvent;
  toolFilter?: string;    // glob pattern for tool name matching
  commandFilter?: string; // regex pattern for bash command matching
}

export interface RuleMatch {
  kind: string;
  value: string;
  file?: string;
  action?: string;
}

export interface TriggerConfig {
  runtime: string;
  entry: string;
  timeoutMs?: number;
}

export interface FrequencyConfig {
  mode: string;
  key?: string;
}

export interface GscRule {
  id: string;
  type?: RuleType;
  event?: LifecycleEvent;
  summary?: string;
  instructions?: string[];
  trigger?: TriggerConfig;
  frequency?: FrequencyConfig;
}

export interface MatchedGscRule {
  rule: GscRule;
  match?: RuleMatch;
  match_reason?: string;
  ruleHash?: string;
  triggerHash?: string;
}

export interface GscRulesResponse {
  query?: {
    file?: string;
    normalized_file?: string;
    action?: string;
    event?: LifecycleEvent;
  };
  git_root?: string;
  rules: MatchedGscRule[];
}

// V1 Trigger Context (sent to trigger stdin)
// Note: gsc rules execute transforms the context before passing to triggers.
// toolCall and toolResult are at the TOP LEVEL, not inside payload.
export interface V1TriggerContext {
  version: "1";
  debug: boolean;
  debugPath?: string;  // suggested debug file location
  event: {
    name: LifecycleEvent;
    runtime: "pi" | "claude";
    runtimeEvent: string;
  };
  capabilities: {
    canBlock: boolean;
    canAddContext: boolean;
    canModifyInput: boolean;
    canModifyOutput: boolean;
  };
  session: {
    id: string;
    path: string;
    cwd: string;
  };
  conversation: {
    leafId: string;
    messageIds: string[];
  };
  model?: {
    provider: string;
    id: string;
    thinkingLevel: string;
  };
  // toolCall is at top level (transformed by gsc from payload.toolCall)
  toolCall?: {
    id: string;
    toolName: string;
    action: string;
    file: string | null;
    command: string | null;
    input: Record<string, unknown>;
  };
  // toolResult is at top level (transformed by gsc from payload.toolResult)
  toolResult?: {
    toolName: string;
    toolCallId: string;
    input: Record<string, unknown>;
    content: unknown[];
    isError: boolean;
    details?: unknown;
  };
  payload: {
    prompt?: {
      text: string;
      images?: unknown[];
      source: string;
      streamingBehavior?: string;
    };
    stop?: {
      sessionPath: string;
      messageCount: number;
      turnCount: number;
    };
    beforeAgentStart?: {
      prompt: {
        text: string;
        images?: unknown[];
      };
      context: {
        cwd: string;
        systemPrompt: string;
        contextFiles: Array<{ path: string; content?: string }>;
        skills: string[];
        tools: string[];
      };
    };
  };
  repo?: {
    root: string;
    normalizedFile: string | null;
  };
  rule: {
    id: string;
    summary: string;
    type: RuleType;
    ruleHash: string;
    triggerHash: string;
    event: LifecycleEvent;
  };
}

// V1 Trigger Result (received from trigger stdout)
export interface V1TriggerResult {
  matched: boolean;
  block: boolean;
  message?: string;
  notice?: string;
  level?: string;
}

// Trigger execution result from gsc
export interface GscTriggerRunResult {
  ruleId: string;
  matched: boolean;
  block: boolean;
  message?: string;
  notice?: string;
  level?: string;
  frequency?: {
    mode: string;
    key?: string;
  };
  priority?: number;
  ruleHash?: string;
}

// Post-tool-use trigger result (different semantics - no blocking)
export interface PostToolUseTriggerResult {
  action: "message" | "notice" | null;
  content?: string;
  deliveryMode?: TriggerDeliveryMode;
  level?: string;
}

// Before-agent-start trigger result (supports message injection and system prompt modification)
export interface BeforeAgentStartTriggerResult {
  message?: string;         // inject persistent message into conversation
  notice?: string;          // show to user only (not sent to LLM)
  systemPrompt?: string;    // modify system prompt for this turn only
}

export type RuleDecisionOutcome = "blocked" | "skipped" | "error" | "trigger_executed";

export interface RuleDecisionEvent {
  timestamp: string;
  outcome: RuleDecisionOutcome;
  action: RuleAction;
  file: string;
  normalizedFile: string;
  ruleId?: string;
  ruleHash?: string;
  triggerHash?: string;
  ruleSummary?: string;
  matchKind?: string;
  matchValue?: string;
  reason: string;
  notice?: string;
}

export interface RuleEngineResult {
  block: boolean;
  reason?: string;
  notices?: string[];
}

// Rules JSON response from gsc rules get --format rules-json
export interface RulesJsonResponse {
  schemaVersion: number;
  query: {
    event?: string;
    action?: string;
    file?: string;
    command?: string;
    prompt?: string;
  };
  gitRoot: string;
  rules: RulesJsonRule[];
  summary: {
    total: number;
    declarative: number;
    executable: number;
  };
}

export interface RulesJsonRule {
  id: string;
  type: "declarative" | "executable";
  event: string;
  summary: string;
  instructions?: string[];
  trigger?: {
    runtime: string;
    entry: string;
    timeoutMs?: number;
  };
  frequency?: {
    mode: string;
    key?: string;
  };
  match: {
    kind: string;
    value: string;
    file?: string;
    action?: string;
  };
  ruleHash: string;
  triggerHash?: string;
  priority: number;
  importance: string;
}

// Execution result from gsc rules execute
export interface ExecutionResult {
  schemaVersion: number;
  block: boolean;
  reason?: string;
  notices?: string[];
  matchedRules: ExecutionMatchedRule[];
  triggerResults: ExecutionTriggerResult[];
  errors?: ExecutionError[];
  subagentTasks?: ExecutionSubagentTask[];
}

export interface ExecutionMatchedRule {
  ruleId: string;
  ruleHash: string;
  triggerHash?: string;
  type: "declarative" | "executable";
  summary: string;
  instructions?: string[];
  priority: number;
  match: {
    kind: string;
    value: string;
    file?: string;
    action?: string;
  };
}

export interface ExecutionTriggerResult {
  ruleId: string;
  matched: boolean;
  block: boolean;
  message?: string;
  notice?: string;
  level?: string;
  deliveryMode?: TriggerDeliveryMode;
}

export interface ExecutionError {
  ruleId: string;
  error: string;
}

export interface ExecutionSubagentTask {
  agent: string;
  task: string;
  status: "spawned" | "completed" | "failed";
}

// V1ExecutionContext (input for gsc rules execute)
export interface V1ExecutionContext {
  version: "1";
  debug?: boolean;
  debugPath?: string;
  event: {
    name: LifecycleEvent;
    runtime: "pi" | "claude";
    runtimeEvent: string;
  };
  capabilities: {
    canBlock: boolean;
    canAddContext: boolean;
    canModifyInput: boolean;
    canModifyOutput: boolean;
  };
  session: {
    id: string;
    path: string;
    cwd: string;
  };
  conversation: {
    leafId: string;
    messageIds: string[];
  };
  model?: {
    provider: string;
    id: string;
    thinkingLevel: string;
  };
  payload: {
    toolCall?: {
      id: string;
      toolName: string;
      action: string;
      file: string | null;
      command: string | null;
      input: Record<string, unknown>;
    };
    prompt?: {
      text: string;
      images?: unknown[];
      source: string;
      streamingBehavior?: string;
    };
    toolResult?: {
      toolName: string;
      toolCallId: string;
      input: Record<string, unknown>;
      content: unknown[];
      isError: boolean;
      details?: unknown;
    };
    stop?: {
      sessionPath: string;
      messageCount: number;
      turnCount: number;
    };
    beforeAgentStart?: {
      prompt: {
        text: string;
        images?: unknown[];
      };
      context: {
        cwd: string;
        systemPrompt: string;
        contextFiles: Array<{ path: string; content?: string }>;
        skills: string[];
        tools: string[];
      };
    };
    session?: {
      reason?: string;
      branchEntries?: unknown[];
      fromExtension?: boolean;
    };
  };
  repo?: {
    root: string;
    normalizedFile: string | null;
  };
}
