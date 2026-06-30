# Pi-Brains Technical Reference

Command and trigger examples for using GitSense rules in Pi with pi-brains.

For the chat-first workflow, start with [TUTORIAL.md](TUTORIAL.md).

## Prerequisites

- [Pi](https://github.com/earendil-works/pi-mono) installed
- pi-brains extension installed (`pi install /path/to/pi-brains`)
- [GitSense CLI (gsc)](https://github.com/gitsense/gsc-cli) installed

## Setup

```bash
cd /path/to/your/repo
pi
```

Once Pi starts, initialize the expert context:

```
/brains
```

This teaches the agent how to use `gsc` commands.

Optional — enable debug logging:

```
/brains debug on
```

Rules are enabled by default.

---

## Example 1: Prompt Interception

**What you'll learn:** Rules can intercept user input before it reaches the agent.

**Create the trigger file:**

```bash
mkdir -p .gitsense/rules/triggers

cat > .gitsense/rules/triggers/exit-alias.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
const text = (ctx.payload?.prompt?.text || '').trim();

if (text === 'exit') {
  console.log(JSON.stringify({
    matched: true,
    block: true,
    message: "Pi uses /quit to exit. Type /quit or press Ctrl+D."
  }));
} else {
  console.log(JSON.stringify({ matched: false, block: false }));
}
EOF
```

**Register the trigger:**

```bash
gsc rules trigger new \
  --title "Exit alias" \
  --runtime node \
  --entry exit-alias.mjs \
  --event user_prompt_submit \
  --action prompt \
  --frequency always
```

**Prompt:**

```
exit
```

**Expected output:**

```
Warning: Pi uses /quit to exit. Type /quit or press Ctrl+D.
```

**What happened:** The rule intercepted your input before it reached the agent. No LLM response was generated — the input was consumed and replaced with guidance.

**Try it yourself:** Ask the agent to add more command aliases:

```
add a rule that intercepts "clear" and shows a message to use /clear instead
```

---

## Example 2: Declarative Rules (Instructions)

**What you'll learn:** How declarative rules deliver instructions the first time, then get out of the way.

**Create the rule:**

```bash
gsc rules new \
  --event pre_tool_use \
  --action read \
  --glob "data/accounting/**" \
  --summary "Accounting format guidance" \
  --instruction "These files use a pipe-delimited ledger format. Use \`gsc query\` for metadata."
```

**Prompt:**

```
read data/accounting/q1.ledger
```

**Expected behavior:**

1. Block happens when Pi tries to execute the read
2. Message includes: "These files use a pipe-delimited ledger format"
3. Agent reads the instructions and proceeds

**Try the same prompt again:**

```
read data/accounting/q1.ledger
```

**Expected:** Second read succeeds immediately (no block). Declarative rules use once-per-rule-hash delivery tracking — after instructions are delivered once, they're skipped on subsequent reads.

---

## Example 3: Notice-Only (Warning Without Blocking)

**What you'll learn:** Triggers can warn without blocking — useful for advisory information.

**Create the trigger file:**

```bash
cat > .gitsense/rules/triggers/generated-notice.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));

console.log(JSON.stringify({
  matched: true,
  block: false,
  notice: "WARNING: You are editing an auto-generated file. Consider editing the source schema instead."
}));
EOF
```

**Register the trigger:**

```bash
gsc rules trigger new \
  --title "Generated file warning" \
  --runtime node \
  --entry generated-notice.mjs \
  --glob "src/generated/**" \
  --action edit \
  --frequency always
```

**Prompt:**

```
edit src/generated/types.ts to add a nickname field
```

**Expected:** Edit proceeds, but a warning notice appears.

---

## Example 4: Executable Edit Block (with Bypass)

**What you'll learn:** How to create safety guards with escape hatches.

**Create the trigger file:**

```bash
cat > .gitsense/rules/triggers/config-guard.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
const approved = process.env.CONFIG_EDIT_APPROVED === 'true';

console.log(JSON.stringify({
  matched: true,
  block: !approved,
  message: approved ? undefined : "Production config requires approval. Set CONFIG_EDIT_APPROVED=true.",
  notice: approved ? "Config edit approved." : undefined
}));
EOF
```

**Register the trigger:**

```bash
gsc rules trigger new \
  --title "Production config guard" \
  --runtime node \
  --entry config-guard.mjs \
  --glob "config/production*" \
  --action edit \
  --frequency always
```

**Test without approval:**

```bash
unset CONFIG_EDIT_APPROVED
pi
# Prompt: edit config/production.env to change APP_PORT to 9090
# → BLOCKED
```

**Test with approval:**

```bash
export CONFIG_EDIT_APPROVED=true
pi
# Prompt: edit config/production.env to change APP_PORT to 9090
# → Approved, edit proceeds
```

---

## Example 5: Multi-Rule Match

**What you'll learn:** Multiple rules can match the same file — they're all delivered together.

**Create the declarative rule:**

```bash
gsc rules new \
  --glob ".github/workflows/deploy.yml" \
  --action edit \
  --summary "Deployment workflow review" \
  --instruction "Deployment workflow changes require DevOps team review."
```

**Create the trigger file:**

```bash
cat > .gitsense/rules/triggers/deploy-guard.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));

console.log(JSON.stringify({
  matched: true,
  block: true,
  message: "DEPLOYMENT WORKFLOW GUARD — Contact DevOps before modifying deployment workflows."
}));
EOF
```

**Register the trigger:**

```bash
gsc rules trigger new \
  --title "Deployment workflow guard" \
  --runtime node \
  --entry deploy-guard.mjs \
  --glob ".github/workflows/deploy.yml" \
  --action edit \
  --frequency always
```

**Prompt:**

```
edit .github/workflows/deploy.yml to add a step
```

**Expected:** Both rules appear in the matched-rule packet.

---

## Example 6: Parallel Execution

**What you'll learn:** Multiple triggers run concurrently.

**Create three trigger files with different sleep times:**

```bash
cat > .gitsense/rules/triggers/parallel-slow-a.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
await new Promise(r => setTimeout(r, 500));
console.log(JSON.stringify({
  matched: true, block: false,
  notice: "parallel-slow-a completed (500ms)"
}));
EOF

cat > .gitsense/rules/triggers/parallel-slow-b.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
await new Promise(r => setTimeout(r, 1000));
console.log(JSON.stringify({
  matched: true, block: false,
  notice: "parallel-slow-b completed (1000ms)"
}));
EOF

cat > .gitsense/rules/triggers/parallel-slow-c.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
await new Promise(r => setTimeout(r, 1500));
console.log(JSON.stringify({
  matched: true, block: false,
  notice: "parallel-slow-c completed (1500ms)"
}));
EOF
```

**Register all three triggers:**

```bash
gsc rules trigger new \
  --title "Parallel slow A" \
  --runtime node \
  --entry parallel-slow-a.mjs \
  --glob "src/parallel/**" \
  --action edit \
  --frequency always

gsc rules trigger new \
  --title "Parallel slow B" \
  --runtime node \
  --entry parallel-slow-b.mjs \
  --glob "src/parallel/**" \
  --action edit \
  --frequency always

gsc rules trigger new \
  --title "Parallel slow C" \
  --runtime node \
  --entry parallel-slow-c.mjs \
  --glob "src/parallel/**" \
  --action edit \
  --frequency always
```

**Prompt:**

```
edit src/parallel/checkout.ts to add a discount field
```

**Expected:** All three notices appear in ~1.5s (the longest), not ~3s (the sum). Triggers run in parallel.

---

## Example 7: Error Handling (Fail-Open)

**What you'll learn:** Broken triggers don't block legitimate work.

**Create a trigger that throws an error:**

```bash
cat > .gitsense/rules/triggers/throws-error.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
throw new Error("Intentional error for testing");
EOF
```

**Register the trigger:**

```bash
gsc rules trigger new \
  --title "Broken trigger" \
  --runtime node \
  --entry throws-error.mjs \
  --glob "src/errors/**" \
  --action read \
  --frequency always
```

**Prompt:**

```
read src/errors/broken-trigger-target.txt
```

**Expected:** Read succeeds (not blocked). A warning notice appears: `Trigger error: Intentional error for testing - Action proceeding (fail-open)`

---

## Example 8: AI Provenance Tracking

**What you'll learn:** Track AI-authored changes to third-party code for audit purposes.

**Create the post_tool_use trigger:**

```bash
cat > .gitsense/rules/triggers/ai-provenance.mjs << 'EOF'
import { readFileSync, appendFileSync } from 'node:fs';

const ctx = JSON.parse(readFileSync(0, 'utf8'));
const file = ctx.toolCall?.file || '';

if (!file.startsWith('third_party/')) {
  console.log(JSON.stringify({ matched: false, block: false }));
  process.exit(0);
}

appendFileSync('.gitsense/ai-provenance.jsonl', JSON.stringify({
  file,
  timestamp: new Date().toISOString(),
  status: "pending"
}) + '\n');

console.log(JSON.stringify({
  matched: true, block: false,
  notice: `AI provenance entry created for ${ctx.repo?.normalizedFile || file}`,
  deliveryMode: "passiveSteer"
}));
EOF
```

**Register the trigger:**

```bash
gsc rules trigger new \
  --title "AI provenance tracking" \
  --runtime node \
  --entry ai-provenance.mjs \
  --glob "third_party/**" \
  --event post_tool_use \
  --action edit \
  --frequency always
```

**Create the agent_end verification trigger:**

```bash
cat > .gitsense/rules/triggers/ai-provenance-verify.mjs << 'EOF'
import { readFileSync } from 'node:fs';

const ctx = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify({
  matched: true, block: false,
  notice: "Check AI provenance entries before finishing.",
  deliveryMode: "passiveSteer"
}));
EOF
```

**Register the verification trigger:**

```bash
gsc rules trigger new \
  --title "AI provenance verify" \
  --runtime node \
  --entry ai-provenance-verify.mjs \
  --event agent_end \
  --action agent_end \
  --frequency always
```

**Prompt:**

```
edit third_party/vendor-widget.js to add input validation
```

**Expected:** Edit completes, then a notice appears: "AI provenance entry created for third_party/vendor-widget.js". On agent end, a second notice reminds you to check provenance entries.

---

## Creating Your Own Rules

### Declarative (instructions)

```bash
gsc rules new \
  --event pre_tool_use \
  --action read \
  --glob "docs/**" \
  --summary "Documentation guidance" \
  --instruction "Check if there are related notes before reading documentation files."
```

### Executable (triggers)

```bash
# 1. Create the trigger file
cat > .gitsense/rules/triggers/my-guard.mjs << 'EOF'
import { readFileSync } from 'node:fs';
const ctx = JSON.parse(readFileSync(0, 'utf8'));
const file = ctx.toolCall?.file || '';

if (file.startsWith('config/')) {
  console.log(JSON.stringify({
    matched: true, block: true,
    message: "Config changes require approval."
  }));
} else {
  console.log(JSON.stringify({ matched: false, block: false }));
}
EOF

# 2. Register the trigger
gsc rules trigger new \
  --title "Config guard" \
  --runtime node \
  --entry my-guard.mjs \
  --glob "config/**" \
  --action edit \
  --frequency always
```

### Ask the agent

```
add a rule that warns when editing test files in src/
```

```
create a rule that blocks edits to package.json unless TEST_MODE is set
```

---

## Delivery modes

| Mode | Behavior | Agent can ignore? |
|------|----------|-------------------|
| `steer` | Forces agent to respond immediately | No |
| `followUp` | Queues a follow-up message | No |
| `passiveSteer` | Buffers for next context injection | Yes |

Use `steer` for reminders you don't want to miss. Use `passiveSteer` for audit trails and advisory guidance.

---

## Lifecycle events

| Event | When | Can block? |
|-------|------|-----------|
| `pre_tool_use` | Before `read`, `edit`, `write`, `bash` | Yes |
| `post_tool_use` | After any tool completes | No |
| `user_prompt_submit` | When the user types a prompt | Yes |
| `before_agent_start` | Before the agent processes the prompt | No |
| `agent_end` | When the agent finishes a turn | No |
| `context` | Before context is assembled | No |
| `session_before_compact` | Before session compaction | No |
| `session_compact` | After session compaction | No |

---

## Troubleshooting

| Issue | Possible cause |
|-------|----------------|
| No block/notice | Rules disabled (`/brains rules on` to re-enable) |
| No block/notice | gsc not installed (`/brains` to check) |
| Prompt not intercepted | pi-brains not passing prompt text |
| Trigger error | Check debug log (`/brains debug on`, then `tail -f .gitsense/debug/pi-brains-*.log`) |

---

## Next steps

- Explore existing rules: `gsc rules list`
- Search for rules: `gsc rules search <query>`
- Learn about rule topics: `gsc topics list`
- Add notes to files: `gsc notes add --file <path> --summary "..." --content "..."`
