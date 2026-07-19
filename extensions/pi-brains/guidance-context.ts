const EXPERTS_INIT_COMMAND = /(?:^|[;&|]\s*)gsc\s+experts\s+init(?:\s|$)/;
const COMPLETION_LANGUAGE = /\b(?:ran|executed|loaded|initialized|initialised|completed|succeeded|successful)\b/i;

export function isExpertsInitCommand(command: string): boolean {
  return EXPERTS_INIT_COMMAND.test(command.trim());
}

export function getActiveContextItems(sessionManager: {
  getBranch(): readonly unknown[];
}): readonly unknown[] {
  const manager = sessionManager as unknown as {
    getBranch(): readonly unknown[];
    buildContextEntries?: () => readonly unknown[];
  };
  if (typeof manager.buildContextEntries === "function") {
    return manager.buildContextEntries();
  }

  const branch = manager.getBranch();
  let compactionIndex = -1;
  for (let i = 0; i < branch.length; i++) {
    const entry = branch[i];
    if (isRecord(entry) && entry.type === "compaction") compactionIndex = i;
  }
  if (compactionIndex < 0) return branch;

  const compaction = branch[compactionIndex];
  if (!isRecord(compaction) || typeof compaction.firstKeptEntryId !== "string") {
    return branch.slice(compactionIndex);
  }
  const keptIndex = branch.findIndex((entry) => isRecord(entry) && entry.id === compaction.firstKeptEntryId);
  const kept = keptIndex >= 0 && keptIndex < compactionIndex
    ? branch.slice(keptIndex, compactionIndex)
    : [];
  return [compaction, ...kept, ...branch.slice(compactionIndex + 1)];
}

export function hasGitSenseGuidance(items: readonly unknown[]): boolean {
  const initCalls = new Set<string>();
  const successfulResults = new Set<string>();

  for (const item of items) {
    if (!isRecord(item)) continue;

    if ((item.type === "compaction" || item.type === "branch_summary") && summaryRecordsGuidance(item.summary)) {
      return true;
    }
    if ((item.role === "compactionSummary" || item.role === "branchSummary") && summaryRecordsGuidance(item.summary)) {
      return true;
    }

    const message = item.type === "message" && isRecord(item.message) ? item.message : item;
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isRecord(block) || block.type !== "toolCall" || block.name !== "bash") continue;
        if (typeof block.id !== "string" || !isRecord(block.arguments)) continue;
        const command = block.arguments.command;
        if (typeof command === "string" && isExpertsInitCommand(command)) initCalls.add(block.id);
      }
    }
    if (
      message.role === "toolResult" &&
      message.isError !== true &&
      typeof message.toolCallId === "string"
    ) {
      successfulResults.add(message.toolCallId);
    }
  }

  for (const id of initCalls) {
    if (successfulResults.has(id)) return true;
  }
  return false;
}

function summaryRecordsGuidance(value: unknown): boolean {
  return typeof value === "string" &&
    /gsc\s+experts\s+init/i.test(value) &&
    COMPLETION_LANGUAGE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
