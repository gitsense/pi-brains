# Chat App Handoff — Agent-to-Agent Messaging UI (rev 2.2)

> Stable, pointable contract for the Chat-app slice. Spec source of truth:
> [`./inbox-agent-messaging-v1.md`](./inbox-agent-messaging-v1.md) (v1.2.1).
> Review history: [`./archive/inbox-agent-messaging-review.md`](./archive/inbox-agent-messaging-review.md) (superseded).

## 0. Recent changes (rev 2.2 addendum — these supersede earlier sections where they differ)

- **Known-session check widened**: `send`/`reply` now accept any session that already has a mailbox **or** exists as a native Pi session file (`<timestamp>_<uuid>.jsonl` under `~/.pi/agent/sessions`). Mailboxes are created lazily on first contact (human `add`, `send`, `reply`). `no_such_mailbox` now fires only for genuinely unknown UUIDs — a real session that has simply never received Chat mail is addressable. No dependency on sync state or the mirror DB. (A send to a real-but-unknown-looking session previously failed with `no_such_mailbox`; that is fixed.)
- **Rejected sends can be dismissed**: `gsc pi sessions inbox clear-rejected --session-id <me>` (wrapped as `/brains inbox clear`) removes rejected outbox attempts; `summary.outbound.rejected` and thread views drop to 0. Outbox is derived data (§7); canonical inbox files are untouched.
- **Inbox-code gate is no-paste** (from rev 2.1): unchanged — see §3. The backend checks the store itself (`code status --format json`), so there is no per-origin state (localhost/127.0.0.1 equivalent) and no client-side code.

## 1. Read first (in order)

1. `./inbox-agent-messaging-v1.md` — v1.2.1: §1–§3 (goals/threat/scope), §4 (schema v2), §5 (commands), §8 (notification policy), §10 (**this slice**), §11 (rolling compatibility), §15 (review map), §16 (change surface by repo).
2. `./archive/inbox-agent-messaging-review.md` — historical review; skim only.
3. Prior phase reports (summarized in §6):
   - **Phase 1 (gsc-cli, done)** — schema v2; `send/reply/fetch/complete/keepalive/wait/summary`; outbox + wait-group stores; dual-read. Code: `~/gsc-cli/internal/pi/sessions/{envelope,inbox,outbox,fetch,waitgroups,summary}.go`, `~/gsc-cli/internal/cli/pi/sessions/inbox.go`.
   - **Phase 2 (pi-brains, done)** — always-on identity/trust/guide pointer; awaiting-aware watcher (metadata-only "you have mail"); pure-reader wait-group wake-ups with durable cursor; overlay mail section; `/brains inbox info`. Code: `~/pi-brains/extensions/pi-brains/{inbox,controller,index,panel,types,config}.ts`.

## 2. Slice scope (§10, §12, §16)

