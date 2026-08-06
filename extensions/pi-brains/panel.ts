import { homedir } from "node:os";
import { basename } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { GSC_MISSING_NOTICE_ID } from "./config.ts";
import { buildFileTree, renderTree } from "./file-tree.ts";
import { formatCompactTokens, renderTokenGlyphs } from "./glyphs.ts";
import type { PanelState, PiBrainsConfig } from "./types.ts";

function displayPath(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

export class BrainsPanel implements Component {
  private readonly getState: () => PanelState;
  private readonly getConfig: () => PiBrainsConfig;
  private readonly theme: Theme;

  constructor(getState: () => PanelState, getConfig: () => PiBrainsConfig, theme: Theme) {
    this.getState = getState;
    this.getConfig = getConfig;
    this.theme = theme;
  }

  render(width: number): string[] {
    const state = this.getState();
    const config = this.getConfig();
    if (!config.visible) return [];

    const lines: string[] = [];
    const contentWidth = Math.max(1, width - 1);

    lines.push(this.heading("CONTEXT"), "");
    if (state.context === null || state.context.tokens === null) {
      lines.push(this.theme.fg("dim", "computing"));
    } else {
      const glyphColor = config.brightness === "dim" ? "dim" : "text";
      for (const line of renderTokenGlyphs(state.context.tokens, config.font, config.glyph)) {
        lines.push(this.theme.fg(glyphColor, line));
      }
      lines.push(
        "",
        `${formatCompactTokens(state.context.tokens)} / ${formatCompactTokens(state.context.contextWindow)} · ${Math.round(state.context.percent ?? 0)}%`,
      );
    }

    if (config.showModel && state.model) {
      lines.push("", this.heading("MODEL"), state.model.id, this.theme.fg("muted", `${state.model.provider} · thinking: ${state.model.thinkingLevel}`));
    }

    if (config.showRepositories) {
      lines.push("", this.heading("FILES TRACKED"), "");
      if (state.trackedFileCount === 0) {
        lines.push(this.theme.fg("muted", "No structured file activity yet"));
      } else {
        for (const repository of state.repositories) {
          lines.push(this.theme.fg("accent", `${basename(repository.root)} · ${repository.fileCount}`));

          if (repository.files.length > 0) {
            const tree = buildFileTree(repository.files, repository.root);
            for (const treeLine of renderTree(tree, contentWidth - 2)) {
              lines.push(` ${treeLine}`);
            }
          }
          lines.push("");
        }
        if (state.outsideRepositoryCount > 0) {
          lines.push(
            this.theme.fg("accent", `outside · ${state.outsideRepositoryCount}`),
            this.theme.fg("muted", "files outside tracked repositories"),
            "",
          );
        }
        const unresolved =
          state.trackedFileCount - state.repositories.reduce((sum, repository) => sum + repository.fileCount, 0) - state.outsideRepositoryCount;
        if (unresolved > 0) lines.push(this.theme.fg("dim", `${unresolved} files resolving`), "");
      }
    }

    // Agent messaging overlay (§8.2): unread count, awaiting-outbound count,
    // and wait-group progress — visible to the human without touching agent
    // context. Rendered from the cached mailbox summary, never from a scan.
    if (state.mailbox) {
      const inbound = state.mailbox.mailbox.inbound;
      const outbound = state.mailbox.mailbox.outbound;
      const hasMail =
        inbound.pending > 0 || inbound.delivering > 0 || outbound.awaiting > 0 || state.mailbox.wait_groups.length > 0;
      if (hasMail) {
        lines.push("", this.heading("MAIL"));
        if (inbound.pending > 0) {
          lines.push(this.theme.fg("accent", `${inbound.pending} unread`));
        }
        if (inbound.delivering > 0) {
          lines.push(this.theme.fg("muted", `${inbound.delivering} being processed`));
        }
        if (outbound.awaiting > 0) {
          lines.push(this.theme.fg("muted", `${outbound.awaiting} awaiting reply`));
        }
        for (const group of state.mailbox.wait_groups) {
          const status = group.status === "complete" ? "complete" : group.status === "timed_out" ? "timed_out" : group.status === "cancelled" ? "cancelled" : "waiting";
          const color = group.status === "timed_out" ? "warning" : group.status === "complete" ? "success" : "text";
          lines.push(this.theme.fg(color, `${status} ${group.received}/${group.expected}`));
        }
      }
    }

    lines.push(this.heading("DATA COVERAGE"), this.divider(contentWidth), "Current session · structured tools");
    if (state.shellActivityObserved) lines.push(this.theme.fg("muted", "Shell file activity may be missing"));
    if (state.gscStatus === "checking") lines.push(this.theme.fg("dim", "Checking gsc availability"));
    if (state.gscStatus === "missing") {
      lines.push(this.theme.fg("warning", "gsc not installed · no history or Brain analysis"));
      if (!config.dismissedNotices.includes(GSC_MISSING_NOTICE_ID)) {
        lines.push(
          "",
          this.heading("GITSENSE UNAVAILABLE"),
          this.divider(contentWidth),
          "Install gsc to enable repository Brains,",
          "cross-session file history, and related",
          "session discovery.",
          "",
          this.theme.fg("dim", "/brains dismiss"),
        );
      }
    }

    return lines.map((line) => {
      const clipped = truncateToWidth(displayPath(line), contentWidth);
      const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)));
      return ` ${clipped}${padding}`;
    });
  }

  invalidate(): void {}

  private heading(text: string): string {
    return this.theme.fg("accent", text);
  }

  private divider(width: number): string {
    return this.theme.fg("borderMuted", "─".repeat(Math.max(1, width)));
  }
}

const plainTheme = {
  fg: (_color: string, text: string) => text,
} as Theme;

export function renderBrainsPanelSnapshot(state: PanelState, config: PiBrainsConfig, width: number, theme: Theme = plainTheme): string {
  const snapshot = new BrainsPanel(
    () => state,
    () => ({ ...config, visible: true }),
    theme,
  );
  return snapshot.render(width).join("\n").trimEnd();
}
