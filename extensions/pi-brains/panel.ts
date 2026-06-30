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
