import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";

interface OutputPanelContext extends ExtensionCommandContext {
  ui: ExtensionCommandContext["ui"] & {
    custom?: ExtensionCommandContext["ui"]["custom"];
  };
}

export interface OutputPanelOptions {
  status?: {
    text: string;
    color?: "accent" | "success" | "warning" | "error";
  };
}

/**
 * Show long-form extension output in a themed, dismissible TUI panel.
 *
 * Non-TUI contexts and older test hosts fall back to the existing notification
 * behavior so commands remain usable outside the interactive application.
 */
export async function showOutputPanel(
  ctx: ExtensionCommandContext,
  title: string,
  markdown: string,
  options: OutputPanelOptions = {},
): Promise<void> {
  const panelCtx = ctx as OutputPanelContext;
  if (ctx.mode !== "tui" || typeof panelCtx.ui.custom !== "function") {
    const status = options.status ? `${options.status.text}\n\n` : "";
    ctx.ui.notify(`${title}\n\n${status}${markdown}`, "info");
    return;
  }

  await panelCtx.ui.custom((_tui, theme, _keybindings, done) => {
    const container = new Container();
    const border = new DynamicBorder((text) => theme.fg("accent", text));
    const markdownView = new Markdown(
      markdown,
      1,
      1,
      getMarkdownTheme(),
      { color: (text) => theme.fg("text", text) },
    );

    container.addChild(border);
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
    if (options.status) {
      const color = options.status.color ?? "accent";
      container.addChild(new Text(theme.fg(color, theme.bold(options.status.text)), 1, 0));
    }
    container.addChild(markdownView);
    container.addChild(new Text(theme.fg("dim", "Press Enter, Esc, or q to close"), 1, 0));
    container.addChild(border);

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (matchesKey(data, "enter") || matchesKey(data, "escape") || data === "q" || data === "Q") {
          done(undefined);
        }
      },
    };
  });
}
