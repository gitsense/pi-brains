<p align="center">
  <img src="assets/pi-brains-logo.png" alt="pi-brains logo" width="600">
</p>

<h3 align="center">
  Teach Pi what to remember and how to behave.
</h3>

pi-brains is a scalable knowledge and behavior system for the [Pi](https://github.com/earendil-works/pi) coding agent.

It connects Pi to GitSense Brains, rules, notes, and lessons so Pi can use structured repository knowledge while it works. That means Pi can think before it spends context, verify before it acts, and carry project knowledge across sessions instead of rediscovering it every time.

## Install

```bash
pi install npm:@gitsense/pi-brains
```

Start Pi in a repository and run:

```text
/brains
```

If GitSense (`gsc`) is not installed, `/brains` will show install instructions.

## Quick Start

Use chat as the interface. You should not need to write rule files or run `gsc` commands for normal use.

### Catch Habit Commands

```text
I often type ls, clear, and pwd out of habit. Add a personal rule so those prompts are treated as terminal habits and are not sent into the conversation.
```

### Ask Before Editing

```text
Add a personal rule: do not write or edit files until I explicitly say to make the change. You can inspect files and propose a plan first.
```

### Protect Generated Files

```text
Add a repo rule for src/generated/**. When editing those files, warn that generated files should not be edited directly and tell Pi to edit the source schema instead.
```

### Remember Project Lessons

```text
Save this as a repo lesson: checkout discount behavior is split between src/checkout/pricing.ts and src/checkout/rules.ts. Future discount changes should inspect both files before editing.
```

## Make Pi Much Smarter

pi-brains makes knowledge a first-class citizen in Pi.

GitSense makes it simple to capture and store repository knowledge: rules, notes, lessons, topics, and Brains. pi-brains makes it simple for Pi to use that knowledge while it works.

That changes the starting point. A normal agent often begins by grepping, opening files, and spending context before it knows where the real risk is. With pi-brains, Pi can ask the repository what it already knows first.

Ask Pi:

```text
I want to improve search. Before deciding what to change, use the brains in this repo to identify any gotchas, then verify the important findings against source.
```

Pi can use structured repository knowledge to separate the problem before editing:

- "Search" may mean TUI fuzzy matching, autocomplete, session search, model filtering, or agent grep/find tools.
- `packages/tui/src/fuzzy.ts` may be shared infrastructure with high blast radius.
- Agent `grep.ts` and `find.ts` may be separate from TUI search.
- A Brain may surface hidden maintenance work, such as an incomplete stub or deprecated compatibility path.
- Pi can verify the relevant findings against source before proposing a plan.

The point is not that Pi never reads code. The point is that Pi gets a better first pass before it spends context on the wrong files.

## What You Can Teach Pi

| Knowledge | Example |
| --- | --- |
| Personal behavior | "Do not edit files until I approve the plan." |
| Repo conventions | "Generated files should be changed through schemas." |
| File-specific context | "This ledger is pipe-delimited accounting data." |
| Lessons | "This refactor failed before because logic is split across two files." |
| Brains | "Find gotchas, blast radius, hidden debt, or relevant files before planning." |
| Triggers | "Block production config edits unless approval is present." |

## What Makes pi-brains Different

Rules and hooks can make an agent react to events. pi-brains goes further by making knowledge scalable.

- **Knowledge is queryable.** Pi can search Brains before it chooses which files to open.
- **Behavior is teachable.** Tell Pi what to remember or enforce in normal language.
- **Context is scoped.** Save knowledge as personal or repo-scoped.
- **Lessons survive sessions.** Capture what went wrong once so future agents start smarter.
- **Rules stay focused.** Store durable instructions as structured knowledge instead of one growing markdown file.

## Commands

| Command | Description |
| --- | --- |
| `/brains` | Initialize GitSense context and show the HUD |
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