- **Backend** `getPiSessionMailboxBatch(sessionIds)` → `gsc pi sessions inbox summary --session-id <id>` per id, piggybacked on the existing `getPiSessionInboxBatch` poll/SSE loop. Code: `~/gitsense-chat/packages/chat/widgets/app/components/pi/backend/index.js`.
- **Groups-page mail rows**: orchestrator `sent 2 · replied 0` → `sent 2 · replied 1`; worker `1 unread · 0 replies sent` → `processing 1` → `1 replied`; wait-group line `waiting 1/2`.
- **Exact-id resolution** (reviewer finding #4): compose polls `gsc pi sessions inbox show --session-id <me> --id <mine>` — never newest-first inference.
- **Copyable bare UUIDs** on mail rows/addresses.
- **v1/v2 dual-read** in rendering: `body ?? message` (v2 canonical is `body`; `message` is a transitional mirror that will disappear).
- **Loop badges** from `envelope` (`hop/max_hops`, `reply_to_message_id`); human messages have no envelope.

## 3. Inbox-code contract (the `--code` gate)

`gsc pi sessions inbox add` **requires `--code`**, validated server-side. Per spec §2 the gate prevents **accidental** use; it is not a security boundary. The product flow is deliberately user-visible:

### 3.1 Product flow (no paste)

- The user generates the code in the Pi TUI: `gsc pi sessions inbox code generate` (wrapped as `/brains inbox code generate`). Default TTL **90 days**; optional `--ttl`. The command only confirms — the code itself is **never shown or copied**; there is no paste step.
- `/brains inbox code delete` revokes (send becomes disabled until a new code is generated).
- **One active code per GSC_HOME** — `generate` replaces; the old code stops validating.
- **Regenerating always resets the window to 90 days.**
- The Chat backend reads the store directly (below), so there is **no per-origin state**: `localhost` and `127.0.0.1` are equivalent — the code cannot be "entered twice".

### 3.2 Code artifact (pinned shape)

Written by gsc (`inbox code generate`) at `GSC_HOME/data/codes/<6-digit>.json`:

```json
{
  "code": "123456",
  "consumer": "gsc",
  "purpose": "inbox",
  "status": "pending",
  "createdAt": "…",
  "expiresAt": "…",
  "gscHome": "/absolute/path/of/GSC_HOME"
}
```

- `status` stays `"pending"` forever — the artifact is never consumed or transitioned (health checks and `add` validation are read-only).
- `gscHome` records the store the code was generated for (resolves clarification #1; see §3.4).

### 3.3 Validation (`add`)

`gsc pi sessions inbox add --code <c>` succeeds only if the artifact exists and: `consumer == "gsc"`, `purpose == "inbox"`, `status == "pending"`, `expiresAt` in the future. Read-only; never mutates the artifact.

### 3.4 Health payload + GSC_HOME (no user-supplied code)

The backend derives health from `gsc pi sessions inbox code status --format json` against its own GSC_HOME:

```json
{ "status": "missing" | "valid" | "expired" | "unknown",
  "code": "…", "expires_at": "…", "gsc_home": "…" }
```

The `inbox_code` payload rides the **get-sessions** response:

```json
"inbox_code": {
  "status": "missing" | "valid" | "expired" | "unknown",
  "expires_at": "…",
  "gsc_home": "/absolute/path/of/this/servers/GSC_HOME"
}
```

Status semantics:

| Status | Meaning |
|---|---|
| `missing` | No inbox artifact on this store |
| `valid` | Artifact found, `consumer gsc`, `purpose inbox`, `pending`, not expired |
| `expired` | Artifact found but `expiresAt` passed |
| `unknown` | Code file(s) exist but none parse as a valid inbox artifact |

There is **no user-supplied code** anymore — the frontend never stores or sends one, so there is nothing to be "unknown" about from the client side. `gsc_home` stays in the payload so a TUI/chat GSC_HOME mismatch is diagnosable (the extension already warns on it, §3).

### 3.5 Health placement (clarification #2 — resolved)

**get-sessions only for v1; the mailbox batch / SSE loop does NOT carry `inbox_code`.** Rationale: health changes are rare (generate/delete/90-day expiry); get-sessions refreshes on list load; the authoritative backstop is the server-side `add --code` validation at send time; the frontend re-checks health on demand (compose open, or after a rejected send returns a structured error). Live flip on mid-session delete is a documented deferred nicety, not v1.

### 3.6 Frontend gating & warnings

Derived from `inbox_code.status` + `expires_at` (days-remaining computed client-side). No input field, no localStorage — the backend checks the store itself:

- `missing` / `unknown` → **send disabled** + banner: *"Run `/brains inbox code generate` in the Pi TUI to enable sending."*
- `valid` → send enabled; **escalating warnings, one shown (most urgent)**:
  - ≤30 days → *"Inbox code expires in 30 days — run `/brains inbox code generate` to reset to 90 days."*
  - ≤15 days → same, "15 days".
  - ≤1 day → *"Inbox code expires tomorrow — run `/brains inbox code generate` now to reset to 90 days."*
- `expired` → send disabled + *"Inbox code expired — run `/brains inbox code generate` to generate a new one."*
- Regenerate replaces the artifact; the next health check reflects it immediately.

### 3.7 Backend transport (no client-side code)

- The frontend never sees, stores, or sends the code.
- Health: backend runs `gsc pi sessions inbox code status --format json` (or reads `GSC_HOME/data/codes/*.json`) and maps to `inbox_code`.
- On send: backend reads the active code (from `code status --format json`) and passes it to `gsc pi sessions inbox add --code <c>`. A rare status→send race (code deleted/regenerated in between) surfaces as a rejected `add`; the backend re-checks health and the frontend re-enables once a valid code exists.

## 4. Data contracts (verbatim shapes)

### 4.1 Summary — `gsc pi sessions inbox summary --session-id <id>` (primary data source)

```json
{
  "session_id": "…",
  "mailbox": {
    "inbound":  { "pending": 1, "delivering": 0, "accepted": 3, "ignored": 0, "expired": 0 },
    "outbound": { "sent": 3, "replied": 1, "awaiting": 2, "expired": 0, "rejected": 0 }
  },
  "wait_groups": [
    { "id": "…", "expected": 2, "received": 1, "status": "waiting", "deadline": "…" }
  ]
}
```

`inbound.pending` = unread and **includes human mail** (the permanent mail row). `outbound.replied` = "finished"; `awaiting` = wait-group attached, reply not yet received; `rejected` = failed attempts (show in thread view).

### 4.2 Message record — `show` / `list` (render badges from `envelope` only)

```json
{
  "schema_version": 2,
  "origin": "agent",
  "session_id": "…",
  "message_id": "…",
  "status": "pending",
  "created_at": "…",
  "updated_at": "…",
  "body": "content",
  "message": "content",
  "envelope": {
    "version": 1,
    "thread_id": "<root message id>",
    "sender_session_id": "<from>",
    "reply_to_message_id": "<parent id | null>",
    "hop": 2,
    "max_hops": 5,
    "path": [ { "message_id": "…", "from": "…", "to": "…" } ],
    "expires_at": "…",
    "idempotency_key": "…"
  }
}
```

## 5. Design constraints

- `summary.wait_groups[].status` is **display-only** — can show an effective `timed_out` before `wait status` persists it. Render as a badge; never drive logic from it.
- Envelope is constructed by gsc; the readable header is rendered at fetch/delivery time, never stored as text. Chat renders its own badges — never parse peer text as state.
- Terminal records preserve `delivery_id` — `status` is authoritative; don't treat its presence as "still delivering".
- `origin: "human"` = Chat (no envelope); `origin: "agent"` = peer. Peer content is untrusted delegated input — show as data, not instructions.

## 6. Implementation status & order

**Done by the Chat agent so far**: backend `getPiSessionMailboxBatch` + SSE piggyback (fingerprint-change pushes only); get-pi-sessions hydration consolidating mailbox onto each session (`session.mailbox` counts + `session.wait_groups`, one atomic request; list-all path pays nothing); reusable `InboxChip` component (outline = idle / filled = attention; wait-group chips; copyable "Mailbox ID"); TrackerView hydration + stream + copy.

**Remaining (in order)**:
1. Backend health (`inbox_code` on get-sessions, derived from `code status --format json`) + `--code` passthrough on the message post (backend reads the active code; no client-side code).
2. Frontend banner / send-gating / warnings (§3.6) — no input field, no localStorage.
3. Groups-page mail rows + exact-id compose polling + copyable UUIDs (display work).

**Deferred (noted)**: live health flip on mid-session code delete; mailbox-batch `inbox_code`.

## 7. Suggested first steps

1. Read spec §10–§12, §16 + this doc; read `getPiSessionInboxBatch` + compose flow in `backend/index.js` / `MessagePane.js`.
2. Build `/tmp/gsc-test` from `~/gsc-cli`; scratch `GSC_HOME`; exercise `summary` / `show` / `list` and `inbox code generate` / `add --code` directly before wiring UI.
3. Implement in the §6 order.
