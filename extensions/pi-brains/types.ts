export type GlyphFont = "3x5" | "5x7";
export type GlyphStyle = "block" | "ascii";
export type Brightness = "dim" | "normal";

export interface PiBrainsConfig {
  visible: boolean;
  width: number;
  minTerminalWidth: number;
  font: GlyphFont;
  glyph: GlyphStyle;
  brightness: Brightness;
  showModel: boolean;
  showRepositories: boolean;
  dismissedNotices: string[];
  rulesEnabled: boolean;
  debug: boolean;
}

export interface ContextState {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface ModelState {
  id: string;
  provider: string;
  thinkingLevel: string;
}

export interface RepositoryState {
  root: string;
  fileCount: number;
  isInitialCwd: boolean;
  files: string[];
}

export type GscStatus = "checking" | "available" | "missing";

export interface PanelState {
  context: ContextState | null;
  model: ModelState | null;
  repositories: RepositoryState[];
  outsideRepositoryCount: number;
  trackedFileCount: number;
  shellActivityObserved: boolean;
  gscStatus: GscStatus;
}
