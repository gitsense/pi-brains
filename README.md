<p align="center">
  <img src="assets/pi-brains-logo.png" alt="pi-brains logo" width="600">
</p>

<h3 align="center">
  Give Pi the ability to remember and work with other agents.
</h3>

<p align="center">
  <a href="#gitsense-chat-puts-your-pi-agents-in-one-place">See it in Chat</a> &nbsp;·&nbsp;
  <a href="#install">Install</a> &nbsp;·&nbsp;
  <a href="#every-pi-session-has-an-inbox">Inbox</a> &nbsp;·&nbsp;
  <a href="#teach-pi-what-to-remember-and-how-to-behave">Teach Pi</a> &nbsp;·&nbsp;
  <a href="#try-it-yourself">Try it yourself</a>
</p>

**pi-brains** connects [Pi](https://github.com/earendil-works/pi) to
[GitSense Chat](https://github.com/gitsense/chat). Install it once, and each Pi
session becomes visible in Chat, reachable from any other agent through its own
inbox, and able to carry knowledge across sessions with GitSense records.

Your Pi sessions keep doing the work in the terminal. pi-brains adds what sits
around them: a mailbox other agents can message, heartbeats so GitSense Chat
can show which sessions are alive, and the records and rules that keep useful
knowledge between conversations.

## GitSense Chat puts your Pi agents in one place

pi-brains is what makes a Pi session a citizen of GitSense Chat. Sessions that
run with pi-brains appear in Chat, where you can organize related work into
Groups, give a Group a lead agent, and see which sessions are running, stopped,
or ready to receive work, without opening every terminal.

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <p align="center"><strong>Organize your sessions</strong></p>
      <p align="center"><img src="assets/demo/gitsense-organize-sessions-placeholder.svg" alt="Placeholder showing Pi sessions organized in GitSense Chat" width="100%"></p>
    </td>
    <td width="50%" valign="top">
      <p align="center"><strong>Give agents a lead</strong></p>
      <p align="center"><img src="assets/demo/gitsense-give-agents-a-lead-placeholder.svg" alt="Placeholder showing a lead coordinating agents in GitSense Chat" width="100%"></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <p align="center"><strong>Monitor work at a glance</strong></p>
      <p align="center"><img src="assets/demo/gitsense-monitor-work-placeholder.svg" alt="Placeholder showing the status of many live Pi sessions" width="100%"></p>
    </td>
    <td width="50%" valign="top">
      <p align="center"><strong>Build knowledge teams</strong></p>
      <p align="center"><img src="assets/demo/gitsense-build-knowledge-teams-placeholder.svg" alt="Placeholder showing a group of specialized knowledge agents" width="100%"></p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <p align="center"><strong>Bring results together</strong></p>
      <p align="center"><img src="assets/demo/gitsense-bring-results-together-placeholder.svg" alt="Placeholder showing a lead bringing together results from focused agents" width="100%"></p>
    </td>
    <td width="50%" valign="top">
      <p align="center"><strong>Turn reports into actions</strong></p>
      <p align="center"><img src="assets/demo/gitsense-turn-reports-into-actions-placeholder.svg" alt="Placeholder showing a report with clickable actions" width="100%"></p>
    </td>
  </tr>
</table>

Lead agents can review existing evidence without interrupting working members.
Creating or starting agents requires your explicit direction, and executable
actions remain subject to application authorization and command validation.

Pi currently powers Chat's session and Group integration. Other harnesses can
access shared knowledge and consult Pi agents through `gsc`; this does not
imply integration of their session logs or lifecycle state.

**[See GitSense Chat demos and workflows →](https://github.com/gitsense/chat)**

## Every Pi session has an inbox

The most direct thing pi-brains gives each session is an inbox. Run
`/brains me` in Pi to copy the session's mailbox address, then any agent that
can run `gsc` can ask it a question, send it context, or delegate a task.

<p align="center">
  <img src="assets/demo/work-with-any-agent-placeholder.svg" alt="Placeholder for a terminal demo showing Claude Code, Codex, and OpenCode initiating requests to a Pi session" width="100%">
</p>

The recipient answers from its own tools and session history, so you can
consult a session that already knows the work instead of always starting a
fresh worker. Claude Code, Codex, OpenCode, and other agents can reach it with
`gsc ask`, send it a one-way notice with `gsc inform`, or message it directly.

### Try an exchange

1. In a fresh Pi session, assign a role before starting a conversation:

   ```text
   /brains role Explain this repository's architecture. Answer questions using repository evidence; do not modify files.
   ```

2. After Pi acknowledges the role, use `/brains me` to copy its mailbox
   address. Keep the recipient session running with pi-brains loaded.
3. In Claude Code, Codex, OpenCode, or another coding agent, ask:

   ```text
   Ask the Pi agent at <paste-mailbox-UUID> which components handle authentication
   and what evidence supports its answer. Start by running `gsc experts guide ask`,
   then use `gsc ask` with a five-minute timeout. Do not modify files.
   ```

The caller receives Pi's reply through `gsc ask`, or a timeout if no answer
arrives. You can also share the address of an existing session without
assigning a new role; `/brains role` is for fresh sessions only.

Agent messages generate notifications automatically in TUI mode. Pi then
fetches and processes them one at a time. `/brains inbox auto on` is a separate
setting for automatically accepting **human-originated GitSense Chat messages**;
it is not required for agent-message notifications.

Messages are delegated input, not authority overrides. Review important
findings before acting, and share only context the recipient is allowed to see.

## Install

Requires **Node.js 22.19.0 or newer**, **Pi 0.81.1 or newer**, and the
[GitSense (`gsc`) CLI](https://github.com/gitsense/gsc-cli).

```bash
pi install npm:@gitsense/pi-brains
```

Start Pi in a workspace and run:

```text
/brains
```

If [GitSense (`gsc`)](https://github.com/gitsense/gsc-cli) is not installed, `/brains` will show install instructions.

## Teach Pi what to remember and how to behave

1. **You teach:** Ask Pi to record useful findings, rules to follow, mistakes to avoid, or context to retrieve.
2. **It records:** Pi uses GitSense to save focused records in personal or repository scope, with file and topic associations where supported. Not every conversation is automatically turned into knowledge.
3. **It applies:** Agents retrieve relevant records, while pi-brains evaluates enabled rules at supported lifecycle events, such as before a tool call or after a tool result.

For example, ask Pi:

```text
Create a repository rule that blocks edits under src/auth/ until the agent
has read docs/security.md in the current session. Load the GitSense rule
authoring guides first, and show me how to test the rule.
```

Once authored and enabled, that rule can stop an edit before it happens and
explain what context is missing. Other rules can deliver relevant context,
remind Pi to verify a result, or run checks around tool actions.

pi-brains complements hooks, Markdown instructions, and search. Pi still
verifies important findings against source; it gets a better starting point
instead of having to rediscover every convention in each conversation.

### Configure rules

Pi Brains includes an opt-in [rule catalog](rules/README.md). Package
installation does not activate these policies automatically. Users can review
each bundle and import it into either personal scope for cross-repository
behavior or repository scope for project-shared behavior.

The first included pack guides supported shell discovery commands through
`gsc bash`, producing structured evidence that can be correlated with the Pi
session. It offers advisory and strict modes. See the
[observable shell discovery instructions](rules/gsc-bash-observability/README.md)
for review, installation, switching, and removal commands.

Start the interactive configuration from Pi:

```text
/brains rules shell
```

## Preserve a handoff with checkpoints

Run `/brains checkpoint` at a meaningful boundary to capture what Pi
understands, the decisions it made, risks, and next steps. Generation happens
on a scratch conversation branch, and the extension verifies that the record
was persisted before offering to return you to the original branch.

Other agents can retrieve that compact handoff without reading the entire
conversation. A checkpoint records reported understanding, not proof that the
work is correct or still current.

Need to preserve file contents too? `/brains snapshots create` captures the
exact recognized file contents at the current session leaf. Checkpoints
preserve understanding; snapshots preserve file state. See the
[snapshot details](#session-snapshots) for coverage and exclusions.

## Try It Yourself

These repos are already set up so you can see how pi-brains works.

### Rules Demo - [`gsc-rules-demos`](https://github.com/gitsense/gsc-rules-demos)

Use this repo to see how project knowledge and agent behavior can ship with code.

```bash
git clone https://github.com/gitsense/gsc-rules-demos.git
cd gsc-rules-demos
pi install npm:@gitsense/pi-brains
pi
```

Then run `/brains` and ask Pi:

```text
/brains
What rules are shipped with this repository?
```

Pi will walk you through the demo rules, notes, lessons, and triggers included in the repo.

- **Quick examples to try:** See the [gsc-rules-demos README](https://github.com/gitsense/gsc-rules-demos#try-the-examples) for prompts you can copy and paste.
- **Detailed walkthrough:** See the [Pi Hands-On Guide](https://github.com/gitsense/gsc-rules-demos/blob/main/docs/pi/hands-on.md) for setup notes and expected behavior.

**What you'll learn:** rules can change how Pi behaves before it acts, notes can teach project-specific context, lessons can carry previous work into future sessions, and triggers can warn, block, or run checks around tool actions.

### Knowledge Demo - [`gitsense/pi`](https://github.com/gitsense/pi)

Use the GitSense Pi fork to try repository intelligence for Pi itself.

```bash
git clone https://github.com/gitsense/pi.git
cd pi
pi install npm:@gitsense/pi-brains
pi
```

Build the included Brains:

```text
/brains build
```

Then ask Pi to use those Brains before it plans a change:

```text
I want to build a Pi extension. Before reading code, use the brains in this repo to find the docs, APIs, gotchas, and examples I should know about.
```

**What you'll learn:** Brains index repository knowledge so Pi can ask what is already known before spending context on source files.

| Brain | What Pi learns before opening files |
| --- | --- |
| Docs | Which guide, section, or reference doc to read |
| Code intent | Which files likely matter and why |
| Dependency maps | Which files have high blast radius |
| Implicit todos | Hidden debt, stubs, workarounds, or cleanup candidates |
| Rules | What behavior must be followed |
| Lessons | What previous work taught the team |

For example, a broad request like this:

```text
I want to improve search. Before deciding what to change, use the brains in this repo to identify any gotchas, then verify the important findings against source.
```

can become a focused plan:

- "Search" may mean TUI fuzzy matching, autocomplete, session search, model filtering, or agent grep/find tools.
- `packages/tui/src/fuzzy.ts` may be shared infrastructure with high blast radius.
- Agent `grep.ts` and `find.ts` may be separate from TUI search.
- A Brain may surface hidden maintenance work, such as an incomplete stub or deprecated compatibility path.
- Pi can verify the relevant findings against source before proposing a plan.

Grep finds text. Vector search finds similar passages. Brains give Pi structured, queryable knowledge it can use to decide where to spend context.

## Essential commands

| Command | Description |
| --- | --- |
| `/brains` | Initialize Pi Brains |
| `/brains me` | Show and copy the current agent's address |
| `/brains inbox` | Review messages from people and other agents |
| `/brains inbox auto on` | Automatically accept human-originated Chat messages |
| `/brains role <description>` | Assign a worker role in a fresh session |
| `/brains sessions` | Open the GitSense Chat view for all Pi sessions |
| `/brains search` | Open GitSense Chat search across Pi sessions |
| `/brains rules` | Show rule status and configuration options |
| `/brains checkpoint` | Record understanding, decisions, risks, and next steps |

Run `/brains help` inside Pi to discover additional commands.

<details>
<summary>Additional command reference and snapshot details</summary>

### Additional commands

| Command | Description |
| --- | --- |
| `/brains` | Initialize GitSense expert context |
| `/brains build` | Build/import all local Brain manifests from `.gitsense/manifests` |
| `/brains build <brain-name>` | Build/import one local Brain manifest |
| `/brains build <manifest-path-or-url>` | Build/import a Brain from a path or URL |
| `/brains build --force` | Rebuild Brain manifests even if cached data exists |
| `/brains build help` | Show Brain build help and current Brain status |
| `/brains insights` | Show a static inspect snapshot |
| `/brains rules` | Show rule status and options |
| `/brains rules on` | Enable rules checking |
| `/brains rules off` | Disable rules checking |
| `/brains rules status` | Show recent rule decisions |
| `/brains rules shell` | Configure observable shell discovery rules |
| `/brains rules shell status` | Show personal and repository shell-rule modes |
| `/brains about` | Show what GitSense can do |
| `/brains debug` | Toggle debug logging |
| `/brains debug on` | Enable debug logging |
| `/brains debug off` | Disable debug logging |
| `/brains debug file` | Show the debug log file path |
| `/brains checkpoint` | Create a review checkpoint |
| `/brains checkpoint exit` | Return from the checkpoint branch |
| `/brains role <description>` | Assign a worker role in a fresh session |
| `/brains checkpoint suggest on` | Enable checkpoint suggestions |
| `/brains checkpoint suggest off` | Disable checkpoint suggestions |
| `/brains checkpoint suggest status` | Show checkpoint suggestion status |
| `/brains snapshots` | Show snapshot status for the current session |
| `/brains snapshots insights on` | Enable deterministic user-facing snapshot insights for this session |
| `/brains snapshots insights off` | Disable snapshot insights for this session |
| `/brains snapshots insights status` | Show whether snapshot insights are enabled for this session |
| `/brains snapshots review` | Review snapshot, mutation, and shell-coverage facts without creating a snapshot |
| `/brains snapshots list` | List each stage's directory, manifest, Git object database, and commit |
| `/brains snapshots create` | Capture the exact recognized file contents at the current session leaf |
| `/brains snapshots clear` | Move the current session's snapshots to a recoverable archive |
| `/brains forget` | Prune entries after the current `/tree` position (with backup) |
| `/brains summary` | Generate a session summary as the final message |
| `/brains inspect` | Show inspect view instructions |
| `/brains me` | Show and copy this agent's session ID, process ID, and inbox auto-accept status |
| `/brains inbox` | Review pending messages in the session inbox |
| `/brains inbox list` | List all messages in the session inbox |
| `/brains inbox info` | Show the mailbox address, message summary, and wait-group progress |
| `/brains inbox clear` | Dismiss rejected outbound sends |
| `/brains inbox code generate` | Generate a 90-day Chat inbox code and enable Chat sending |
| `/brains inbox code delete` | Revoke the Chat inbox code and disable Chat sending |
| `/brains inbox code status` | Show the current Chat inbox code status |
| `/brains inbox status` | Show the current auto-accept setting |
| `/brains inbox auto` | Show or configure automatic inbox acceptance |
| `/brains inbox auto on` | Automatically accept human-originated Chat messages |
| `/brains inbox auto off` | Disable automatic inbox acceptance |
| `/brains inbox auto status` | Show automatic inbox acceptance status |
| `/brains inbox help` | Show inbox commands and current settings |
| `/brains dismiss` | Dismiss the GitSense unavailable notice |
| `/brains help` | Show available commands |

### Session snapshots

Session snapshots preserve the exact contents of files recognized from session
activity, including files outside a Git repository. Run `/brains snapshots
create` before a broad change or after a verified milestone. If the recognized
file tree has not changed, GitSense reuses the latest stage instead of creating
a duplicate. Run `/brains snapshots list` to see the filesystem location of
every stage and manifest, plus the shared Git object database and commit IDs.

Snapshot insights are off by default and scoped to the current session. Enable
them with `/brains snapshots insights on`. Pi Brains then shows deterministic,
user-facing facts before the first direct mutation and warns once when shell
activity makes file coverage uncertain. It does not inject agent instructions
or create snapshots automatically. Run `/brains snapshots review` at any time
to inspect the current baseline, recognized direct-tool files, direct mutations
since the baseline, and shell-coverage status.

Snapshots may include recognized files outside the working repository. Common
credential paths and `.env`/private-key files are excluded. The defaults also
exclude files over 64 MiB and cap each stage at 256 MiB. `clear` asks for
confirmation and moves data under `GSC_HOME/data/pi/snapshot-trash` rather than
deleting it immediately.

</details>

## Session liveness

In TUI mode, pi-brains records a heartbeat every 10 seconds so GitSense Chat
can surface session availability without opening every terminal. A fresh
heartbeat indicates that the session is alive, not that its work is correct
or complete. A missing or stale heartbeat means availability is uncertain;
it is not proof that the process stopped or permission to restart it.

The inbox auto-accept setting concerns human-originated Chat messages, not
whether an agent is idle or ready for another task. See
[heartbeat implementation details](docs/session-liveness.md) for storage,
shutdown behavior, and lookup APIs.

## Current Boundaries

- File tracking is exact for structured `read`, `edit`, and `write` tools.
- Arbitrary shell file activity may be missing.
- Brain analysis and cross-session history require GitSense integration.
- Brains are guidance, not a replacement for source verification.
- Liveness is advertised by the extension heartbeat store; a Pi session without pi-brains loaded writes no heartbeat.

## Development

```bash
npm install
npm run check
npm test

# Regenerate portable observable-shell rule bundles after editing their triggers
npm run rules:build
```

To try local changes in Pi, install this package from your checkout:

```bash
pi install /path/to/pi-brains
pi
```

Then run:

```text
/brains
```

## License

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for
attribution notices.
