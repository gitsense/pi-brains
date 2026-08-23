/**
 * Pi Buddy v1 Contract
 *
 * Pure contract helpers shared by the later Buddy startup activation path.
 * This module deliberately does not listen for startup events or mutate a
 * session; Phase 1 only freezes validation and the messages both agents read.
 */

import { createHash } from "node:crypto";

export const PI_BUDDY_CUSTOM_TYPE = "gitsense.pi-buddy";
export const PI_BUDDY_SCHEMA_VERSION = 1;
export const PI_BUDDY_PARTNER_AGENT = "codex";
export const PI_BUDDY_PARTNER_TRANSPORT = "codex-queue";
export const PI_BUDDY_PARTNER_AGENT_CLAUDE = "claude";
export const PI_BUDDY_PARTNER_TRANSPORT_CLAUDE = "claude-print-resume";
export const PI_BUDDY_BOOTSTRAP_ENV = "GSC_PI_BUDDY_BOOTSTRAP";
export const PI_BUDDY_BOOTSTRAP_FILE_NAME = "buddy-bootstrap.json";
export const PI_BUDDY_ACTIVATION_FILE_NAME = "buddy-activation.json";
export const PI_BUDDY_CHARTER_MARKER = "[GSC_PI_BUDDY_CHARTER_V1]";

export function piBuddyDisplayName(binding: Pick<PiBuddyMetadata, "partnerAgent">): string {
  return binding.partnerAgent === "claude" ? "Claude Buddy" : "Codex Buddy";
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PiBuddyMetadata {
  schemaVersion: 1;
  piSessionId: string;
  partnerAgent: "codex" | "claude";
  partnerNativeSessionId: string;
  partnerTransport: "codex-queue" | "claude-print-resume";
  createdAt: string;
}

export interface PiCustomEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
}

export interface PiBuddyBootstrap {
  schema_version: 1;
  bootstrap_id: string;
  pi_session_id: string;
  partner_agent: "codex" | "claude";
  partner_native_session_id: string;
  partner_transport: "codex-queue" | "claude-print-resume";
  created_at: string;
}

export interface PiBuddyActivationAcknowledgement {
  schema_version: 1;
  bootstrap_id: string;
  pi_session_id: string;
  bootstrap_sha256: string;
  custom_entry_id: string;
  charter_requested: true;
  activated_at: string;
}

/** Validate the flat snake_case gsc -> pi-brains startup handoff. */
export function parsePiBuddyBootstrap(value: unknown, expectedPiSessionId: string): PiBuddyBootstrap {
  if (!isRecord(value)) throw new Error("Pi Buddy bootstrap must be an object");
  const expectedKeys = [
    "schema_version",
    "bootstrap_id",
    "pi_session_id",
    "partner_agent",
    "partner_native_session_id",
    "partner_transport",
    "created_at",
  ];
  assertExactKeys(value, expectedKeys, "Pi Buddy bootstrap");
  if (value.schema_version !== PI_BUDDY_SCHEMA_VERSION) {
    throw new Error(`unsupported Pi Buddy bootstrap schema_version ${String(value.schema_version)}; expected 1`);
  }
  assertCanonicalUuid(value.bootstrap_id, "bootstrap_id");
  assertCanonicalUuid(value.pi_session_id, "pi_session_id");
  if (value.pi_session_id !== expectedPiSessionId) {
    throw new Error(`Pi Buddy bootstrap pi_session_id ${JSON.stringify(value.pi_session_id)} does not match active session ${JSON.stringify(expectedPiSessionId)}`);
  }
  assertSupportedPartner(value.partner_agent, value.partner_transport);
  assertCanonicalUuid(value.partner_native_session_id, "partner_native_session_id");
  assertUtcTimestamp(value.created_at, "created_at");

  return value as unknown as PiBuddyBootstrap;
}

