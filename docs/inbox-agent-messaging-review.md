# Design Review Request: Agent-to-Agent Messaging with Loop Protection

> **Status: SUPERSEDED.** This was the original design-review prompt. The design
> was reviewed, iterated, and settled — see
> [**`inbox-agent-messaging-v1.md`**](./inbox-agent-messaging-v1.md) for the
> current v1 spec (schema v2 envelope, send/reply boundary, wait groups,
> notification policy, mailbox summary/UI).
> This file is kept as review history only.

You are a senior systems engineer doing a **design review**. You may read code to
verify claims, but **do not modify any files**. Report findings, risks, and
recommendations. If a design decision is wrong, say so and propose the fix.

---

## 1. Project context

**pi-brains** is an extension for the **Pi coding agent** (TUI-based terminal
assistant). It provides GitSense integration: rules, brains (queryable code
metadata), checkpoints, and — the part relevant here — a **session inbox**.

Each running Pi session has a **mailbox** identified by its session UUID
(canonical UUID, e.g. `2f9c...`). Today, only a **human** writes to a mailbox,
from **GitSense Chat** (a web UI companion). The goal of this design is to let
**Pi agents send messages to each other** — a user tells agent A "send a message
to agent B" and A delivers it to B's mailbox; optionally the user asks for a
message back when done.

### Repositories

- `~/pi-brains` — the Pi extension (TypeScript). Key file: `extensions/pi-brains/inbox.ts`.
- `~/gsc-cli` — the GitSense CLI (Go). Key files:
  - `internal/pi/sessions/inbox.go` — `InboxStore` (storage + transitions)
  - `internal/cli/pi/sessions/inbox.go` — `gsc pi sessions inbox ...` commands
- `~/gitsense-chat` — the Chat web app. Key files:
  - `packages/chat/widgets/app/components/pi/backend/index.js` — `addInboxMessage`
  - `packages/chat/widgets/app/components/pi/sessions/MessagePane.js` — compose UI

---

## 2. Current inbox architecture (as built)

**Storage.** One JSON file per message:
`~/.gitsense/data/pi/sessions/<session-uuid>/inbox/<message-uuid>.json`.

```json
{
  "schema_version": 1,
  "session_id": "…",         // recipient session UUID
  "message_id": "…",         // gsc-generated UUID
  "status": "pending",       // pending | delivering | accepted | ignored
  "created_at": "…",
  "updated_at": "…",
  "message": "free text",    // <-- only field carrying content
  "delivery_id": "…"         // set while status=delivering
}
```

Status lifecycle: `pending → delivering → accepted|ignored` via
`claim` / `complete` / `release` / `ignore` (5-minute delivery lease).

**Write path (single entry point).** Any process can add a message:

```bash
gsc pi sessions inbox add --session-id <recipient-uuid> --message-file <file|-> 
```

The message is stored with status `pending`. There is currently **no sender
field, no envelope, no header, and no loop concept** — the message is raw text.

**Delivery (TUI side, pi-brains).** `startInboxWatcher` in `inbox.ts` polls
`gsc pi sessions inbox poll --session-id <id>` every 2s (returns ids only, no
text). If auto-accept is ON: `claim` → `controller.sendUserMessage(claim.message)`
→ `complete` (or `release` on failure). If OFF: the user is notified and reviews
manually via `/brains inbox` (select → Accept and send / Ignore).

**Compose (Chat side).** `MessagePane._sendCompose` → `addPiInboxMessage(widget,
"pi-<id>", draft)` → backend action `pi-inbox-add` → `gsc pi sessions inbox add
--session-id <uuid> --message-file -`. Chat polls `getPiSessionInboxBatch` until
the message resolves to accepted/ignored, then flashes status.

---

## 3. Proposed design

### 3.1 Goal

- Agents can address each other's mailboxes (session UUIDs) and reply.
- Deterministic loop protection: a message chain (thread) can only progress a
  bounded number of hops; the gsc CLI itself rejects adds that would exceed the
  cap — protection must not depend on LLM discipline.
- The Chat UI can parse message headers deterministically to display loop count.
- `/brains inbox info` tells a user (or agent) this session's mailbox address
  and how to send to it.

### 3.2 Envelope header embedded in message text

To avoid a storage schema migration, the envelope travels at the top of the
`message` text field, separated from the body by a blank line:

```
[gsc-inbox v1]
thread: <root-message-id>
message_id: <this-message-id>
from: <sender-session-uuid>
to: <recipient-session-uuid>
reply_to: <parent-message-id>      # absent on a thread origin
loop: 2
max_loops: 5
hops: 1:<msg-id>,2:<msg-id>,3:<msg-id>

<actual message content...>
```

- `loop` = depth of this message in the chain; the origin message is loop 1.
- `max_loops` = chain cap, set by the origin, inherited unchanged down the chain.
- `hops` = provenance chain, keyed by **message id** (gsc-generated, immutable),
  giving a full audit trail. The UI can map message ids → sessions from the
  inbox list.
- The envelope is **constructed by gsc, never by the agent** — so loop counts
  and provenance cannot be forged or bypassed by an agent writing its own header.

### 3.3 New flags on `gsc pi sessions inbox add`

```bash
# Reply in an existing thread (parent lives in the SENDER's own inbox):
gsc pi sessions inbox add \
  --agent-sender <sender-own-uuid> \
  --session-id <recipient-uuid> \
  --reply-to <parent-message-id> \
  --message-file body.txt

# Thread origin (no parent):
gsc pi sessions inbox add \
  --agent-sender <sender-own-uuid> \
  --session-id <recipient-uuid> \
  --max-loops 5 \
  --message-file body.txt
```

