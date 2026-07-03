import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextState, ModelState } from "./types.ts";

export function readContextState(ctx: ExtensionContext): ContextState | null {
  const usage = ctx.getContextUsage();
  if (!usage) return null;
  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
  };
}

export function readModelState(pi: ExtensionAPI, ctx: ExtensionContext): ModelState | null {
  if (!ctx.model) return null;
  return {
    id: ctx.model.id,
    provider: ctx.model.provider,
    thinkingLevel: pi.getThinkingLevel(),
  };
}
