import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SnapshotInsightFacts } from "./snapshot-insights.ts";
import { showOutputPanel } from "./output-panel.ts";

interface SnapshotSummary {
  snapshot_id: string;
  sequence: number;
  created_at: string;
  leaf_id: string;
  snapshot_path?: string;
  manifest_path?: string;
  object_database?: string;
  git_commit?: string;
  file_count: number;
  bytes_captured: number;
  incomplete: boolean;
}

interface SnapshotCreateResult extends SnapshotSummary {
  status: "created" | "unchanged";
  unchanged?: boolean;
  files?: Array<{ original_path?: string; error?: string }>;
}

interface SnapshotClearResult {
  status: "archived" | "empty";
  session_id: string;
  snapshot_count: number;
  bytes_archived: number;
  archive_path?: string;
}

export interface SnapshotCommandController {
  getSessionId(): string | null;
  runGscCommand(...args: string[]): Promise<{ code: number; stdout: string; stderr: string } | null>;
  isSnapshotInsightsEnabled(): boolean;
  setSnapshotInsightsEnabled(enabled: boolean): boolean;
  resetSnapshotInsightBoundary(leafId: string | null, snapshotId: string | null): void;
  getSnapshotInsightFacts(ctx: ExtensionCommandContext): Promise<SnapshotInsightFacts>;
}

export async function handleSnapshotsCommand(
  value: string | undefined,
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const args = (value ?? "").trim().split(/\s+/).filter(Boolean);
  const command = args[0] ?? "status";
  const sessionId = controller.getSessionId();
  if (!sessionId) {
    ctx.ui.notify("No active session. Start a conversation first.", "error");
    return;
  }

  if (command === "insights") {
    await handleInsights(args[1] ?? "status", controller, ctx);
    return;
  }
  if (command === "review" && args.length === 1) {
    await showSnapshotReview(controller, ctx);
    return;
  }
  if (command === "create") {
    await createSnapshot(sessionId, controller, ctx);
    return;
  }
  if (command === "clear") {
    await clearSnapshots(sessionId, controller, ctx);
    return;
  }
  if (command === "list" && args.length === 1) {
    await showSnapshotList(sessionId, controller, ctx);
    return;
  }
  if (command === "status" && args.length === 1) {
    await showSnapshotStatus(sessionId, controller, ctx);
    return;
  }

  ctx.ui.notify("Unknown snapshots command. Use /brains snapshots, insights on|off|status, review, list, create, or clear.", "warning");
}

async function handleInsights(
  mode: string,
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (mode === "on") {
    controller.setSnapshotInsightsEnabled(true);
    const facts = await controller.getSnapshotInsightFacts(ctx);
    ctx.ui.notify("Snapshot insights enabled for this session.", "info");
    if (facts.directMutationFiles.length > 0) {
      ctx.ui.notify(
        "Mutations have already occurred, so a true pre-change baseline may no longer be available.",
        "warning",
      );
    }
    await showSnapshotReview(controller, ctx, facts);
    return;
  }
  if (mode === "off") {
    controller.setSnapshotInsightsEnabled(false);
    ctx.ui.notify("Snapshot insights disabled for this session.", "info");
    return;
  }
  if (mode === "status") {
    ctx.ui.notify(
      `Snapshot insights: ${controller.isSnapshotInsightsEnabled() ? "ON" : "OFF"} for this session.`,
      "info",
    );
    return;
  }
  ctx.ui.notify("Usage: /brains snapshots insights on|off|status", "warning");
}

