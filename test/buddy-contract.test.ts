import { describe, expect, it } from "vitest";
import {
  buildPiBuddyCharter,
  buildPiBuddyPartnerBootstrapNotice,
  bootstrapSha256,
  findPiBuddyMetadata,
  parsePiBuddyActivationAcknowledgement,
  parsePiBuddyBootstrap,
  parsePiBuddyMetadata,
  piBuddyMetadataFromBootstrap,
  piBuddyDisplayName,
  PI_BUDDY_ACTIVATION_FILE_NAME,
  PI_BUDDY_BOOTSTRAP_ENV,
  PI_BUDDY_BOOTSTRAP_FILE_NAME,
  PI_BUDDY_CUSTOM_TYPE,
  PI_BUDDY_CHARTER_MARKER,
  type PiBuddyMetadata,
} from "../extensions/pi-brains/buddy-contract.ts";

const piSessionId = "019c0000-0000-7000-8000-000000000001";
const bootstrapId = "019c0000-0000-7000-8000-000000000002";
const nativeSessionId = "01a02473-cfee-7e91-99c9-72a33d9bd0a3";
const binding: PiBuddyMetadata = {
  schemaVersion: 1,
  piSessionId,
  partnerAgent: "codex",
  partnerNativeSessionId: nativeSessionId,
  partnerTransport: "codex-queue",
  createdAt: "2026-08-21T12:00:00Z",
};
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

