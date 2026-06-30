<p align="center">
  <img src="assets/pi-brains-logo.png" alt="pi-brains logo" width="600">
</p>

<h3 align="center">
  Teach Pi what to remember and how to behave.
</h3>

pi-brains lets you teach [Pi](https://github.com/earendil-works/pi) by chatting with it.

Tell Pi what to remember, how to behave, or what to check before it acts. pi-brains turns that into scoped, durable knowledge Pi can search and use while it works.

It connects Pi to GitSense Brains, rules, notes, and lessons, so Pi can use what you and others already know before it starts guessing. That knowledge can include personal preferences, project conventions, domain context, prior lessons, and knowledge extracted from the repo.

This is not one giant markdown file. Knowledge is stored as scoped, queryable records that Pi can search and apply when they matter. Pi can think before it pays the cost of opening files, verify before it acts, and carry knowledge across sessions instead of rediscovering it every time.

## Install

```bash
pi install npm:@gitsense/pi-brains
```

Start Pi in a workspace and run:

```text
/brains
```

If GitSense (`gsc`) is not installed, `/brains` will show install instructions.

## What Pi Can Remember

pi-brains gives Pi scoped knowledge it can search, connect to the task, and use while it works.

| Knowledge | Example |
| --- | --- |
| Personal behavior | "Do not edit files until I approve the plan." |
| Project conventions | "Generated files should be changed through schemas." |
| Domain context | "Ledger files are pipe-delimited accounting data." |
| File-specific context | "This file mixes billing totals and CSV export formatting." |
| Lessons | "This refactor failed before because logic is split across two files." |
| Brains | "Find gotchas, blast radius, hidden debt, or relevant files before planning." |
| Triggers | "Block production config edits unless approval is present." |

## Start With Rules

Rules are the easiest way to teach Pi new behavior. Tell Pi what should happen, and pi-brains can turn that into durable behavior for future sessions.

### Catch Habit Commands

Teach Pi to recognize accidental terminal habits before they become chat messages.

```text
I often type ls, clear, and pwd out of habit. Add a personal rule so those prompts are treated as terminal habits and are not sent into the conversation.
```

### Ask Before Editing

Make approval part of Pi's default behavior instead of repeating it every session.

```text
Add a personal rule: do not write or edit files until I explicitly say to make the change. You can inspect files and propose a plan first.
```

Rules are only the starting point. You can also teach Pi to:

- remember project-specific file formats
- look up notes before interpreting unfamiliar files
- apply lessons from previous work
- warn before high-risk edits
- run triggers when a tool action needs a guardrail

The demo repo shows these pieces working together.

## See Rules In Action

The demo repo ships with rules, notes, lessons, and triggers you can try immediately.

```bash
git clone https://github.com/gitsense/gsc-rules-demos.git
cd gsc-rules-demos
pi install npm:@gitsense/pi-brains
pi
```

Then ask Pi:

```text
Show me what pi-brains can do in this repo.
```

## Give Pi a Better Starting Point

GitSense makes it simple to capture and store knowledge: rules, notes, lessons, topics, and Brains. pi-brains makes it simple for Pi to use that knowledge while it works.

Instead of starting with blind grep and file loading, Pi can ask what is already known first.

## Pi + Brains

Brains make structured knowledge available to Pi before it starts opening files.

### Try Pi With Brains

The [GitSense Pi fork](https://github.com/gitsense/pi) ships with Brain manifests for Pi itself:

```bash
git clone https://github.com/gitsense/pi.git
cd pi
pi install npm:@gitsense/pi-brains
```

From a Pi session inside the cloned repo, build the Brains:

```text
/brains build
```

Pi can then use its own docs, code intent, dependency map, and implicit todos before it starts opening files.

Ask Pi:

```text
I want to build a Pi extension. Before reading code, use the brains in this repo to find the docs, APIs, gotchas, and examples I should know about.
```

Pi can combine different kinds of knowledge:

| Brain | What Pi learns before spending context |
| --- | --- |
| Docs | Which guide, section, or reference doc to read |
| Code intent | Which files likely matter and why |
| Dependency maps | Which files have high blast radius |
| Implicit todos | Hidden debt, stubs, workarounds, or cleanup candidates |
| Rules | What behavior must be followed |
| Lessons | What previous work taught the team |

Then Pi can verify the important findings against source before it acts.

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

The point is not that Pi never reads code. The point is that Pi gets a better first pass before it spends context on the wrong files. Grep finds text. Vector search finds similar passages. Brains give Pi structured, queryable knowledge it can use to decide where to spend context.

## What Makes pi-brains Different

Hooks are good at reacting to events. Markdown files are good for a small amount of shared guidance. pi-brains is different because knowledge stays scoped, searchable, and durable as it grows.

- **Knowledge stays queryable.** Pi can search Brains, rules, notes, and lessons by scope, summaries, topics, and tags, so it can pull in the relevant knowledge when it matters.
- **Behavior can be taught in chat.** Tell Pi what to remember or enforce, and it can turn that into durable knowledge.
- **Context is scoped.** Save knowledge as personal, project, file-specific, topic-specific, or trigger-backed.
- **Lessons survive sessions.** Capture what went wrong once so future agents start smarter.
- **Rules stay manageable.** Store focused records that can be matched by scope, updated, disabled, deleted, or applied only when they are relevant.

## Commands

| Command | Description |
| --- | --- |
| `/brains` | Initialize GitSense context and show the HUD |
| `/brains build` | Build/import all local Brain manifests |
| `/brains build <brain-name>` | Build/import one Brain manifest |
| `/brains insights` | Show session status and brain data |
| `/brains rules` | Show rule status and options |
| `/brains rules on` | Enable rules checking |
| `/brains rules off` | Disable rules checking |
| `/brains rules status` | Show recent rule decisions |
| `/brains about` | Show what GitSense can do |
| `/brains debug` | Toggle debug logging |
| `/brains help` | Show available commands |

## Demo Repository

Use [gitsense/gsc-rules-demos](https://github.com/gitsense/gsc-rules-demos) to see the chat-first workflow for creating rules, notes, lessons, and triggers.

## Current Boundaries

- File tracking is exact for structured `read`, `edit`, and `write` tools.
- Arbitrary shell file activity may be missing.
- Brain analysis and cross-session history require GitSense integration.
- Brains are guidance, not a replacement for source verification.

## Development

```bash
npm run check
npm test
```

## License

MIT
