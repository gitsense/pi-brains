# Session liveness implementation

pi-brains records liveness while a Pi session runs in TUI mode. The heartbeat
implementation is in [`heartbeat.ts`](../extensions/pi-brains/heartbeat.ts);
startup, shutdown, and inbox-setting wiring are in
[`index.ts`](../extensions/pi-brains/index.ts).

## Storage

The shared SQLite store is:

```text
GSC_HOME/data/pi/pi-heartbeats.sqlite3
```

The `heartbeats` table has one row per session:

| Column | Meaning |
| --- | --- |
| `session_id` | Primary key identifying the Pi session |
| `pid` | Process ID |
| `cwd` | Working directory |
| `started_at` | Start timestamp |
| `status` | `alive` or `stopped` |
| `last_heartbeat_at` | Last heartbeat in epoch milliseconds |
| `runtime` | `tmux` or `terminal` |
| `auto_accept` | Whether human-originated Chat mail is automatically accepted |

The extension writes every 10 seconds by default. Writes are upserts with WAL
and a busy timeout so concurrent Pi sessions share the store safely. The
`(status, last_heartbeat_at)` index supports recent-session lookups. Rows idle
for more than 30 days are pruned on each write.

## Interpretation

- A fresh heartbeat with `status = 'alive'` indicates a live session. It does
  not establish progress, correctness, or readiness for another task.
- On clean shutdown, the extension marks the row `stopped`.
- A crash can leave the last `alive` row stale. Missing or stale rows alone do
  not prove the process stopped; consumers should report uncertain availability
  and check runtime evidence rather than automatically launching another agent.
- A Pi session without pi-brains loaded writes no heartbeat. The heartbeat and
  inbox watcher are inactive outside TUI mode.
- Runtime is informational: a detached tmux-hosted Pi process can remain alive
  and messageable.
- `auto_accept = 0` does not disable agent-message notifications. It means
  human-originated Chat messages are not automatically accepted. Changing the
  setting refreshes the heartbeat immediately.

## Lookup APIs

`heartbeat.ts` exports:

- `getAliveHeartbeatSessionIds(dbPath, withinMs)` — recently alive session IDs.
- `getHeartbeatRecordsForSessions(dbPath, sessionIds)` — heartbeat records for
  a selected set of sessions.

These functions expose observations. Starting or resuming an agent remains a
separate operation requiring user direction.
