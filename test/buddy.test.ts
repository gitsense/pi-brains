import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { activatePiBuddyAtStartup } from "../extensions/pi-brains/buddy.ts";
import {
  bootstrapSha256,
  buildPiBuddyCharter,
  PI_BUDDY_ACTIVATION_FILE_NAME,
  PI_BUDDY_BOOTSTRAP_ENV,
  PI_BUDDY_BOOTSTRAP_FILE_NAME,
  PI_BUDDY_CHARTER_MARKER,
  PI_BUDDY_CUSTOM_TYPE,
  piBuddyMetadataFromBootstrap,
} from "../extensions/pi-brains/buddy-contract.ts";

const piSessionId = "019c0000-0000-7000-8000-000000000001";
const bootstrapId = "019c0000-0000-7000-8000-000000000002";
const nativeSessionId = "01a02473-cfee-7e91-99c9-72a33d9bd0a3";
const bootstrap = {
  schema_version: 1 as const,
  bootstrap_id: bootstrapId,
  pi_session_id: piSessionId,
  partner_agent: "codex" as const,
  partner_native_session_id: nativeSessionId,
  partner_transport: "codex-queue" as const,
  created_at: "2026-08-21T12:00:00Z",
};
const bootstrapRaw = JSON.stringify(bootstrap);

interface FakeEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  customType?: string;
  data?: unknown;
  message?: unknown;
}

interface FakePiState {
  entries: FakeEntry[];
  appendCalls: number;
  charterCalls: string[];
  sessionName?: string;
  failCharter: boolean;
}

let tempRoots: string[] = [];
const originalGscHome = process.env.GSC_HOME;
const originalBootstrapPath = process.env[PI_BUDDY_BOOTSTRAP_ENV];

afterEach(() => {
  if (originalGscHome === undefined) delete process.env.GSC_HOME;
  else process.env.GSC_HOME = originalGscHome;
  if (originalBootstrapPath === undefined) delete process.env[PI_BUDDY_BOOTSTRAP_ENV];
  else process.env[PI_BUDDY_BOOTSTRAP_ENV] = originalBootstrapPath;
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function prepareBootstrap(): { root: string; bootstrapPath: string; activationPath: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-buddy-test-"));
  tempRoots.push(root);
  const sessionDir = join(root, "data", "pi", "sessions", piSessionId);
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  chmodSync(join(root, "data", "pi", "sessions"), 0o700);
  chmodSync(sessionDir, 0o700);
  const bootstrapPath = join(sessionDir, PI_BUDDY_BOOTSTRAP_FILE_NAME);
  writeFileSync(bootstrapPath, bootstrapRaw, { mode: 0o600 });
  chmodSync(bootstrapPath, 0o600);
  process.env.GSC_HOME = root;
  process.env[PI_BUDDY_BOOTSTRAP_ENV] = bootstrapPath;
  return {
    root,
    bootstrapPath,
    activationPath: join(sessionDir, PI_BUDDY_ACTIVATION_FILE_NAME),
  };
}

function fakeRuntime(initialEntries: FakeEntry[] = []): {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  state: FakePiState;
} {
  const state: FakePiState = {
    entries: initialEntries,
    appendCalls: 0,
    charterCalls: [],
    failCharter: false,
  };
  let sequence = 0;
  const timestamp = () => `2026-08-21T12:00:${String(++sequence).padStart(2, "0")}Z`;
  const sessionManager = {
    getSessionId: () => piSessionId,
    getEntries: () => state.entries,
    getSessionName: () => state.sessionName,
  };
  const pi = {
    appendEntry: (customType: string, data: unknown) => {
      state.appendCalls += 1;
      state.entries.push({
        type: "custom",
        id: `buddy-entry-${state.appendCalls}`,
        parentId: null,
        timestamp: timestamp(),
        customType,
        data,
      });
    },
    sendUserMessage: (content: string) => {
      if (state.failCharter) throw new Error("fake charter transport failure");
      state.charterCalls.push(content);
      state.entries.push({
        type: "message",
        id: "charter-message-1",
        parentId: null,
        timestamp: timestamp(),
        message: { role: "user", content },
      });
    },
    setSessionName: (name: string) => {
      state.sessionName = name;
    },
  } as unknown as ExtensionAPI;
  return {
    pi,
    ctx: { sessionManager } as unknown as ExtensionContext,
    state,
  };
}

function customEntry(id: string, data = piBuddyMetadataFromBootstrap(bootstrap)): FakeEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: "2026-08-21T12:00:00Z",
    customType: PI_BUDDY_CUSTOM_TYPE,
    data,
  };
}