gsc behavior:

1. `--agent-sender` marks the message as agent-originated and supplies the
   **sender identity** gsc needs to locate the parent message in the *sender's*
   own inbox (topology: A→B stores the message in B's inbox; when B replies,
   the parent lives in B's inbox, so gsc must know B's id to find it).
2. For replies: gsc reads the parent, parses its envelope, computes
   `loop = parent.loop + 1`, inherits `max_loops` and `hops`, and **rejects the
   add with a non-zero exit + clear error** if `loop > max_loops`.
3. For origins: `--max-loops` is required and validated against a global hard
   cap from config (proposal: cap 10, default 2).
4. gsc prepends the constructed envelope to the message body before storing.

### 3.4 Enforcement layers (defense in depth)

1. **System-prompt protocol** — pi-brains already injects a static
   `GITSENSE_SYSTEM_PROMPT` at `before_agent_start` (`controller.ts`). Add a
   dynamic block: *"Your mailbox address is `<sessionId>`. To message another
   agent run `gsc pi sessions inbox add --agent-sender <sessionId> --session-id
   <target> ...`. Reply when done if `loop < max_loops`; never reply when
   `loop == max_loops`."* Soft layer — makes the agent want to stop.
2. **Delivery-time reminder** — the watcher in `inbox.ts` parses the envelope
   when claiming/delivering; if `loop == max_loops` it appends a plain-language
   line ("This message is at its loop limit (5/5). Do not reply — gsc will
   reject any reply."). Deterministic, not LLM-dependent.
3. **gsc rejection (backstop)** — `inbox add` returns non-zero with
   `loop limit reached (5/5) for thread <id>`; the replying agent sees the
   error in its bash tool result and stops. Works regardless of LLM behavior.

### 3.5 `/brains inbox info`

New subcommand showing: this session's mailbox address (session UUID), the
protocol summary (how to send to it, how to reply), and current thread state.
Also used to seed the system prompt with the session's own address.

### 3.6 Chat UI display

`backend/index.js` (`summarizeInbox`) and `MessagePane.js` regex-parse the
`[gsc-inbox v1]` block from the message text to render a loop badge
(e.g. `loop 2/5`) and, optionally, the provenance chain. No schema change
required since the envelope rides in the existing `message` field.

### 3.7 Semantics separation

- **Envelope = addressing + loop control** (from/to/reply_to/thread/loop/max/hops).
- **Body = intent** — "reply when done" stays natural language in the body; the
  envelope's `reply_to` is simply the address to reply to.

---

## 4. Design decisions already made

1. Loop protection is critical; the header carries current count + max + provenance.
2. The agent must see the full envelope (it needs loop/max to decide when to stop).
3. Send path is bash: `gsc pi sessions inbox add` with `--agent-sender`.
4. gsc deterministically prevents adds that exceed max loops (requires `--reply-to`).
5. Structured header is required so the Chat UI can parse and display loop state.

---

## 5. Open questions for the reviewer

1. **Envelope format**: `[gsc-inbox v1]` block (above) vs a single-line key=value
   header vs JSON. Trade-offs for: regex-parsing in JS UI, LLM readability,
   forward compatibility (schema v1 → v2), and gsc-side parsing in Go.
2. **Provenance keying**: hops keyed by message id (proposal) vs session id.
   Message ids give an audit trail but require UI mapping to sessions; session
   ids alternate A,B,A,B and carry less information.
3. **Thread origin policy when the parent has no envelope**: if a human Chat
   message (no envelope) is in the agent's inbox and the agent replies to it,
   should that reply (a) start a fresh thread at loop 1, or (b) be rejected?
   Proposal is (a), to keep human↔agent flows working while protecting
   agent↔agent loops. Is (a) safe, or does it let agents bypass loop protection
   by "replying" to envelope-less human messages?
4. **Sender identity verification**: `--agent-sender <uuid>` is self-declared by
   whatever process runs the command. A misbehaving agent could claim to be
   another session. How much does this matter (it's a local multi-agent system,
   not a network service), and is there a cheap, robust way to verify the
   caller's session (e.g. gsc bash session registration already ties a shell
   session to a pi session)?
5. **Loop counting semantics**: origin = loop 1, each agent→agent reply
   increments. Human messages in the middle of a chain don't increment (they
   carry no envelope). Is "loop" the right frame, or should it be "max hops
   including origin" (i.e. max_loops = number of messages allowed in the chain)?
6. **Defaults**: max-loops default 2, hard cap 10. Reasonable? Should the cap be
   per-thread configurable, per-session, or global?
7. **Failure/visibility**: when a reply is rejected at the limit, the *replying*
   agent sees the bash error, but the *user* may not. Should the extension also
   surface a rejection notice (e.g. via the watcher or `/brains inbox list`)?
8. **Loops involving an idle/dead recipient**: a message sits `pending` forever
   if the recipient session is closed or auto-accept is off and the user never
   reviews. Does that break "reply when done" expectations, and should delivery
   carry a TTL/notice?
9. **Anything we missed**: security, correctness, edge cases, simpler
   alternatives, or places where the design contradicts how pi-brains / gsc
   actually work.

---

## 6. How to review

- Read the key files listed in §1 if you need to verify claims.
- Answer the open questions in §5; flag anything in §3 that is unworkable.
- Prioritize: correctness / determinism / security first, UX second.
- End with a short verdict: approve, approve-with-changes, or redesign, and the
  top 3–5 changes you would make.
