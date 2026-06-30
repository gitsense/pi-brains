<p align="center">
  <img src="assets/pi-brains-logo.png" alt="pi-brains logo" width="600">
</p>

<h3 align="center">
  Teach Pi what to remember and how to behave.
</h3>

pi-brains is a scalable way to teach [Pi](https://github.com/earendil-works/pi) what to remember and how to behave while it works.

It connects Pi to GitSense Brains, rules, notes, and lessons, so Pi can use what you and your team already know before it starts guessing. That knowledge can include personal preferences, project conventions, domain context, prior lessons, and knowledge extracted from the repo.

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

## Quick Start

Use chat as the interface. You should not need to write rule files or run `gsc` commands for normal use.

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

### Protect Generated Files

Turn a project convention into behavior Pi applies before it edits.

```text
Add a repo rule for src/generated/**. When editing those files, warn that generated files should not be edited directly and tell Pi to edit the source schema instead.
```

### Remember Project Lessons

Capture what you and others learned so future agents start with that context.

```text
Save this as a repo lesson: checkout discount behavior is split between src/checkout/pricing.ts and src/checkout/rules.ts. Future discount changes should inspect both files before editing.
```

## Give Pi a Better Starting Point

GitSense makes it simple to capture and store knowledge: rules, notes, lessons, topics, and Brains. pi-brains makes it simple for Pi to use that knowledge while it works.

Instead of starting with blind grep and file loading, Pi can ask what is already known first.

## Pi + Brains

Brains make structured knowledge available to Pi before it starts opening files.

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

## What Pi Can Remember

| Knowledge | Example |
| --- | --- |
| Personal behavior | "Do not edit files until I approve the plan." |
| Project conventions | "Generated files should be changed through schemas." |
| Domain context | "Ledger files are pipe-delimited accounting data." |
| File-specific context | "This file mixes billing totals and CSV export formatting." |
| Lessons | "This refactor failed before because logic is split across two files." |
| Brains | "Find gotchas, blast radius, hidden debt, or relevant files before planning." |
| Triggers | "Block production config edits unless approval is present." |

## What Makes pi-brains Different

Hooks are good at reacting to events. Markdown files are good for a small amount of shared guidance. pi-brains is different because knowledge stays scoped, searchable, and durable as it grows.

- **Knowledge stays queryable.** Pi can search Brains, rules, notes, and lessons instead of reading one long instruction file.
- **Behavior can be taught in chat.** Tell Pi what to remember or enforce, and it can turn that into durable knowledge.
- **Context is scoped.** Save knowledge as personal, project, file-specific, topic-specific, or trigger-backed.
- **Lessons survive sessions.** Capture what went wrong once so future agents start smarter.
- **Rules do not become one giant markdown file.** Store focused records that can be matched, updated, disabled, or deleted.

## Commands

| Command | Description |
| --- | --- |
| `/brains` | Initialize GitSense context and show the HUD |
| `/brains build <brain-name>` | Build/import a Brain manifest |
| `/brains insights` | Show session status and brain data |
| `/brains rules` | Show rule status and options |
| `/brains rules on` | Enable rules checking |
| `/brains rules off` | Disable rules checking |
| `/brains rules status` | Show recent rule decisions |
| `/brains about` | Show what GitSense can do |
| `/brains debug` | Toggle debug logging |
| `/brains help` | Show available commands |

## Documentation

- [Tutorial](TUTORIAL.md): chat-first examples for creating rules, notes, lessons, and triggers.
- [Technical reference](TECHNICAL.md): command details, trigger fields, lifecycle events, and configuration.

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
