export type GlyphFont = "3x5" | "5x7";
export type GlyphStyle = "block" | "ascii";
export type Brightness = "dim" | "normal";

export interface AskGroup {
  id: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

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
  guideEnabled: boolean;
  /** Session UUIDs whose snapshot suggestion prompt is enabled. */
  snapshotSuggestionSessionIds: string[];
  inboxAutoAccept: boolean;
  waitGroupCursors: Record<string, number>;
  askGroups: AskGroup[];
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
  mailbox: MailboxSummary | null;
}

export type WaitGroupStatusName = "waiting" | "complete" | "timed_out" | "cancelled";

/**
 * §10 mailbox summary payload from `gsc pi sessions inbox summary`.
 * Consumed by the overlay, /brains inbox info, and the wait-group watcher.
 */
export interface MailboxSummary {
  session_id: string;
  mailbox: {
    inbound: { pending: number; delivering: number; accepted: number; ignored: number; expired: number };
    outbound: { sent: number; replied: number; awaiting: number; expired: number; rejected: number };
  };
  wait_groups: MailboxWaitGroup[];
}

export interface MailboxWaitGroup {
  id: string;
  expected: number;
  received: number;
  status: WaitGroupStatusName;
  deadline: string;
}

/**
 * §5 wait-group record with the per-group monotonic event stream (§8.1).
 * The event stream is the durable source of truth; the watcher is a pure
 * reader that notifies once per unseen event_seq and advances its cursor.
 */
export interface WaitGroupEvent {
  event_id: string;
  event_seq: number;
  type: string;
  at: string;
  details?: string;
}

export interface WaitGroupStatus {
  wait_group_id: string;
  owner_session_id: string;
  expected_count: number;
  expected_outbound_ids: string[];
  received_reply_ids: string[];
  deadline: string;
  status: WaitGroupStatusName;
  events: WaitGroupEvent[];
}
