import {
  DynamicBorder,
  getMarkdownTheme,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Text } from "@earendil-works/pi-tui";

const BRAINS_INSIGHTS_ENTRY = "brains-insights";

export interface BrainsInsightsEntryData {
  title: string;
  markdown: string;
  createdAt: number;
}

/**
 * Render durable insights inside the transcript without adding them to the
 * model's conversation context.
 */
export function registerBrainsInsightsEntryRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<BrainsInsightsEntryData>(BRAINS_INSIGHTS_ENTRY, (entry, { expanded }, theme) => {
    const data = entry.data ?? {
      title: "Brains Insights",
      markdown: "No insights available",
      createdAt: Date.now(),
    };
    const container = new Container();
    const borderColor = (text: string) => theme.fg("accent", text);

    container.addChild(new DynamicBorder(borderColor));
    container.addChild(new Text(theme.fg("accent", theme.bold(data.title)), 1, 0));
    container.addChild(
      new Markdown(
        data.markdown,
        1,
        1,
        getMarkdownTheme(),
        { color: (text) => theme.fg("text", text) },
      ),
    );
    if (expanded) {
      container.addChild(new Text(theme.fg("dim", new Date(data.createdAt).toLocaleString()), 1, 0));
    }
    container.addChild(new DynamicBorder(borderColor));

    return container;
  });
}

export function appendBrainsInsightsEntry(pi: ExtensionAPI, markdown: string): void {
  pi.appendEntry<BrainsInsightsEntryData>(BRAINS_INSIGHTS_ENTRY, {
    title: "Brains Insights",
    markdown: markdown || "No insights available",
    createdAt: Date.now(),
  });
}