describe("Pi Buddy startup activation", () => {
  it("creates one immutable entry, requests the charter, and writes the exact acknowledgement", () => {
    const { bootstrapPath, activationPath } = prepareBootstrap();
    const runtime = fakeRuntime();

    const result = activatePiBuddyAtStartup(runtime.pi, runtime.ctx);

    expect(result).toMatchObject({
      activated: true,
      sessionId: piSessionId,
      bootstrapPath,
      activationPath,
      customEntryId: "buddy-entry-1",
      charterRequested: true,
    });
    expect(runtime.state.appendCalls).toBe(1);
    expect(runtime.state.charterCalls).toHaveLength(1);
    expect(runtime.state.charterCalls[0]).toContain(PI_BUDDY_CHARTER_MARKER);
    expect(runtime.state.entries.filter((entry) => entry.customType === PI_BUDDY_CUSTOM_TYPE)).toHaveLength(1);
    expect(runtime.state.sessionName).toBe("Codex Buddy");
    expect(existsSync(bootstrapPath)).toBe(true);
    expect(statSync(bootstrapPath).mode & 0o777).toBe(0o600);
    expect(statSync(activationPath).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(activationPath, "utf8"))).toEqual({
      schema_version: 1,
      bootstrap_id: bootstrapId,
      bootstrap_sha256: bootstrapSha256(bootstrapRaw),
      pi_session_id: piSessionId,
      custom_entry_id: "buddy-entry-1",
      charter_requested: true,
      activated_at: expect.any(String),
    });
  });

  it("is idempotent after restart and does not append or request a second charter", () => {
    prepareBootstrap();
    const runtime = fakeRuntime();
    activatePiBuddyAtStartup(runtime.pi, runtime.ctx);

    const result = activatePiBuddyAtStartup(runtime.pi, runtime.ctx);

    expect(result?.customEntryId).toBe("buddy-entry-1");
    expect(runtime.state.appendCalls).toBe(1);
    expect(runtime.state.charterCalls).toHaveLength(1);
    expect(runtime.state.entries.filter((entry) => entry.customType === PI_BUDDY_CUSTOM_TYPE)).toHaveLength(1);
  });

  it("recovers a session with the entry but without the charter or acknowledgement", () => {
    const { activationPath } = prepareBootstrap();
    const runtime = fakeRuntime([customEntry("recovered-entry")]);

    activatePiBuddyAtStartup(runtime.pi, runtime.ctx);

    expect(runtime.state.appendCalls).toBe(0);
    expect(runtime.state.charterCalls).toHaveLength(1);
    expect(JSON.parse(readFileSync(activationPath, "utf8"))).toMatchObject({
      custom_entry_id: "recovered-entry",
      charter_requested: true,
    });
  });

  it("rejects conflicts and duplicate Buddy entries without choosing a winner", () => {
    prepareBootstrap();
    const conflicting = piBuddyMetadataFromBootstrap(bootstrap);
    conflicting.partnerNativeSessionId = "01a02473-cfee-7e91-99c9-72a33d9bd0ff";
    const conflictRuntime = fakeRuntime([customEntry("conflict", conflicting)]);
    expect(() => activatePiBuddyAtStartup(conflictRuntime.pi, conflictRuntime.ctx)).toThrow("conflicts");

    const runtime = fakeRuntime([customEntry("one"), customEntry("two")]);
    expect(() => activatePiBuddyAtStartup(runtime.pi, runtime.ctx)).toThrow("more than one");
    expect(runtime.state.appendCalls).toBe(0);
    expect(runtime.state.charterCalls).toHaveLength(0);
  });

  it("rejects unexpected user activity before materializing a Buddy", () => {
    prepareBootstrap();
    const runtime = fakeRuntime([{
      type: "message",
      id: "user-message-1",
      parentId: null,
      timestamp: "2026-08-21T12:00:00Z",
      message: { role: "user", content: "existing work" },
    }]);

    expect(() => activatePiBuddyAtStartup(runtime.pi, runtime.ctx)).toThrow("fresh Pi session");
    expect(runtime.state.appendCalls).toBe(0);
    expect(runtime.state.charterCalls).toHaveLength(0);
  });

  it("does not acknowledge a failed charter request and retains bootstrap state", () => {
    const { bootstrapPath, activationPath } = prepareBootstrap();
    const runtime = fakeRuntime();
    runtime.state.failCharter = true;

    expect(() => activatePiBuddyAtStartup(runtime.pi, runtime.ctx)).toThrow("charter request failed");
    expect(existsSync(bootstrapPath)).toBe(true);
    expect(existsSync(activationPath)).toBe(false);
    expect(runtime.state.appendCalls).toBe(1);
    expect(runtime.state.charterCalls).toHaveLength(0);
  });

  it("regenerates a malformed acknowledgement without touching the binding", () => {
    const { activationPath } = prepareBootstrap();
    const runtime = fakeRuntime();
    activatePiBuddyAtStartup(runtime.pi, runtime.ctx);
    writeFileSync(activationPath, "{malformed", { mode: 0o600 });

    activatePiBuddyAtStartup(runtime.pi, runtime.ctx);

    expect(runtime.state.appendCalls).toBe(1);
    expect(runtime.state.charterCalls).toHaveLength(1);
    expect(JSON.parse(readFileSync(activationPath, "utf8")).bootstrap_sha256).toBe(bootstrapSha256(bootstrapRaw));
  });

  it("leaves standard startup untouched when the reserved environment variable is absent", () => {
    const runtime = fakeRuntime();
    delete process.env[PI_BUDDY_BOOTSTRAP_ENV];

    expect(activatePiBuddyAtStartup(runtime.pi, runtime.ctx)).toBeNull();
    expect(runtime.state.entries).toHaveLength(0);
    expect(runtime.state.appendCalls).toBe(0);
    expect(runtime.state.charterCalls).toHaveLength(0);
  });

  it("requires the reserved bootstrap path to be the expected retained file", () => {
    const { root } = prepareBootstrap();
    process.env[PI_BUDDY_BOOTSTRAP_ENV] = join(root, "other.json");
    const runtime = fakeRuntime();

    expect(() => activatePiBuddyAtStartup(runtime.pi, runtime.ctx)).toThrow("must point to");
  });

  it("recognizes a persisted charter as a user message, not custom-entry data", () => {
    prepareBootstrap();
    const binding = piBuddyMetadataFromBootstrap(bootstrap);
    const runtime = fakeRuntime([
      customEntry("persisted-entry"),
      {
        type: "message",
        id: "persisted-charter",
        parentId: "persisted-entry",
        timestamp: "2026-08-21T12:00:01Z",
        message: { role: "user", content: buildPiBuddyCharter(binding) },
      },
    ]);

    activatePiBuddyAtStartup(runtime.pi, runtime.ctx);

    expect(runtime.state.appendCalls).toBe(0);
    expect(runtime.state.charterCalls).toHaveLength(0);
  });
});
