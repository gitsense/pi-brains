# Pi-Brains Tutorial

Create scalable knowledge and behavior for Pi by chatting with it.

pi-brains works best when you treat Pi as the interface. You describe what Pi should remember or enforce. Pi uses GitSense (`gsc`) to turn that into scoped knowledge: rules, notes, lessons, topics, and triggers.

You should not need to write trigger files or run `gsc` commands by hand for normal use. Those details are covered in [TECHNICAL.md](TECHNICAL.md).

## Setup

Start Pi in the repository or workspace you want it to understand:

```bash
cd /path/to/your/repo
pi
```

Initialize pi-brains:

```text
/brains
```

This gives Pi the GitSense expert context. From there, create knowledge by asking for it in chat.

## How To Ask

Good requests usually include four things:

- What Pi should remember or enforce
- When it should apply
- Whether it is for this repository or personal to you
- Whether it should block, warn, or just provide context

Example:

```text
Add a repo rule: when editing files under src/generated/, warn that generated files should not be edited directly and suggest editing the source schema instead.
```

Pi should clarify anything missing before writing knowledge. For example:

```text
Should this be saved to repo scope or personal scope?
Should this block the edit or only warn?
What topic should this belong to?
```

## Knowledge Types

Use this language when you want to reduce back and forth:

| Say this | When you mean |
| --- | --- |
| "Add a rule" | Future agents should actively change behavior |
| "Add a note" | Pi should remember passive context about files or a topic |
| "Add a lesson" | Pi should remember something learned from prior work |
| "Add a trigger" | Code must run to decide what happens |
| "Repo scope" | This belongs to the project and should be shared |
| "Personal scope" | This is your preference across projects |
| "Block" | Stop the action until Pi responds to the guidance |
| "Warn" | Allow the action but show a notice |

Prefer rules before triggers. Use triggers only when Pi needs runtime logic, such as checking an environment variable, reading a ticket file, or recording audit metadata.

## Example 1: Warn Before Editing Generated Files

Tell Pi:

```text
Add a repo rule for src/generated/**. When editing those files, warn that generated files should not be edited directly and tell Pi to edit the source schema instead. Use the topic generated-code.
```

Pi should:

- Check or create the `generated-code` topic
- Create a repo-scoped rule
- Match `src/generated/**`
- Apply on `pre_tool_use` for edit/write actions
- Report the rule ID and how to update or delete it

Try it:

```text
Edit src/generated/types.ts to add a nickname field.
```

Expected behavior: Pi sees the rule before the edit and redirects itself toward the source schema.

## Example 2: Teach Pi About Accounting Ledgers

Tell Pi:

```text
Add a repo rule for data/accounting/**. When Pi reads these files, tell it they are pipe-delimited ledgers and it should use GitSense metadata before interpreting them. Use the topic accounting-data.
```

Pi should create a declarative rule. No trigger is needed because this is static guidance.

Try it:

```text
Read data/accounting/q1.ledger and summarize the unusual entries.
```

Expected behavior: Pi receives the ledger guidance before reading and handles the file as structured accounting data rather than generic text.

## Example 3: Block Production Config Changes

Tell Pi:

```text
Add a repo rule that blocks edits to config/production* unless there is explicit approval. If this needs runtime logic, create a trigger. Use the topic production-safety.
```

Pi should ask what counts as approval. For example:

```text
Should approval be an environment variable, a file, a ticket reference, or a manual confirmation?
```

You can answer:

```text
Use the environment variable CONFIG_EDIT_APPROVED=true.
```

Pi should:

- Explain that this requires an executable trigger
- Confirm that code will run automatically
- Create the trigger in repo scope
- Validate it
- Report its side effects and rollback command

Try it:

```text
Edit config/production.env to change APP_PORT to 9090.
```

Expected behavior: without approval, Pi is blocked and receives the required next step. With approval, the edit can proceed.

## Example 4: Save A Lesson From A Failed Refactor

After a task goes wrong, tell Pi:

```text
Save this as a repo lesson: the checkout discount logic is split between src/checkout/pricing.ts and src/checkout/rules.ts. Future refactors should inspect both files before changing discount behavior. Use the topic checkout.
```

Pi should:

- Create or reuse the `checkout` topic
- Store the lesson in repo scope
- Attach it to the relevant files when possible
- Make it searchable for future work

Later, ask:

```text
Refactor the discount logic in checkout.
```

Expected behavior: Pi can find the lesson before editing and avoid repeating the same mistake.

## Example 5: Add Personal Preferences

Tell Pi:

```text
Add a personal rule: after editing tests, remind me to run the narrowest relevant test command instead of the full suite unless I ask for the full suite.
```

Pi should save this in personal scope because it describes how you prefer to work, not a project convention.

Try it in any repository:

```text
Edit user-auth.test.ts to cover expired sessions.
```

Expected behavior: Pi reminds you to run the focused test command after changing the test.

## Example 6: Attach Notes To Tricky Files

Tell Pi:

```text
Add a repo note for packages/billing/src/invoice.ts: this file mixes invoice calculation with export formatting, so changes should check both billing totals and CSV output. Use the topic billing.
```

Pi should create a note, not a rule, because this is context rather than required behavior.

Later, ask:

```text
Update invoice export formatting.
```

Expected behavior: Pi can retrieve the note and account for both concerns before editing.

## Example 7: Track AI Edits To Third-Party Code

Tell Pi:

```text
Add a repo trigger: whenever Pi edits files under third_party/**, record an AI provenance entry and remind me at the end of the turn to review it. Use the topic ai-provenance.
```

Pi should explain that this needs executable trigger code because it writes an audit entry. It should ask for confirmation before creating it.

Try it:

```text
Edit third_party/vendor-widget.js to add input validation.
```

Expected behavior: Pi records the edit and reminds you to review the provenance entry before finishing.

## What Pi Should Report

After creating knowledge, Pi should summarize:

- Scope: repo or personal
- Type: rule, note, lesson, or trigger
- Topic
- Matching files, globs, actions, and lifecycle event
- Whether it blocks, warns, or only provides context
- Validation performed
- How to update, disable, or delete it

For triggers, Pi should also report:

- Runtime
- Trigger file path
- Side effects
- Timeout or frequency if relevant
- Confirmation that executable code was created

## If Pi Asks Too Many Questions

Give it the missing fields directly:

```text
Create this in repo scope. It should be a declarative rule, not a trigger. Topic: generated-code. Event: pre_tool_use. Actions: edit and write. Frequency: once per context. Warn, do not block.
```

For a personal preference:

```text
Create this in personal scope. It is a rule, not a note. Apply it across repositories. Warn, do not block.
```

For a trigger:

```text
Create this as a repo-scoped executable trigger. Runtime: node. Event: pre_tool_use. Action: edit. It should block. Side effects: read environment variables only. I confirm creation.
```

## When To Use Technical Reference

Use [TECHNICAL.md](TECHNICAL.md) when you want to:

- Hand-write `gsc` commands
- Inspect trigger source code
- See lifecycle event details
- Validate or replay-test triggers manually
- Debug `gsc rules execute` behavior

For normal use, chat with Pi first.
