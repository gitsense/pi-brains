import type { AgentEndEvent, AgentStartEvent, BeforeAgentStartEvent, ContextEvent, ExtensionContext, InputEvent, SessionBeforeCompactEvent, SessionCompactEvent, ToolCallEvent, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import type { DebugLogger } from "../debug.ts";
import { getAgentStartRuleQueries, getBeforeAgentStartRuleQueries, getContextRuleQueries, getInputRuleQueries, getRuleQueries, getSessionBeforeCompactRuleQueries, getSessionCompactRuleQueries, getStopRuleQueries, getToolResultRuleQueries } from "./adapters.ts";
import { buildDeliveryKey, buildTriggerDeliveryKey, createRuleEvent, hashString, RuleDeliveryTracker } from "./delivery.ts";
import { GscRulesClient } from "./gsc-client.ts";
import { renderInstructionTemplate } from "./instructions.ts";
import type { BeforeAgentStartTriggerResult, ExecutionResult, GscRulesResponse, GscTriggerRunResult, LifecycleEvent, MatchedGscRule, PostToolUseTriggerResult, RuleAction, RuleEngineResult, RuleQuery, RulesJsonRule, RulesJsonResponse, TriggerDeliveryMode, V1ExecutionContext, V1TriggerContext } from "./types.ts";
import { DEFAULT_LIFECYCLE_EVENT } from "./types.ts";

interface MatchedRulePacket {
  rule: MatchedGscRule;
  type: "instruction" | "tool-trigger";
  triggerResult?: GscTriggerRunResult;
  triggerSkipped?: boolean;
  triggerError?: string;
}

interface TriggerEvaluationResult {
  result?: GscTriggerRunResult;
  skipped?: boolean;
  error?: string;
}

export class RuleEngine {
  private readonly client: GscRulesClient;
  private readonly delivery: RuleDeliveryTracker;
  private readonly getThinkingLevel: () => string;
  private readonly debug: DebugLogger;

  constructor(
    client: GscRulesClient,
    delivery: RuleDeliveryTracker,
    getThinkingLevel: () => string,
    debug: DebugLogger
  ) {
    this.client = client;
    this.delivery = delivery;
    this.getThinkingLevel = getThinkingLevel;
    this.debug = debug;
  }

  async evaluate(event: ToolCallEvent, ctx: ExtensionContext): Promise<RuleEngineResult | undefined> {
    const queries = getRuleQueries(event, ctx);
    return this.evaluateQueries(queries, event, ctx);
  }

  async evaluateInput(event: InputEvent, ctx: ExtensionContext): Promise<RuleEngineResult | undefined> {
    const queries = getInputRuleQueries(event, ctx);
    this.debug.log(`evaluateInput: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateQueries(queries, event, ctx);
  }

  async evaluateBeforeAgentStart(event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<BeforeAgentStartTriggerResult | undefined> {
    const queries = getBeforeAgentStartRuleQueries(event, ctx);
    this.debug.log(`evaluateBeforeAgentStart: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateBeforeAgentStartQueries(queries, event, ctx);
  }

  async evaluateToolResult(event: ToolResultEvent, ctx: ExtensionContext): Promise<PostToolUseTriggerResult | undefined> {
    const queries = getToolResultRuleQueries(event, ctx);
    this.debug.log(`evaluateToolResult: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateToolResultQueries(queries, event, ctx);
  }

  async evaluateStop(event: AgentEndEvent, ctx: ExtensionContext): Promise<PostToolUseTriggerResult | undefined> {
    const queries = getStopRuleQueries(event, ctx);
    this.debug.log(`evaluateStop: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateStopQueries(queries, event, ctx);
  }

  async evaluateAgentStart(event: AgentStartEvent, ctx: ExtensionContext): Promise<PostToolUseTriggerResult | undefined> {
    const queries = getAgentStartRuleQueries(event, ctx);
    this.debug.log(`evaluateAgentStart: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateStopQueries(queries, event as unknown as AgentEndEvent, ctx); // Reuse stop evaluation logic
  }

  async evaluateContext(event: ContextEvent, ctx: ExtensionContext): Promise<PostToolUseTriggerResult | undefined> {
    const queries = getContextRuleQueries(event, ctx);
    this.debug.log(`evaluateContext: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateStopQueries(queries, event as unknown as AgentEndEvent, ctx); // Reuse stop evaluation logic
  }

  async evaluateSessionBeforeCompact(event: SessionBeforeCompactEvent, ctx: ExtensionContext): Promise<PostToolUseTriggerResult | undefined> {
    const queries = getSessionBeforeCompactRuleQueries(event, ctx);
    this.debug.log(`evaluateSessionBeforeCompact: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateStopQueries(queries, event as unknown as AgentEndEvent, ctx); // Reuse stop evaluation logic
  }

  async evaluateSessionCompact(event: SessionCompactEvent, ctx: ExtensionContext): Promise<PostToolUseTriggerResult | undefined> {
    const queries = getSessionCompactRuleQueries(event, ctx);
    this.debug.log(`evaluateSessionCompact: ${queries.length} queries`);
    for (const q of queries) {
      this.debug.log(`query: action=${q.action}, toolName=${q.toolName}, event=${q.event}`);
    }
    return this.evaluateStopQueries(queries, event as unknown as AgentEndEvent, ctx); // Reuse stop evaluation logic
  }

  // New method: evaluate using gsc rules execute
  async evaluateWithExecute(
    event: ToolCallEvent | InputEvent | BeforeAgentStartEvent | ToolResultEvent | AgentEndEvent | AgentStartEvent | ContextEvent | SessionBeforeCompactEvent | SessionCompactEvent,
    ctx: ExtensionContext,
    debug: boolean = false
  ): Promise<ExecutionResult | undefined> {
    try {
      // 1. Build context
      const context = this.buildExecutionContext(event, ctx, debug);
      this.debug.log(`evaluateWithExecute: event=${context.event.name}`);

      // 2. Get matching rules
      const rules = await this.getRulesForEvent(event, ctx);
      if (!rules || rules.rules.length === 0) {
        this.debug.log(`no rules matched`);
        return undefined;
      }

      this.debug.log(`matched ${rules.rules.length} rules`);

      // 3. Filter out already-delivered rules (once-per-rule-hash)
      const action = context.payload?.toolCall?.action || "read";
      const undeliveredRules = rules.rules.filter(rule => {
        // Filter declarative rules
        if (rule.type === "declarative") {
          const deliveryKey = this.buildDeclarativeDeliveryKey(rules, rule, action as RuleAction);
          const alreadyDelivered = this.delivery.has(deliveryKey);
          if (alreadyDelivered) {
            this.debug.log(`skipping already-delivered declarative rule: ${rule.id}`);
          }
          return !alreadyDelivered;
        }
        
        // Filter executable triggers with explicit frequency (e.g., once-per-rule-hash)
        if (rule.type === "executable" && rule.frequency?.mode && rule.frequency.mode !== "always") {
          const deliveryKey = this.buildTriggerDeliveryKey(rule, action as RuleAction);
          const alreadyDelivered = this.delivery.has(deliveryKey);
          if (alreadyDelivered) {
            this.debug.log(`skipping already-delivered trigger (frequency: ${rule.frequency.mode}): ${rule.id}`);
          }
          return !alreadyDelivered;
        }
        
        // Allow all other executable triggers (no frequency or always)
        return true;
      });

      if (undeliveredRules.length === 0) {
        this.debug.log(`all declarative rules already delivered, skipping`);
        return undefined;
      }

      // 4. Create filtered rules response
      const filteredRules: RulesJsonResponse = {
        ...rules,
        rules: undeliveredRules,
        summary: {
          total: undeliveredRules.length,
          declarative: undeliveredRules.filter(r => r.type === "declarative").length,
          executable: undeliveredRules.filter(r => r.type === "executable").length,
        },
      };

      this.debug.log(`executing ${filteredRules.rules.length} rules (${filteredRules.summary.declarative} declarative, ${filteredRules.summary.executable} executable)`);

      // 5. Execute rules
      const result = await this.client.executeRules(context, filteredRules);
      this.debug.log(`execution result: block=${result.block}, notices=${result.notices?.length ?? 0}`);

      // 6. Mark rules as delivered after successful execution
      for (const rule of undeliveredRules) {
        if (rule.type === "declarative") {
          const deliveryKey = this.buildDeclarativeDeliveryKey(rules, rule, action as RuleAction);
          this.delivery.markDelivered(deliveryKey);
          this.delivery.record(createRuleEvent(
            "trigger_executed",
            action as RuleAction,
            rules.query?.file || "unknown",
            null,
            null,
            `declarative rule delivered via evaluateWithExecute`
          ));
        } else if (rule.type === "executable" && rule.frequency?.mode && rule.frequency.mode !== "always") {
          const deliveryKey = this.buildTriggerDeliveryKey(rule, action as RuleAction);
          this.delivery.markDelivered(deliveryKey);
          this.delivery.record(createRuleEvent(
            "trigger_executed",
            action as RuleAction,
            rules.query?.file || "unknown",
            null,
            null,
            `trigger delivered via evaluateWithExecute (frequency: ${rule.frequency.mode})`
          ));
        }
      }

      return result;
    } catch (error) {
      this.debug.log(`evaluateWithExecute failed: ${error}`);
      return undefined;
    }
  }

  private buildDeclarativeDeliveryKey(response: RulesJsonResponse, rule: RulesJsonRule, action: RuleAction): string {
    const repoHash = hashString(response.gitRoot || "unknown");
    const ruleId = rule.id;
    const ruleHash = rule.ruleHash || "missing-rule-hash";
    const matchKind = rule.match?.kind || "unknown";
    const matchValue = rule.match?.value || response.query?.file || "unknown";
    return ["static-rule", "once_per_rule_hash", repoHash, ruleId, ruleHash, action, matchKind, matchValue, "default"].join(":");
  }

  private buildTriggerDeliveryKey(rule: RulesJsonRule, action: RuleAction): string {
    const ruleId = rule.id;
    const ruleHash = rule.ruleHash || "missing-rule-hash";
    const triggerHash = rule.triggerHash || "missing-trigger-hash";
    const frequencyMode = rule.frequency?.mode || "always";
    return ["trigger", frequencyMode, ruleId, ruleHash, triggerHash, action].join(":");
  }

  private buildExecutionContext(
    event: ToolCallEvent | InputEvent | BeforeAgentStartEvent | ToolResultEvent | AgentEndEvent | AgentStartEvent | ContextEvent | SessionBeforeCompactEvent | SessionCompactEvent,
    ctx: ExtensionContext,
    debug: boolean
  ): V1ExecutionContext {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile() || "unknown";
    const branch = ctx.sessionManager.getBranch();
    const leafId = branch.length > 0 ? branch[branch.length - 1].id : "unknown";
    const messageIds = branch.map((entry) => entry.id);
    const model = ctx.model;
    const thinkingLevel = this.getThinkingLevel();

    // Determine lifecycle event and build payload
    // IMPORTANT: Check explicit event.type FIRST before structural checks
    // to avoid misidentifying context events as agent_end events
    let lifecycleEvent: LifecycleEvent = "pre_tool_use";
    let payload: V1ExecutionContext["payload"] = {};
    let repo: V1ExecutionContext["repo"];

    // First, check for explicit type on the event (most reliable)
    if ("type" in event) {
      const eventType = (event as { type: string }).type;
      if (eventType === "tool_call") {
        lifecycleEvent = "pre_tool_use";
      } else if (eventType === "before_agent_start") {
        lifecycleEvent = "before_agent_start";
      } else if (eventType === "agent_end") {
        lifecycleEvent = "agent_end";
      } else if (eventType === "agent_start") {
        lifecycleEvent = "agent_start";
      } else if (eventType === "context") {
        lifecycleEvent = "context";
      } else if (eventType === "session_before_compact") {
        lifecycleEvent = "session_before_compact";
      } else if (eventType === "session_compact") {
        lifecycleEvent = "session_compact";
      }
    }

    // If no explicit type matched, fall back to structural checks
    if (lifecycleEvent === "pre_tool_use") {
      if ("toolCallId" in event && "toolName" in event && !("content" in event)) {
        // Tool call event
        lifecycleEvent = "pre_tool_use";
      } else if ("text" in event && "source" in event) {
        // Input event
        lifecycleEvent = "user_prompt_submit";
      } else if ("content" in event && "isError" in event) {
        // Tool result event
        lifecycleEvent = "post_tool_use";
      } else if ("messages" in event) {
        // Agent end event (only if no explicit type)
        lifecycleEvent = "agent_end";
      } else if ("systemPromptOptions" in event) {
        // Before agent start event
        lifecycleEvent = "before_agent_start";
      }
    }

    // Now build payload based on lifecycleEvent
    if (lifecycleEvent === "pre_tool_use") {
      const toolCallEvent = event as ToolCallEvent;
      const queries = getRuleQueries(toolCallEvent, ctx);
      const query = queries[0];
      const isCommand = query?.action === "bash";
      const file = isCommand ? null : query?.file || null;
      const command = isCommand ? query?.command || null : null;

      payload = {
        toolCall: {
          id: toolCallEvent.toolCallId || "unknown",
          toolName: toolCallEvent.toolName,
          action: query?.action || "read",
          file,
          command,
          input: toolCallEvent.input as Record<string, unknown>,
        },
      };
    } else if (lifecycleEvent === "user_prompt_submit") {
      const inputEvent = event as InputEvent;
      payload = {
        prompt: {
          text: inputEvent.text,
          images: inputEvent.images,
          source: inputEvent.source,
          streamingBehavior: inputEvent.streamingBehavior,
        },
      };
    } else if (lifecycleEvent === "post_tool_use") {
      const toolResultEvent = event as ToolResultEvent;
      payload = {
        toolResult: {
          toolName: toolResultEvent.toolName,
          toolCallId: toolResultEvent.toolCallId,
          input: toolResultEvent.input as Record<string, unknown>,
          content: toolResultEvent.content as unknown[],
          isError: toolResultEvent.isError,
          details: "details" in toolResultEvent ? toolResultEvent.details : undefined,
        },
      };
    } else if (lifecycleEvent === "agent_end") {
      const agentEndEvent = event as AgentEndEvent;
      const messages = agentEndEvent.messages as Array<{ role: string }>;
      payload = {
        stop: {
          sessionPath: sessionFile,
          messageCount: messages.length,
          turnCount: messages.filter((m) => m.role === "assistant").length,
        },
      };
    } else if (lifecycleEvent === "before_agent_start") {
      const beforeAgentStartEvent = event as BeforeAgentStartEvent;
      const options = beforeAgentStartEvent.systemPromptOptions;
      payload = {
        beforeAgentStart: {
          prompt: {
            text: beforeAgentStartEvent.prompt,
            images: beforeAgentStartEvent.images,
          },
          context: {
            cwd: options.cwd || ctx.cwd,
            systemPrompt: beforeAgentStartEvent.systemPrompt,
            contextFiles: (options.contextFiles || []).map(f => ({
              path: f.path,
              content: f.content,
            })),
            skills: (options.skills || []).map(s => s.name),
            tools: options.selectedTools || [],
          },
        },
      };
    }

    return {
      version: "1",
      debug: debug,
      debugPath: debug ? ".gitsense/rules/triggers/debug/" : undefined,
      event: {
        name: lifecycleEvent,
        runtime: "pi",
        runtimeEvent: "tool_call",
      },
      capabilities: {
        canBlock: lifecycleEvent === "pre_tool_use" || lifecycleEvent === "user_prompt_submit",
        canAddContext: true,
        canModifyInput: lifecycleEvent === "user_prompt_submit",
        canModifyOutput: lifecycleEvent === "post_tool_use",
      },
      session: {
        id: sessionId,
        path: sessionFile,
        cwd: ctx.cwd,
      },
      conversation: {
        leafId,
        messageIds,
      },
      model: model ? {
        provider: model.provider || "unknown",
        id: model.id || "unknown",
        thinkingLevel,
      } : undefined,
      payload,
      repo,
    };
  }

  private async getRulesForEvent(
    event: ToolCallEvent | InputEvent | BeforeAgentStartEvent | ToolResultEvent | AgentEndEvent | AgentStartEvent | ContextEvent | SessionBeforeCompactEvent | SessionCompactEvent,
    ctx: ExtensionContext
  ): Promise<RulesJsonResponse | undefined> {
    // Get queries from adapters
    // IMPORTANT: Check explicit event.type FIRST before structural checks
    // to avoid misidentifying context events as agent_end events
    let queries: RuleQuery[] = [];

    // First, check for explicit type on the event (most reliable)
    if ("type" in event) {
      const eventType = (event as { type: string }).type;
      if (eventType === "tool_call") {
        queries = getRuleQueries(event as ToolCallEvent, ctx);
      } else if (eventType === "before_agent_start") {
        queries = getBeforeAgentStartRuleQueries(event as BeforeAgentStartEvent, ctx);
      } else if (eventType === "agent_end") {
        queries = getStopRuleQueries(event as AgentEndEvent, ctx);
      } else if (eventType === "agent_start") {
        queries = getAgentStartRuleQueries(event as unknown as AgentStartEvent, ctx);
      } else if (eventType === "context") {
        queries = getContextRuleQueries(event as unknown as ContextEvent, ctx);
      } else if (eventType === "session_before_compact") {
        queries = getSessionBeforeCompactRuleQueries(event as unknown as SessionBeforeCompactEvent, ctx);
      } else if (eventType === "session_compact") {
        queries = getSessionCompactRuleQueries(event as unknown as SessionCompactEvent, ctx);
      }
    }

    // If no explicit type matched, fall back to structural checks
    if (queries.length === 0) {
      if ("toolCallId" in event && "toolName" in event && !("content" in event)) {
        queries = getRuleQueries(event as ToolCallEvent, ctx);
      } else if ("text" in event && "source" in event) {
        queries = getInputRuleQueries(event as InputEvent, ctx);
      } else if ("content" in event && "isError" in event) {
        queries = getToolResultRuleQueries(event as ToolResultEvent, ctx);
      } else if ("messages" in event) {
        queries = getStopRuleQueries(event as AgentEndEvent, ctx);
      } else if ("systemPromptOptions" in event) {
        queries = getBeforeAgentStartRuleQueries(event as BeforeAgentStartEvent, ctx);
      }
    }

    if (queries.length === 0) return undefined;

    // Use the first query to get rules
    const query = queries[0];
    try {
      const rules = await this.client.getRulesJson(
        query.event || "pre_tool_use",
        query.action,
        query.file || undefined,
        query.command,
        undefined // prompt is not in RuleQuery
      );
      return rules;
    } catch (error) {
      this.debug.log(`getRulesForEvent failed: ${error}`);
      return undefined;
    }
  }

  private async evaluateQueries(
    queries: RuleQuery[],
    event: ToolCallEvent | InputEvent | BeforeAgentStartEvent,
    ctx: ExtensionContext
  ): Promise<RuleEngineResult | undefined> {
    if (queries.length === 0) return undefined;

    const allBlockReasons: string[] = [];
    const allNotices: string[] = [];

    for (const query of queries) {
      const result = await this.evaluateQuery(query, event, ctx);
      if (result?.block && result.reason) allBlockReasons.push(result.reason);
      if (result?.notices) allNotices.push(...result.notices);
    }

    if (allBlockReasons.length === 0) {
      if (allNotices.length > 0) {
        return { block: false, notices: allNotices };
      }
      return undefined;
    }

    return {
      block: true,
      reason: allBlockReasons.join("\n\n"),
      notices: allNotices,
    };
  }

  private async evaluateToolResultQueries(
    queries: RuleQuery[],
    event: ToolResultEvent,
    ctx: ExtensionContext
  ): Promise<PostToolUseTriggerResult | undefined> {
    if (queries.length === 0) return undefined;

    for (const query of queries) {
      const result = await this.evaluateToolResultQuery(query, event, ctx);
      if (result) return result;  // First non-null result wins
    }

    return undefined;
  }

  private async evaluateStopQueries(
    queries: RuleQuery[],
    event: AgentEndEvent,
    ctx: ExtensionContext
  ): Promise<PostToolUseTriggerResult | undefined> {
    if (queries.length === 0) return undefined;

    for (const query of queries) {
      const result = await this.evaluateStopQuery(query, event, ctx);
      if (result) return result;  // First non-null result wins
    }

    return undefined;
  }

  private async evaluateBeforeAgentStartQueries(
    queries: RuleQuery[],
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext
  ): Promise<BeforeAgentStartTriggerResult | undefined> {
    if (queries.length === 0) return undefined;

    for (const query of queries) {
      const result = await this.evaluateBeforeAgentStartQuery(query, event, ctx);
      if (result) return result;  // First non-null result wins
    }

    return undefined;
  }

  private async evaluateBeforeAgentStartQuery(
    query: RuleQuery,
    event: BeforeAgentStartEvent,
    ctx: ExtensionContext
  ): Promise<BeforeAgentStartTriggerResult | undefined> {
    this.debug.log(`evaluateBeforeAgentStartQuery: action=${query.action}, event=${query.event}`);

    let response: GscRulesResponse;
    try {
      response = await this.client.getRules(query.file || "", query.action, query.event, query.toolName, query.command);
      this.debug.log(`gsc rules get returned ${response.rules?.length ?? 0} rules`);
    } catch (error) {
      this.debug.log(`gsc rules get failed: ${error}`);
      this.delivery.record(
        createRuleEvent("error", query.action, query.file || "unknown", null, null, error instanceof Error ? error.message : "gsc rules get failed"),
      );
      return undefined;
    }

    const rules = response.rules ?? [];
    if (rules.length === 0) {
      this.debug.log(`no rules matched`);
      return undefined;
    }

    this.debug.log(`matched ${rules.length} rules:`);
    for (const rule of rules) {
      this.debug.log(`  - ${rule.rule.summary} (${rule.rule.type || "instruction"})`);
    }

    // For before_agent_start, only run executable triggers (skip instruction rules)
    const triggerRules: MatchedGscRule[] = [];
    const skippedInstructions: MatchedGscRule[] = [];

    for (const matchedRule of rules) {
      if (isTriggerRule(matchedRule)) {
        triggerRules.push(matchedRule);
      } else {
        skippedInstructions.push(matchedRule);
      }
    }

    if (skippedInstructions.length > 0) {
      this.debug.log(`skipping ${skippedInstructions.length} instruction rules for before_agent_start (only executable triggers allowed)`);
    }

    this.debug.log(`running ${triggerRules.length} executable triggers`);

    // Run triggers
    for (const matchedRule of triggerRules) {
      this.debug.log(`evaluating trigger: ${matchedRule.rule.summary}`);
      const evalResult = await this.evaluateTrigger(matchedRule, query, event, ctx, response);

      if (evalResult.result) {
        this.debug.log(`trigger result: matched=${evalResult.result.matched}, block=${evalResult.result.block}`);
        
        const triggerResult = evalResult.result;
        
        // For before_agent_start, support message, notice, and systemPrompt
        if (triggerResult.matched) {
          const result: BeforeAgentStartTriggerResult = {};
          
          // Check notice first (gsc may return instruction text as message)
          if (triggerResult.notice) {
            this.debug.log(`trigger returned notice: ${triggerResult.notice}`);
            result.notice = triggerResult.notice;
          }
          if (triggerResult.message) {
            this.debug.log(`trigger returned message: ${triggerResult.message}`);
            result.message = triggerResult.message;
          }
          // Check for systemPrompt in trigger result (dynamic field)
          if ("systemPrompt" in triggerResult && typeof triggerResult.systemPrompt === "string") {
            this.debug.log(`trigger returned systemPrompt modification`);
            result.systemPrompt = triggerResult.systemPrompt;
          }
          
          // Return result if any field is set
          if (result.message || result.notice || result.systemPrompt) {
            return result;
          }
          
          this.debug.log(`trigger matched but no message/notice/systemPrompt`);
          return {};
        }
      }
      if (evalResult.error) {
        this.debug.log(`trigger error: ${evalResult.error}`);
      }
      if (evalResult.skipped) {
        this.debug.log(`trigger skipped (already executed)`);
      }
    }

    return undefined;
  }

  private async evaluateToolResultQuery(
    query: RuleQuery,
    event: ToolResultEvent,
    ctx: ExtensionContext
  ): Promise<PostToolUseTriggerResult | undefined> {
    this.debug.log(`evaluateToolResultQuery: action=${query.action}, event=${query.event}, toolName=${query.toolName}`);

    let response: GscRulesResponse;
    try {
      response = await this.client.getRules(query.file || "", query.action, query.event, query.toolName, query.command);
      this.debug.log(`gsc rules get returned ${response.rules?.length ?? 0} rules`);
    } catch (error) {
      this.debug.log(`gsc rules get failed: ${error}`);
      this.delivery.record(
        createRuleEvent("error", query.action, query.file || "unknown", null, null, error instanceof Error ? error.message : "gsc rules get failed"),
      );
      return undefined;
    }

    const rules = response.rules ?? [];
    if (rules.length === 0) {
      this.debug.log(`no rules matched`);
      return undefined;
    }

    this.debug.log(`matched ${rules.length} rules:`);
    for (const rule of rules) {
      this.debug.log(`  - ${rule.rule.summary} (${rule.rule.type || "instruction"})`);
    }

    // Partition rules
    const instructionRules: MatchedGscRule[] = [];
    const triggerRules: MatchedGscRule[] = [];

    for (const matchedRule of rules) {
      if (isTriggerRule(matchedRule)) {
        triggerRules.push(matchedRule);
      } else {
        instructionRules.push(matchedRule);
      }
    }

    this.debug.log(`partitioned: ${instructionRules.length} instructions, ${triggerRules.length} triggers`);

    // Run triggers
    for (const matchedRule of triggerRules) {
      this.debug.log(`evaluating trigger: ${matchedRule.rule.summary}`);
      const evalResult = await this.evaluateTrigger(matchedRule, query, event, ctx, response);

      if (evalResult.result) {
        this.debug.log(`trigger result: matched=${evalResult.result.matched}, block=${evalResult.result.block}`);
        
        // For post_tool_use, we need to parse the result as PostToolUseTriggerResult
        // The trigger returns GscTriggerRunResult but we interpret it differently
        const triggerResult = evalResult.result;
        
        // Check if trigger matched and has a message or notice
        if (triggerResult.matched) {
          // Parse deliveryMode from trigger result (default: steer)
          const deliveryMode = "deliveryMode" in triggerResult 
            ? (triggerResult as Record<string, unknown>).deliveryMode as TriggerDeliveryMode | undefined
            : undefined;
          
          // Check notice first (gsc may return instruction text as message)
          if (triggerResult.notice) {
            this.debug.log(`trigger returned notice: ${triggerResult.notice}`);
            return { action: "notice", content: triggerResult.notice, level: triggerResult.level };
          }
          if (triggerResult.message) {
            this.debug.log(`trigger returned message: ${triggerResult.message}`);
            return { action: "message", content: triggerResult.message, deliveryMode };
          }
          // Trigger matched but no message/notice - do nothing
          this.debug.log(`trigger matched but no message/notice`);
          return { action: null };
        }
      }
      if (evalResult.error) {
        this.debug.log(`trigger error: ${evalResult.error}`);
      }
      if (evalResult.skipped) {
        this.debug.log(`trigger skipped (already executed)`);
      }
    }

    // Handle instruction rules - deliver as notices
    for (const matchedRule of instructionRules) {
      const deliveryKey = buildDeliveryKey(response, matchedRule, query.action);
      if (!this.delivery.has(deliveryKey)) {
        this.debug.log(`delivering instruction: ${matchedRule.rule.summary}`);
        this.delivery.markDelivered(deliveryKey);
        this.delivery.record(createRuleEvent(
          "trigger_executed",
          query.action,
          query.file || "unknown",
          response,
          matchedRule,
          "instruction delivered"
        ));
        
        // Return first undelivered instruction as notice
        const instructions = matchedRule.rule.instructions ?? [];
        if (instructions.length > 0) {
          return { action: "notice", content: instructions.join("\n") };
        }
      }
    }

    return undefined;
  }

  private async evaluateStopQuery(
    query: RuleQuery,
    event: AgentEndEvent,
    ctx: ExtensionContext
  ): Promise<PostToolUseTriggerResult | undefined> {
    this.debug.log(`evaluateStopQuery: action=${query.action}, event=${query.event}`);

    let response: GscRulesResponse;
    try {
      response = await this.client.getRules(query.file || "", query.action, query.event, query.toolName, query.command);
      this.debug.log(`gsc rules get returned ${response.rules?.length ?? 0} rules`);
    } catch (error) {
      this.debug.log(`gsc rules get failed: ${error}`);
      this.delivery.record(
        createRuleEvent("error", query.action, query.file || "unknown", null, null, error instanceof Error ? error.message : "gsc rules get failed"),
      );
      return undefined;
    }

    const rules = response.rules ?? [];
    if (rules.length === 0) {
      this.debug.log(`no rules matched`);
      return undefined;
    }

    this.debug.log(`matched ${rules.length} rules:`);
    for (const rule of rules) {
      this.debug.log(`  - ${rule.rule.summary} (${rule.rule.type || "instruction"})`);
    }

    // For agent_end, only run executable triggers (skip instruction rules)
    const triggerRules: MatchedGscRule[] = [];
    const skippedInstructions: MatchedGscRule[] = [];

    for (const matchedRule of rules) {
      if (isTriggerRule(matchedRule)) {
        triggerRules.push(matchedRule);
      } else {
        skippedInstructions.push(matchedRule);
      }
    }

    if (skippedInstructions.length > 0) {
      this.debug.log(`skipping ${skippedInstructions.length} instruction rules for agent_end (only executable triggers allowed)`);
    }

    this.debug.log(`running ${triggerRules.length} executable triggers`);

    // Run triggers
    for (const matchedRule of triggerRules) {
      this.debug.log(`evaluating trigger: ${matchedRule.rule.summary}`);
      const evalResult = await this.evaluateTrigger(matchedRule, query, event, ctx, response);

      if (evalResult.result) {
        this.debug.log(`trigger result: matched=${evalResult.result.matched}, block=${evalResult.result.block}`);
        
        const triggerResult = evalResult.result;
        
        // For agent_end, allow messages and notices
        if (triggerResult.matched) {
          // Parse deliveryMode from trigger result
          const deliveryMode = "deliveryMode" in triggerResult 
            ? (triggerResult as Record<string, unknown>).deliveryMode as TriggerDeliveryMode | undefined
            : undefined;
          
          // Check notice first (gsc may return instruction text as message)
          if (triggerResult.notice) {
            this.debug.log(`trigger returned notice: ${triggerResult.notice}`);
            return { action: "notice", content: triggerResult.notice, level: triggerResult.level };
          }
          if (triggerResult.message) {
            this.debug.log(`trigger returned message: ${triggerResult.message}`);
            return { action: "message", content: triggerResult.message, deliveryMode };
          }
          this.debug.log(`trigger matched but no message/notice`);
          return { action: null };
        }
      }
      if (evalResult.error) {
        this.debug.log(`trigger error: ${evalResult.error}`);
      }
      if (evalResult.skipped) {
        this.debug.log(`trigger skipped (already executed)`);
      }
    }

    return undefined;
  }

  private async evaluateQuery(
    query: RuleQuery,
    event: ToolCallEvent | InputEvent | BeforeAgentStartEvent,
    ctx: ExtensionContext
  ): Promise<RuleEngineResult | undefined> {
    this.debug.log(`evaluateQuery: action=${query.action}, event=${query.event}, file=${query.file}`);

    let response: GscRulesResponse;
    try {
      response = await this.client.getRules(query.file || "", query.action, query.event, query.toolName, query.command);
      this.debug.log(`gsc rules get returned ${response.rules?.length ?? 0} rules`);
    } catch (error) {
      this.debug.log(`gsc rules get failed: ${error}`);
      this.delivery.record(
        createRuleEvent("error", query.action, query.file || "unknown", null, null, error instanceof Error ? error.message : "gsc rules get failed"),
      );
      return undefined;
    }

    const rules = response.rules ?? [];
    if (rules.length === 0) {
      this.debug.log(`no rules matched`);
      return undefined;
    }

    this.debug.log(`matched ${rules.length} rules:`);
    for (const rule of rules) {
      this.debug.log(`  - ${rule.rule.summary} (${rule.rule.type || "instruction"})`);
    }

    // Collect all matched rules
    const matchedPackets: MatchedRulePacket[] = [];
    const triggerResults: Map<string, GscTriggerRunResult> = new Map();
    const notices: string[] = [];

    // 1. Partition rules into instructions and triggers
    const instructionRules: MatchedGscRule[] = [];
    const triggerRules: MatchedGscRule[] = [];

    for (const matchedRule of rules) {
      if (isTriggerRule(matchedRule)) {
        triggerRules.push(matchedRule);
      } else {
        instructionRules.push(matchedRule);
      }
    }

    this.debug.log(`partitioned: ${instructionRules.length} instructions, ${triggerRules.length} triggers`);

    // 2. Run all matched executable triggers
    let anyTriggerBlocks = false;
    for (const matchedRule of triggerRules) {
      this.debug.log(`evaluating trigger: ${matchedRule.rule.summary}`);
      const evalResult = await this.evaluateTrigger(matchedRule, query, event, ctx, response);

      if (evalResult.result) {
        triggerResults.set(matchedRule.rule.id, evalResult.result);
        this.debug.log(`trigger result: matched=${evalResult.result.matched}, block=${evalResult.result.block}`);

        if (evalResult.result.block) {
          anyTriggerBlocks = true;
        }

        if (evalResult.result.notice) {
          notices.push(evalResult.result.notice);
        }
      }
      if (evalResult.error) {
        this.debug.log(`trigger error: ${evalResult.error}`);
        notices.push(`Trigger ${matchedRule.rule.id} failed: ${evalResult.error}`);
      }
      if (evalResult.skipped) {
        this.debug.log(`trigger skipped (already executed)`);
      }

      matchedPackets.push({
        rule: matchedRule,
        type: "tool-trigger",
        triggerResult: evalResult.result || undefined,
        triggerSkipped: evalResult.skipped,
        triggerError: evalResult.error,
      });
    }

    // 3. Add instruction rules to packet
    for (const matchedRule of instructionRules) {
      matchedPackets.push({
        rule: matchedRule,
        type: "instruction",
      });
    }

    // 4. Check if we need to deliver instructions
    const undeliveredInstructions = instructionRules.filter(rule => {
      const deliveryKey = buildDeliveryKey(response, rule, query.action);
      return !this.delivery.has(deliveryKey);
    });

    // 5. Determine if we should block
    const shouldBlock = anyTriggerBlocks || undeliveredInstructions.length > 0;
    this.debug.log(`decision: anyTriggerBlocks=${anyTriggerBlocks}, undeliveredInstructions=${undeliveredInstructions.length}, shouldBlock=${shouldBlock}`);

    if (!shouldBlock) {
      // No block needed, return notices only
      this.debug.log(`allowing (no block needed)`);
      return notices.length > 0 ? { block: false, notices } : undefined;
    }

    // 6. Build the complete matched-rule packet message
    const blockMessage = this.buildMatchedRulePacket(
      query,
      matchedPackets,
      triggerResults,
      undeliveredInstructions,
      response
    );

    // 7. Mark instructions as delivered
    for (const matchedRule of undeliveredInstructions) {
      const deliveryKey = buildDeliveryKey(response, matchedRule, query.action);
      this.delivery.markDelivered(deliveryKey);
      this.delivery.record(createRuleEvent(
        "blocked",
        query.action,
        query.file || "unknown",
        response,
        matchedRule,
        "instructions delivered as part of matched-rule packet"
      ));
    }

    // 8. Record trigger events
    for (const [ruleId, result] of triggerResults) {
      const matchedRule = triggerRules.find(r => r.rule.id === ruleId);
      if (matchedRule) {
        const frequencyMode = matchedRule.rule.frequency?.mode;
        const deliveryKey = buildTriggerDeliveryKey(matchedRule, query.action, frequencyMode);

        if (deliveryKey) {
          this.delivery.markDelivered(deliveryKey);
        }

        this.delivery.record(createRuleEvent(
          result.block ? "blocked" : "trigger_executed",
          query.action,
          query.file || "unknown",
          response,
          matchedRule,
          result.block ? "trigger blocked" : "trigger allowed",
          result.notice
        ));
      }
    }

    return {
      block: true,
      reason: blockMessage,
      notices,
    };
  }

  private buildMatchedRulePacket(
    query: RuleQuery,
    matchedPackets: MatchedRulePacket[],
    triggerResults: Map<string, GscTriggerRunResult>,
    undeliveredInstructions: MatchedGscRule[],
    response: GscRulesResponse
  ): string {
    const lines: string[] = [];

    // Determine lifecycle event
    const lifecycleEvent = query.event || DEFAULT_LIFECYCLE_EVENT;

    lines.push("GitSense matched repository rules before this lifecycle event.");
    lines.push("");
    lines.push(`Event: ${lifecycleEvent}`);
    lines.push("Runtime: pi");
    lines.push(`Runtime event: ${query.toolName}`);
    lines.push("Decision: blocked");
    lines.push("");

    // Original event info
    lines.push("Original event:");
    lines.push(`- Tool: ${query.toolName}`);
    lines.push(`- Action: ${query.action}`);
    if (query.file) {
      lines.push(`- File: ${query.file}`);
    }
    if (query.command) {
      lines.push(`- Command: ${query.command}`);
    }
    lines.push("");

    // Matched rules section
    lines.push("Matched rules:");
    lines.push("");

    let ruleIndex = 1;

    // First: deterministic instruction rules
    for (const packet of matchedPackets) {
      if (packet.type !== "instruction") continue;

      const rule = packet.rule;
      const title = rule.rule.summary || rule.rule.id;
      const matchKind = rule.match?.kind || "unknown";
      const matchValue = rule.match?.value || "unknown";

      lines.push(`${ruleIndex}. ${title} [instruction]`);
      lines.push(`   Rule: ${rule.rule.id}`);
      lines.push(`   Match: ${matchKind}: ${matchValue}`);

      const instructions = rule.rule.instructions ?? [];
      if (instructions.length > 0) {
        lines.push("   Instructions:");
        for (const instruction of instructions) {
          // Render instruction template with variables
          const rendered = renderInstructionTemplate(
            instruction,
            query.file || "unknown",
            query.action,
            response,
            rule
          );
          lines.push(`   - ${rendered}`);
        }
      } else {
        lines.push("   Instructions: (none)");
      }

      lines.push("");
      ruleIndex++;
    }

    // Second: executable trigger rules
    for (const packet of matchedPackets) {
      if (packet.type !== "tool-trigger") continue;

      const rule = packet.rule;
      const title = rule.rule.summary || rule.rule.id;
      const matchKind = rule.match?.kind || "unknown";
      const matchValue = rule.match?.value || "unknown";
      const triggerResult = packet.triggerResult;

      lines.push(`${ruleIndex}. ${title} [tool-trigger]`);
      lines.push(`   Rule: ${rule.rule.id}`);
      lines.push(`   Match: ${matchKind}: ${matchValue}`);

      if (packet.triggerSkipped) {
        lines.push("   Trigger result: (skipped - already executed)");
      } else if (packet.triggerError) {
        lines.push(`   Trigger result: (error: ${packet.triggerError})`);
      } else if (triggerResult) {
        lines.push("   Trigger result:");
        if (triggerResult.block) {
          lines.push(`   - BLOCKED: ${triggerResult.message || "No message provided"}`);
        } else {
          lines.push(`   - Allowed`);
        }
      } else {
        lines.push("   Trigger result: (not run)");
      }

      lines.push("");
      ruleIndex++;
    }

    // Required next steps
    lines.push("Required next steps:");

    if (undeliveredInstructions.length > 0) {
      lines.push("- Apply all deterministic instructions above.");
    }

    const blockingTriggers = matchedPackets.filter(
      p => p.type === "tool-trigger" && p.triggerResult?.block
    );
    if (blockingTriggers.length > 0) {
      lines.push("- Address all blocking trigger results above.");
    }

    lines.push("- Run any requested `gsc` commands, loading the required `gsc experts guide ...` first.");
    lines.push("- Retry the original tool call only after satisfying the rule packet.");

    return lines.join("\n");
  }

  private async evaluateTrigger(
    matchedRule: MatchedGscRule,
    query: RuleQuery,
    event: ToolCallEvent | InputEvent | BeforeAgentStartEvent | ToolResultEvent | AgentEndEvent,
    ctx: ExtensionContext,
    response: GscRulesResponse
  ): Promise<TriggerEvaluationResult> {
    const frequencyMode = matchedRule.rule.frequency?.mode;
    const deliveryKey = buildTriggerDeliveryKey(matchedRule, query.action, frequencyMode);

    // Check if already delivered (only if explicit frequency)
    if (deliveryKey && this.delivery.has(deliveryKey)) {
      this.delivery.record(createRuleEvent("skipped", query.action, query.file || "unknown", response, matchedRule, "trigger already executed"));
      return { skipped: true };
    }

    // Build V1 context
    const triggerContext = this.buildTriggerContext(matchedRule, query, event, ctx, response);

    // Get timeout from trigger config
    const timeoutMs = matchedRule.rule.trigger?.timeoutMs;

    try {
      // Execute trigger
      const result = await this.client.runTrigger(matchedRule.rule.id, triggerContext, timeoutMs);
      return { result };
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes("timed out");

      // Mark as delivered for persistent errors (not timeout)
      if (!isTimeout && deliveryKey) {
        this.delivery.markDelivered(deliveryKey);
      }

      // Record error
      this.delivery.record(createRuleEvent(
        "error",
        query.action,
        query.file || "unknown",
        response,
        matchedRule,
        error instanceof Error ? error.message : "trigger execution failed"
      ));

      const errorMessage = error instanceof Error ? error.message : "unknown error";

      // Fail open - return error
      return { error: errorMessage };
    }
  }

  private buildTriggerContext(
    matchedRule: MatchedGscRule,
    query: RuleQuery,
    event: ToolCallEvent | InputEvent | BeforeAgentStartEvent | ToolResultEvent | AgentEndEvent,
    ctx: ExtensionContext,
    response: GscRulesResponse
  ): V1TriggerContext {
    // Get session info from sessionManager (using available APIs)
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile() || "unknown";
    const branch = ctx.sessionManager.getBranch();
    const leafId = branch.length > 0 ? branch[branch.length - 1].id : "unknown";
    const messageIds = branch.map((entry) => entry.id);

    // Get model info
    const model = ctx.model;
    const thinkingLevel = this.getThinkingLevel();

    // Determine lifecycle event
    const lifecycleEvent: LifecycleEvent = query.event || DEFAULT_LIFECYCLE_EVENT;

    // Get rule event (from rule or response query or default)
    const ruleEvent: LifecycleEvent = matchedRule.rule.event || response.query?.event || DEFAULT_LIFECYCLE_EVENT;

    // Generate debug path if debug is enabled
    const isDebug = this.debug.isEnabled();
    let debugPath: string | undefined;
    if (isDebug) {
      const triggerEntry = matchedRule.rule.trigger?.entry || "unknown";
      const triggerSlug = triggerEntry.replace(/\.mjs$|\.js$|\.py$|\.sh$/, "");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      debugPath = `.gitsense/rules/triggers/debug/${triggerSlug}-${timestamp}.txt`;
    }

    // Build base context
    const baseContext: V1TriggerContext = {
      version: "1",
      debug: isDebug,
      debugPath,
      event: {
        name: lifecycleEvent,
        runtime: "pi",
        runtimeEvent: query.toolName,
      },
      capabilities: {
        canBlock: lifecycleEvent === "user_prompt_submit" || lifecycleEvent === "pre_tool_use",
        canAddContext: true,
        canModifyInput: lifecycleEvent === "user_prompt_submit",
        canModifyOutput: lifecycleEvent === "post_tool_use",
      },
      session: {
        id: sessionId,
        path: sessionFile,
        cwd: ctx.cwd,
      },
      conversation: {
        leafId,
        messageIds,
      },
      model: model ? {
        provider: model.provider || "unknown",
        id: model.id || "unknown",
        thinkingLevel,
      } : undefined,
      payload: {},
      repo: undefined,
      rule: {
        id: matchedRule.rule.id,
        summary: matchedRule.rule.summary || "",
        type: isTriggerRule(matchedRule) ? "tool-trigger" : "instruction",
        ruleHash: matchedRule.ruleHash || "",
        triggerHash: matchedRule.triggerHash || "",
        event: ruleEvent,
      },
    };

    // Add event-specific payload
    if (lifecycleEvent === "pre_tool_use" && "toolCallId" in event && !("content" in event)) {
      // Tool call event (not tool result)
      const isCommand = query.action === "bash";
      const file = isCommand ? null : query.file;
      const command = isCommand ? query.command || null : null;
      const repoRoot = response.git_root || null;
      const normalizedFile = file && repoRoot ? file.replace(repoRoot + "/", "") : null;

      // toolCall goes at top level (gsc transforms payload.toolCall to top level)
      baseContext.toolCall = {
        id: event.toolCallId || "unknown",
        toolName: event.toolName,
        action: query.action,
        file,
        command,
        input: event.input as Record<string, unknown>,
      };
      baseContext.repo = repoRoot ? { root: repoRoot, normalizedFile } : undefined;
    } else if (lifecycleEvent === "user_prompt_submit" && "text" in event) {
      // Input event
      baseContext.payload = {
        prompt: {
          text: event.text,
          images: event.images,
          source: event.source,
          streamingBehavior: event.streamingBehavior,
        },
      };
    } else if (lifecycleEvent === "post_tool_use" && "content" in event) {
      // Tool result event
      // toolResult goes at top level (gsc transforms payload.toolResult to top level)
      baseContext.toolResult = {
        toolName: event.toolName,
        toolCallId: event.toolCallId,
        input: event.input as Record<string, unknown>,
        content: event.content as unknown[],
        isError: event.isError,
        details: "details" in event ? event.details : undefined,
      };
    } else if (lifecycleEvent === "agent_end" && "messages" in event) {
      // Agent end event
      const messages = event.messages as Array<{ role: string }>;
      baseContext.payload = {
        stop: {
          sessionPath: ctx.sessionManager.getSessionFile() || "unknown",
          messageCount: messages.length,
          turnCount: messages.filter((m) => m.role === "assistant").length,
        },
      };
    } else if (lifecycleEvent === "before_agent_start" && "systemPromptOptions" in event) {
      // Before agent start event
      const beforeAgentStartEvent = event as BeforeAgentStartEvent;
      const options = beforeAgentStartEvent.systemPromptOptions;
      baseContext.payload = {
        beforeAgentStart: {
          prompt: {
            text: beforeAgentStartEvent.prompt,
            images: beforeAgentStartEvent.images,
          },
          context: {
            cwd: options.cwd || ctx.cwd,
            systemPrompt: beforeAgentStartEvent.systemPrompt,
            contextFiles: (options.contextFiles || []).map(f => ({
              path: f.path,
              content: f.content,
            })),
            skills: (options.skills || []).map(s => s.name),
            tools: options.selectedTools || [],
          },
        },
      };
    }

    return baseContext;
  }
}

function isTriggerRule(matchedRule: MatchedGscRule): boolean {
  return matchedRule.rule.type === "tool-trigger" && !!matchedRule.rule.trigger;
}

// Type guard for PostToolUseTriggerResult
function isPostToolUseTriggerResult(value: unknown): value is PostToolUseTriggerResult {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.action !== "message" && obj.action !== "notice" && obj.action !== null) return false;
  if ("content" in obj && typeof obj.content !== "string") return false;
  return true;
}