async function createSnapshot(
  sessionId: string,
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const leafId = ctx.sessionManager.getLeafId?.() ?? null;
  if (!leafId) {
    ctx.ui.notify("No current session leaf is available for the snapshot.", "error");
    return;
  }
  const result = await controller.runGscCommand(
    "pi", "sessions", "snapshots", "create",
    "--session", sessionId,
    "--leaf", leafId,
    "--format", "json",
  );
  if (!result || result.code !== 0) {
    ctx.ui.notify(`Snapshot failed: ${commandError(result)}`, "error");
    return;
  }
  const snapshot = parseJSON<SnapshotCreateResult>(result.stdout);
  if (!snapshot) {
    ctx.ui.notify("Snapshot failed: gsc returned invalid JSON.", "error");
    return;
  }
  controller.resetSnapshotInsightBoundary(leafId, snapshot.snapshot_id);
  if (snapshot.unchanged || snapshot.status === "unchanged") {
    ctx.ui.notify(`No new snapshot: the file tree matches stage #${snapshot.sequence}.`, "info");
    return;
  }
  const commit = snapshot.git_commit ? ` · Git ${snapshot.git_commit.slice(0, 12)}` : "";
  const excluded = snapshot.files?.filter(file => file.error).length ?? 0;
  const suffix = excluded > 0 ? ` · ${excluded} excluded or unreadable` : "";
  ctx.ui.notify(
    `Snapshot #${snapshot.sequence} created: ${snapshot.file_count} ${plural(snapshot.file_count, "file")} · ${formatBytes(snapshot.bytes_captured)}${commit}${suffix}`,
    snapshot.incomplete ? "warning" : "info",
  );
}

async function clearSnapshots(
  sessionId: string,
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const snapshots = await listSnapshots(sessionId, controller, ctx);
  if (!snapshots) return;
  if (snapshots.length === 0) {
    ctx.ui.notify("No snapshots found for this session.", "info");
    return;
  }
  const totalBytes = snapshots.reduce((sum, snapshot) => sum + (snapshot.bytes_captured || 0), 0);
  const confirmed = await ctx.ui.confirm(
    "Clear session snapshots",
    `Archive ${snapshots.length} ${plural(snapshots.length, "snapshot")} (${formatBytes(totalBytes)}) for session ${sessionId}?\n\nThe archive is recoverable and will be retained under GSC_HOME/data/pi/snapshot-trash.`,
  );
  if (!confirmed) {
    ctx.ui.notify("Snapshot clear cancelled.", "info");
    return;
  }
  const result = await controller.runGscCommand(
    "pi", "sessions", "snapshots", "clear",
    "--session", sessionId,
    "--format", "json",
    "--force",
  );
  if (!result || result.code !== 0) {
    ctx.ui.notify(`Snapshot clear failed: ${commandError(result)}`, "error");
    return;
  }
  const cleared = parseJSON<SnapshotClearResult>(result.stdout);
  if (!cleared) {
    ctx.ui.notify("Snapshot clear failed: gsc returned invalid JSON.", "error");
    return;
  }
  if (cleared.status === "empty") {
    ctx.ui.notify("No snapshots found for this session.", "info");
    return;
  }
  controller.resetSnapshotInsightBoundary(null, null);
  ctx.ui.notify(`Archived ${cleared.snapshot_count} ${plural(cleared.snapshot_count, "snapshot")}. Recoverable at ${cleared.archive_path}.`, "info");
}

async function showSnapshotStatus(
  sessionId: string,
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const snapshots = await listSnapshots(sessionId, controller, ctx);
  if (!snapshots) return;
  const latest = snapshots.at(-1);
  const latestLines = latest
    ? [
        `Latest stage: #${latest.sequence} (${latest.snapshot_id})`,
        `Files: ${latest.file_count} · ${formatBytes(latest.bytes_captured)} · ${latest.incomplete ? "incomplete" : "complete"}`,
        `Leaf: ${latest.leaf_id}`,
        ...(latest.git_commit ? [`Git commit: ${latest.git_commit}`] : []),
      ]
    : ["Latest stage: none"];
  const markdown = [
    `Session: ${sessionId}`,
    `Snapshot insights: ${controller.isSnapshotInsightsEnabled() ? "ON" : "OFF"}`,
    `Snapshots: ${snapshots.length}`,
    "",
    ...latestLines,
    "",
    "Snapshots may include recognized files outside the session repository. Common credential paths are excluded; the default limits are 64 MiB per file and 256 MiB per stage.",
    "",
    "Commands:",
    "- `/brains snapshots insights on|off|status`",
    "- `/brains snapshots review`",
    "- `/brains snapshots list`",
    "- `/brains snapshots create`",
    "- `/brains snapshots clear`",
  ].join("\n");
  await showOutputPanel(ctx, "Session Snapshots", markdown);
}