describe("Pi Buddy v1 contract", () => {
  it("accepts the canonical immutable payload", () => {
    expect(parsePiBuddyMetadata(binding, piSessionId)).toEqual(binding);
  });

  it("freezes the flat snake_case bootstrap and locator", () => {
    expect(parsePiBuddyBootstrap(bootstrap, piSessionId)).toEqual(bootstrap);
    expect(piBuddyMetadataFromBootstrap(bootstrap)).toEqual(binding);
    expect(bootstrapRaw).toBe('{"schema_version":1,"bootstrap_id":"019c0000-0000-7000-8000-000000000002","pi_session_id":"019c0000-0000-7000-8000-000000000001","partner_agent":"codex","partner_native_session_id":"01a02473-cfee-7e91-99c9-72a33d9bd0a3","partner_transport":"codex-queue","created_at":"2026-08-21T12:00:00Z"}');
    expect(bootstrapSha256(bootstrapRaw)).toBe("d54641dbcfd8ffe2c1259c22cb368dffc2e567662a04879dd5e4a2eda7ee092a");
    expect(PI_BUDDY_BOOTSTRAP_ENV).toBe("GSC_PI_BUDDY_BOOTSTRAP");
    expect(PI_BUDDY_BOOTSTRAP_FILE_NAME).toBe("buddy-bootstrap.json");
    expect(PI_BUDDY_ACTIVATION_FILE_NAME).toBe("buddy-activation.json");
    expect(() => parsePiBuddyBootstrap({ ...bootstrap, runtime_state: "active" }, piSessionId))
      .toThrow("unknown fields: runtime_state");
  });

  it("binds activation acknowledgement to the exact retained bootstrap bytes", () => {
    const acknowledgement = {
      schema_version: 1,
      bootstrap_id: bootstrapId,
      pi_session_id: piSessionId,
      bootstrap_sha256: bootstrapSha256(bootstrapRaw),
      custom_entry_id: "buddy-entry-1",
      charter_requested: true,
      activated_at: "2026-08-21T12:00:01Z",
    };
    expect(parsePiBuddyActivationAcknowledgement(acknowledgement, bootstrap, bootstrapRaw))
      .toEqual(acknowledgement);
    expect(() => parsePiBuddyActivationAcknowledgement(acknowledgement, bootstrap, `${bootstrapRaw}\n`))
      .toThrow("bootstrap_sha256");
    expect(() => parsePiBuddyActivationAcknowledgement({
      ...acknowledgement,
      bootstrap_id: "019c0000-0000-7000-8000-000000000003",
    }, bootstrap, bootstrapRaw)).toThrow("bootstrap_id");
    expect(() => parsePiBuddyActivationAcknowledgement({
      ...acknowledgement,
      custom_entry_id: "",
    }, bootstrap, bootstrapRaw)).toThrow("custom_entry_id");
    expect(() => parsePiBuddyActivationAcknowledgement({
      ...acknowledgement,
      charter_requested: false,
    }, bootstrap, bootstrapRaw)).toThrow("charter_requested");
  });

  it("treats a missing entry as a standard session", () => {
    expect(findPiBuddyMetadata(piSessionId, [
      { type: "message" },
      { type: "custom", customType: "example.other", data: {} },
    ])).toBeNull();
  });

  it("rejects a second lifetime binding even when identical", () => {
    const entry = { type: "custom", customType: PI_BUDDY_CUSTOM_TYPE, data: binding };
    expect(() => findPiBuddyMetadata(piSessionId, [entry, entry])).toThrow("more than one");
  });

  it.each([
    ["prefixed Pi identity", { ...binding, piSessionId: `pb-${piSessionId}` }, "unprefixed UUID"],
    ["wrong header", { ...binding, piSessionId: "019c0000-0000-7000-8000-000000000002" }, "does not match"],
    ["mismatched agent transport", { ...binding, partnerAgent: "claude" }, "claude-print-resume"],
    ["prefixed native identity", { ...binding, partnerNativeSessionId: `pb-${nativeSessionId}` }, "unprefixed UUID"],
    ["other transport", { ...binding, partnerTransport: "other" }, "expected codex-queue"],
    ["non-UTC time", { ...binding, createdAt: "2026-08-21T08:00:00-04:00" }, "RFC3339 UTC"],
    ["runtime state", { ...binding, runtimeState: "active" }, "unknown fields: runtimeState"],
  ])("rejects %s", (_name, candidate, message) => {
    expect(() => parsePiBuddyMetadata(candidate, piSessionId)).toThrow(message as string);
  });

  it("tells the Buddy to route without reading or inventing checkpoints", () => {
    const charter = buildPiBuddyCharter(binding);
    expect(charter).toContain(PI_BUDDY_CHARTER_MARKER);
    expect(charter).toContain("Pi routing and continuity partner");
    expect(charter).toContain(`gsc pi sessions buddy wake ${piSessionId}`);
    expect(charter).toContain("fetch or claim partner-directed agent messages");
    expect(charter).toContain("reply to those messages");
    expect(charter).toContain("complete their deliveries");
    expect(charter).toContain("GSC_PI_BUDDY_CONTROL_V1");
    expect(charter).toContain(`Pi Buddy session: ${piSessionId}`);
    expect(charter).toContain("Do not request checkpoints automatically");
    expect(charter).toContain("Never replace, append, remove, unlink, or rebind");
  });

  it("directs Codex to the versioned partner command without copying the contract", () => {
    const notice = buildPiBuddyPartnerBootstrapNotice(binding);
    expect(notice).toContain(`gsc pi sessions buddy partner ${piSessionId} --agent codex`);
    expect(notice).toContain("binding is permanent");
    expect(notice).not.toContain("inbox fetch");
  });

  it("accepts Claude sidecar bindings and keeps their restrictions visible", () => {
    const claude: PiBuddyMetadata = {
      ...binding,
      partnerAgent: "claude",
      partnerTransport: "claude-print-resume",
    };
    expect(parsePiBuddyMetadata(claude, piSessionId)).toEqual(claude);
    const charter = buildPiBuddyCharter(claude);
    expect(charter).toContain("headless Claude sidecar");
    expect(charter).toContain(`gsc pi sessions buddy wake ${piSessionId}`);
    expect(charter).toContain("must not modify repository files");
    expect(charter).toContain("Live-TUI coordination requires");
    expect(charter).toContain("a different transport");
    const notice = buildPiBuddyPartnerBootstrapNotice(claude);
    expect(notice).toContain("Claude Pi Buddy");
    expect(notice).toContain("claude-print-resume");
    expect(piBuddyDisplayName(claude)).toBe("Claude Buddy");
    expect(piBuddyDisplayName(binding)).toBe("Codex Buddy");
  });
});