/** Convert the flat cache record to Pi's immutable camelCase custom entry. */
export function piBuddyMetadataFromBootstrap(bootstrap: PiBuddyBootstrap): PiBuddyMetadata {
  const parsed = parsePiBuddyBootstrap(bootstrap, bootstrap.pi_session_id);
  return {
    schemaVersion: PI_BUDDY_SCHEMA_VERSION,
    piSessionId: parsed.pi_session_id,
    partnerAgent: parsed.partner_agent,
    partnerNativeSessionId: parsed.partner_native_session_id,
    partnerTransport: parsed.partner_transport,
    createdAt: parsed.created_at,
  };
}

/** SHA-256 of the exact bootstrap file bytes, lowercase hexadecimal. */
export function bootstrapSha256(raw: string | Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Validate the acknowledgement written after all activation actions succeed. */
export function parsePiBuddyActivationAcknowledgement(
  value: unknown,
  bootstrap: PiBuddyBootstrap,
  bootstrapRaw: string | Uint8Array,
): PiBuddyActivationAcknowledgement {
  const parsedBootstrap = parsePiBuddyBootstrap(bootstrap, bootstrap.pi_session_id);
  if (!isRecord(value)) throw new Error("Pi Buddy activation acknowledgement must be an object");
  assertExactKeys(value, [
    "schema_version",
    "bootstrap_id",
    "pi_session_id",
    "bootstrap_sha256",
    "custom_entry_id",
    "charter_requested",
    "activated_at",
  ], "Pi Buddy activation acknowledgement");
  if (value.schema_version !== PI_BUDDY_SCHEMA_VERSION) {
    throw new Error(`unsupported Pi Buddy activation schema_version ${String(value.schema_version)}; expected 1`);
  }
  if (value.bootstrap_id !== parsedBootstrap.bootstrap_id) {
    throw new Error(`Pi Buddy activation bootstrap_id ${JSON.stringify(value.bootstrap_id)} does not match bootstrap ${JSON.stringify(parsedBootstrap.bootstrap_id)}`);
  }
  if (value.pi_session_id !== parsedBootstrap.pi_session_id) {
    throw new Error(`Pi Buddy activation pi_session_id ${JSON.stringify(value.pi_session_id)} does not match bootstrap ${JSON.stringify(parsedBootstrap.pi_session_id)}`);
  }
  const expectedSha = bootstrapSha256(bootstrapRaw);
  if (value.bootstrap_sha256 !== expectedSha) {
    throw new Error(`Pi Buddy activation bootstrap_sha256 ${JSON.stringify(value.bootstrap_sha256)} does not match ${JSON.stringify(expectedSha)}`);
  }
  if (typeof value.custom_entry_id !== "string" || value.custom_entry_id === "" || value.custom_entry_id.trim() !== value.custom_entry_id) {
    throw new Error(`invalid Pi Buddy activation custom_entry_id ${JSON.stringify(value.custom_entry_id)}; expected the non-empty Pi entry id`);
  }
  if (value.charter_requested !== true) {
    throw new Error("invalid Pi Buddy activation charter_requested; the Buddy charter must be requested before acknowledgement");
  }
  assertUtcTimestamp(value.activated_at, "activated_at");
  return value as unknown as PiBuddyActivationAcknowledgement;
}

/**
 * Validate the immutable v1 payload. Runtime, mailbox, delivery, checkpoint,
 * and activation fields are rejected rather than being folded into identity.
 */
export function parsePiBuddyMetadata(value: unknown, expectedPiSessionId: string): PiBuddyMetadata {
  assertCanonicalUuid(expectedPiSessionId, "session header id");
  if (!isRecord(value)) throw new Error("Pi Buddy data must be an object");

  const expectedKeys = [
    "schemaVersion",
    "piSessionId",
    "partnerAgent",
    "partnerNativeSessionId",
    "partnerTransport",
    "createdAt",
  ];
  const actualKeys = Object.keys(value).sort();
  if (actualKeys.join("\u0000") !== [...expectedKeys].sort().join("\u0000")) {
    const unknown = actualKeys.filter((key) => !expectedKeys.includes(key));
    const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
    const details = [
      unknown.length ? `unknown fields: ${unknown.join(", ")}` : "",
      missing.length ? `missing fields: ${missing.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`invalid Pi Buddy v1 fields${details ? ` (${details})` : ""}`);
  }

  if (value.schemaVersion !== PI_BUDDY_SCHEMA_VERSION) {
    throw new Error(`unsupported Pi Buddy schemaVersion ${String(value.schemaVersion)}; expected 1`);
  }
  assertCanonicalUuid(value.piSessionId, "piSessionId");
  if (value.piSessionId !== expectedPiSessionId) {
    throw new Error(`Pi Buddy piSessionId ${JSON.stringify(value.piSessionId)} does not match session header ${JSON.stringify(expectedPiSessionId)}`);
  }
  assertSupportedPartner(value.partnerAgent, value.partnerTransport);
  assertCanonicalUuid(value.partnerNativeSessionId, "partnerNativeSessionId");
  assertUtcTimestamp(value.createdAt, "createdAt");

  return value as unknown as PiBuddyMetadata;
}

/**
 * Return the session's sole Buddy binding, or null for a standard Pi session.
 * A repeated entry is invalid even when byte-for-byte identical: the binding
 * is written once and remains permanent for the life of the session.
 */
export function findPiBuddyMetadata(
  piSessionId: string,
  entries: readonly PiCustomEntryLike[],
): PiBuddyMetadata | null {
  let result: PiBuddyMetadata | null = null;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PI_BUDDY_CUSTOM_TYPE) continue;
    if (result) {
      throw new Error(`Pi session ${piSessionId} contains more than one ${PI_BUDDY_CUSTOM_TYPE} entry; a Buddy binding is permanent`);
    }
    result = parsePiBuddyMetadata(entry.data, piSessionId);
  }
  return result;
}

/** Build the charter automatically injected into a newly activated Buddy. */
export function buildPiBuddyCharter(binding: PiBuddyMetadata): string {
  parsePiBuddyMetadata(binding, binding.piSessionId);
  if (binding.partnerAgent === "claude") {
    return `${PI_BUDDY_CHARTER_MARKER}

You are a Claude Buddy permanently paired with a native Claude session.

Pi Buddy session: ${binding.piSessionId}
Partner harness: claude
Partner native session: ${binding.partnerNativeSessionId}
Partner transport: claude print resume

Your job is routing, provenance, and continuity between this Pi identity and
the headless Claude sidecar continuation. This binding is permanent for the
life of the Pi session.

Ground rules:
- Never claim, fetch, display, summarize, or answer messages addressed to this
  Pi inbox. Inbox notices are metadata-only wakeups; the Claude sidecar owns
  the message body and reply.
- When notified that mail is waiting, invoke:
  gsc pi sessions buddy wake ${binding.piSessionId}
- The sidecar continuation reads the inbox body and performs only status
  reports, knowledge extraction, handoffs, inbox replies, and explicitly
  requested checkpoints.
- The sidecar must not modify repository files, wake or update the live Claude
  TUI, or claim to coordinate ongoing TUI work. Live-TUI coordination requires
  a different transport.
- Do not create checkpoints automatically. A checkpoint is created only when
  the human explicitly requests one, or asks you to request one from Claude.
- When the human asks you to request one, use the managed control relay:
  gsc pi sessions buddy checkpoint ${binding.piSessionId}
- Never replace, append, rebind, or remove the gitsense.pi-buddy entry.

Acknowledge this charter by replying with exactly: ok`;
  }
  return `${PI_BUDDY_CHARTER_MARKER}

You are the Pi routing and continuity partner in a permanent Pi Buddy-Codex
collaboration.

Collaboration model:
- You provide the durable Pi session, canonical mailbox identity, routing,
  wake notices, and GitSense Chat provenance.
- The native Codex partner performs reasoning, implementation, knowledge
  extraction, replies, and explicitly requested checkpoint publication.
- You do not perform or claim Codex's work.
- GitSense Chat does not automatically import the Codex transcript.
- An explicit Codex checkpoint deliberately publishes selected knowledge for
  GitSense Chat search and reuse.

Pi Buddy session: ${binding.piSessionId}
Partner harness: codex
Partner native session: ${binding.partnerNativeSessionId}
Partner transport: codex queue

Permanent identities:
- The bare Pi Buddy UUID is the canonical Pi mailbox and checkpoint session
  identity.
- The native Codex UUID is the queue transport endpoint and native checkpoint
  provenance.
- Never add a pb- prefix.
- Never use the native Codex UUID as a Pi mailbox identity.
- This binding is permanent. Never replace, append, remove, unlink, or rebind
  the gitsense.pi-buddy entry.

Partner-directed agent mail:
You are a router for partner-directed agent mail. Codex owns its contents and
delivery lifecycle.

Never:
- fetch or claim partner-directed agent messages;
- display, summarize, interpret, or answer their bodies;
- reply to those messages;
- complete their deliveries;
- poll or watch the inbox continuously.

When a metadata notice says partner mail is waiting, wake Codex with:

  gsc pi sessions buddy wake ${binding.piSessionId}

This managed command validates the permanent binding and sends a metadata-only
notice to the bound Codex thread. Do not include the peer's message body in a
wake notice. Codex fetches the message and uses the inbox reply and completion
workflow, preserving the original sender and thread provenance.

Direct human requests:
You may read and respond to direct human prompts in this Pi conversation.
Routine inbox mail must use the managed Buddy wake command. Do not invent an
answer or perform Codex work yourself.

If the human directly asks you to request a Codex checkpoint and no inbox
message carries that request, use the managed control relay:

  gsc pi sessions buddy checkpoint ${binding.piSessionId}

Do not use this control path to forward peer-controlled inbox bodies.

Checkpoints:
- Never create or author a checkpoint yourself.
- Codex may create one only after a direct human request or this exact,
  machine-generated human-request relay.
- Do not request checkpoints automatically at status, handoff, compaction,
  review, or completion boundaries.

Acknowledge this charter by replying with exactly: ok`;
}

/** Build the one-time notice sent through the bound native partner transport. */
export function buildPiBuddyPartnerBootstrapNotice(binding: PiBuddyMetadata): string {
  parsePiBuddyMetadata(binding, binding.piSessionId);
  const partnerName = binding.partnerAgent === "claude" ? "Claude" : "Codex";
  return `You now have a ${partnerName} Pi Buddy and Pi inbox for cross-agent communication and durable checkpoint provenance.

Pi Buddy session: ${binding.piSessionId}

Run the following command now and follow the returned partner contract:
gsc pi sessions buddy partner ${binding.piSessionId} --agent ${binding.partnerAgent}

This Buddy binding is permanent for the life of the Pi session.

The Pi Buddy uses the ${binding.partnerTransport} transport.`;
}

function assertSupportedPartner(agent: unknown, transport: unknown): asserts agent is "codex" | "claude" {
  if (agent === "codex" && transport === "codex-queue") return;
  if (agent === "claude" && transport === "claude-print-resume") return;
  if (agent !== "codex" && agent !== "claude") {
    throw new Error(`unsupported Pi Buddy partner ${JSON.stringify(agent)}; v1 supports codex/codex-queue and claude/claude-print-resume`);
  }
  const expected = agent === "claude" ? "claude-print-resume" : "codex-queue";
  throw new Error(`unsupported Pi Buddy partner transport ${JSON.stringify(transport)} for ${JSON.stringify(agent)}; expected ${expected}`);
}

function assertCanonicalUuid(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.startsWith("pb-") || !CANONICAL_UUID.test(value)) {
    throw new Error(`invalid Pi Buddy ${field} ${JSON.stringify(value)}; expected a canonical unprefixed UUID`);
  }
}

function assertUtcTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new Error(`invalid Pi Buddy ${field} ${JSON.stringify(value)}; expected RFC3339 UTC ending in Z`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expectedKeys: string[], label: string): void {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (actualKeys.join("\u0000") === sortedExpected.join("\u0000")) return;
  const unknown = actualKeys.filter((key) => !expectedKeys.includes(key));
  const missing = expectedKeys.filter((key) => !actualKeys.includes(key));
  const details = [
    unknown.length ? `unknown fields: ${unknown.join(", ")}` : "",
    missing.length ? `missing fields: ${missing.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  throw new Error(`invalid ${label} fields${details ? ` (${details})` : ""}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