async function showSnapshotReview(
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
  existingFacts?: SnapshotInsightFacts,
): Promise<void> {
  const facts = existingFacts ?? await controller.getSnapshotInsightFacts(ctx);
  const latest = facts.latestSnapshot;
  const snapshotCount = facts.snapshotCount === null ? "unknown" : String(facts.snapshotCount);
  const lines = [
    `Snapshot insights: ${facts.enabled ? "ON" : "OFF"}`,
    `Snapshots: ${snapshotCount}`,
    `Latest baseline: ${facts.snapshotLoadError ? "unknown (snapshot metadata unavailable)" : latest ? `stage #${latest.sequence} (${latest.created_at})` : "none"}`,
    `Recognized direct-tool files: ${facts.recognizedFiles.length}`,
    `Direct mutation files since baseline: ${facts.directMutationFiles.length}`,
    `Shell coverage uncertainty: ${facts.shellActivity ? "yes" : "no"}`,
  ];
  if (facts.snapshotLoadError) {
    lines.push("Snapshot metadata could not be loaded.");
  }
  if (latest && !facts.boundaryOnActiveBranch) {
    lines.push("Latest snapshot is not on the active branch; comparison coverage is uncertain.");
  }
  if (facts.directMutationFiles.length > 0) {
    lines.push("", "**Direct mutation files**", "", ...facts.directMutationFiles.map(path => `- \`${path}\``));
  }
  lines.push(
    "",
    "No snapshot is created automatically. Run `/brains snapshots create` only when you want to preserve the current recognized file state.",
  );
  await showOutputPanel(ctx, "Snapshot Review", lines.join("\n"));
}

async function showSnapshotList(
  sessionId: string,
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const snapshots = await listSnapshots(sessionId, controller, ctx);
  if (!snapshots) return;
  if (snapshots.length === 0) {
    await showOutputPanel(ctx, "Snapshot Locations", `Session: ${sessionId}\n\nNo snapshots found.`);
    return;
  }

  const lines = [
    `Session: ${sessionId}`,
    `Stages: ${snapshots.length}`,
  ];
  const objectDatabases = [...new Set(snapshots.map(snapshot => snapshot.object_database).filter(Boolean))];
  if (objectDatabases.length > 0) {
    lines.push("", "**Git object databases**", "", ...objectDatabases.map(path => `- \`${path}\``));
  }
  lines.push("", "**Snapshot locations**");
  for (const snapshot of [...snapshots].reverse()) {
    lines.push(
      "",
      `### Stage #${snapshot.sequence}`,
      "",
      `- Snapshot: \`${snapshot.snapshot_id}\``,
      `- Created: ${snapshot.created_at}`,
      `- Leaf: \`${snapshot.leaf_id || "unknown"}\``,
      `- Status: ${snapshot.incomplete ? "incomplete" : "complete"}`,
    );
    if (snapshot.snapshot_path) lines.push(`- Directory: \`${snapshot.snapshot_path}\``);
    if (snapshot.manifest_path) lines.push(`- Manifest: \`${snapshot.manifest_path}\``);
    if (snapshot.git_commit) lines.push(`- Git commit: \`${snapshot.git_commit}\``);
  }
  await showOutputPanel(ctx, "Snapshot Locations", lines.join("\n"));
}

async function listSnapshots(
  sessionId: string,
  controller: SnapshotCommandController,
  ctx: ExtensionCommandContext,
): Promise<SnapshotSummary[] | null> {
  const result = await controller.runGscCommand(
    "pi", "sessions", "snapshots", "list",
    "--session", sessionId,
    "--format", "json",
  );
  if (!result || result.code !== 0) {
    ctx.ui.notify(`Could not list snapshots: ${commandError(result)}`, "error");
    return null;
  }
  const snapshots = parseJSON<SnapshotSummary[]>(result.stdout);
  if (!Array.isArray(snapshots)) {
    ctx.ui.notify("Could not list snapshots: gsc returned invalid JSON.", "error");
    return null;
  }
  return snapshots;
}

function parseJSON<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function commandError(result: { stderr: string; stdout: string } | null): string {
  return result?.stderr.trim() || result?.stdout.trim() || "gsc command failed";
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
