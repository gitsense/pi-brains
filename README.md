<p align="center">
  <img src="assets/pi-brains-logo.png" alt="pi-brains logo" width="600">
</p>

<h3 align="center">
  Teach Pi what to remember and how to behave.
</h3>

<p align="center">
  <a href="#install">Install</a> &nbsp;·&nbsp;
  <a href="#see-it-in-action">See it in action</a> &nbsp;·&nbsp;
  <a href="#brains-ask">/brains ask</a> &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a> &nbsp;·&nbsp;
  <a href="#configure-rules">Configure rules</a> &nbsp;·&nbsp;
  <a href="#try-it-yourself">Try it yourself</a>
</p>

**pi-brains** gives [Pi](https://github.com/earendil-works/pi) persistent, queryable guidance it can use while it works.

Tell Pi what your domain knows, what rules to follow, what mistakes to avoid, or what context to pull in. pi-brains saves that guidance as durable GitSense records, then helps Pi query, apply, and verify it at the right moment.

## Install

```bash
pi install npm:@gitsense/pi-brains
```

Start Pi in a workspace and run:

```text
/brains
```

If [GitSense (`gsc`)](https://github.com/gitsense/gsc-cli) is not installed, `/brains` will show install instructions.

## See it in action

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <p align="center"><code>/brains rules on</code></p>
      <p align="center">
        <a href="https://raw.githubusercontent.com/gitsense/pi-brains/staging/assets/demo/brains-rules-on.mp4">
          <img src="assets/demo/brains-rules-on.png" alt="Watch the /brains rules on demo video" width="360">
        </a>
      </p>
      <p>Turn on guardrails that stop risky edits and enforce project behavior.</p>
    </td>
    <td width="50%" valign="top">
      <p align="center"><code>/brains inspect</code></p>
      <p align="center">
        <a href="https://raw.githubusercontent.com/gitsense/pi-brains/staging/assets/demo/brains-inspect.mp4">
          <img src="assets/demo/brains-inspect.png" alt="Watch the /brains inspect demo video" width="360">
        </a>
      </p>
      <p>Open the active session in GitSense Chat to turn a wall of tool calls into actionable insights.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <p align="center"><code>/brains sessions</code></p>
      <p align="center">
        <a href="https://raw.githubusercontent.com/gitsense/pi-brains/staging/assets/demo/brains-sessions.mp4">
          <img src="assets/demo/brains-sessions.png" alt="Watch the /brains sessions demo video" width="360">
        </a>
      </p>
      <p>Open GitSense Chat to monitor agents, find any session, and surface insights.</p>
    </td>
    <td width="50%" valign="top">
      <p align="center"><code>/brains inbox auto on</code></p>
      <p align="center">
        <img src="assets/demo/inbox-auto-on-placeholder.png" alt="Placeholder for the /brains inbox auto on demo video" width="360">
      </p>
      <p>Craft complex messages ergonomically in GitSense Chat and send them to the TUI automatically.</p>
    </td>
  </tr>
</table>

## `/brains ask`

Using multiple agents to spread the context load isn't new. What's usually awkward is keeping those agents organized, asking them from one place, and bringing their answers back into the session doing the work. `/brains ask` makes that part easier.

Too much context can hurt an agent's reasoning. Every document, tool call, and unrelated detail asks for some of its attention. Keeping different parts of the problem in focused sessions lets the main agent work with the findings instead of carrying all of the research.

Track related sessions in GitSense Chat and register the group URL once. From then on, `/brains ask` can open that group from any Pi session and add the current session to it. Message the agents that already have the context you need, follow their status from one page, and use their replies to write one focused message for the agent doing the work.

<table width="100%">
  <tr>
    <th width="35%" align="left">What you do</th>
    <th width="65%" align="left">What it looks like</th>
  </tr>
  <tr>
    <td valign="top">
      <strong>1. Save a group</strong>
      <p>Track sessions that carry useful context, copy the group URL, and register it with <code>/brains ask register &lt;url&gt;</code>.</p>
    </td>
    <td valign="top" align="center">
      <img src="assets/demo/knowledge-track-placeholder.svg" alt="Video placeholder showing sessions being tracked and registered as a group" width="520">
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>2. Ask what you need</strong>
      <p>Run <code>/brains ask</code>, open the group, message the relevant agents, and follow their status.</p>
    </td>
    <td valign="top" align="center">
      <img src="assets/demo/knowledge-ask-placeholder.svg" alt="Video placeholder showing questions being sent to agents from a saved group" width="520">
    </td>
  </tr>
  <tr>
    <td valign="top">
      <strong>3. Bring back what matters</strong>
      <p>Use the replies to compose one focused message and send it to the main session through <code>/brains inbox</code>.</p>
    </td>
    <td valign="top" align="center">
      <img src="assets/demo/knowledge-share-placeholder.svg" alt="Video placeholder showing several answers being combined and sent to the main session" width="520">
    </td>
  </tr>
</table>

### Why not just use subagents?

Subagents are useful when the current agent needs to divide a task. `/brains ask` helps divide the context.

A saved group can contain any sessions whose context may be useful, regardless of when they were created or what task created them. You choose which agents to ask and which parts of their answers deserve space in the main session.

| Subagents | Saved groups |
| --- | --- |
| Divide the work for a specific task | Keep different parts of the context in different sessions |
| Start with work delegated by a parent agent | Can bring together sessions created at different times for different work |
| Return the result of the delegated work | Let you compare answers and decide what enters the main session |
| Best for parallel execution | Best for keeping the main context focused |

The two approaches work well together: use subagents to divide the work, and `/brains ask` to bring in context that already lives somewhere else.

## How it works

1. **You teach** - Tell Pi what your domain knows, what rules to follow, what mistakes to avoid, or what context to pull in.
2. **It remembers** - pi-brains saves that guidance as focused GitSense records at the personal, repo, file, or topic level.
3. **It applies** - Pi queries those records when they matter: before it starts, before it edits, after it uses a tool, or when a session ends.

### What makes it different

pi-brains is not trying to replace hooks, markdown instructions, or search.

Hooks react to events. Markdown shares guidance. Search finds text.

pi-brains gives Pi focused records it can query and apply while it works.

| Approach | Best at | Limitation |
| --- | --- | --- |
| Hooks | Reacting to workflow events | Hard to teach, browse, and query as durable knowledge |
| Markdown docs | Sharing human-readable guidance | Passive unless Pi knows when and where to read them |
| Search | Finding matching text or similar passages | Returns matches, not scoped behavioral records |
| pi-brains | Storing scoped guidance Pi can query, apply, and verify | Complements source and docs rather than replacing them |

The result is not that Pi stops reading source. The result is that Pi gets a better starting point, then verifies important findings against source before acting.

### What rules can do

Rules can do more than sit in a doc. They can catch accidental terminal habits, stop risky edits until Pi reads the right context, ask Pi to verify a result, or leave guidance for the next turn.

## Configure Rules

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

- **Quick examples to try** — See the [gsc-rules-demos README](https://github.com/gitsense/gsc-rules-demos#try-the-examples) for prompts you can copy and paste.
- **Detailed walkthrough** — See the [Pi Hands-On Guide](https://github.com/gitsense/gsc-rules-demos/blob/main/docs/pi/hands-on.md) for setup notes and expected behavior.

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

## Commands

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
| `/brains checkpoint suggest on` | Enable checkpoint suggestions |
| `/brains checkpoint suggest off` | Disable checkpoint suggestions |
| `/brains checkpoint suggest status` | Show checkpoint suggestion status |
| `/brains forget` | Prune entries after the current `/tree` position (with backup) |
| `/brains inspect` | Show inspect view instructions |
| `/brains sessions` | Open the GitSense Chat view for all Pi sessions |
| `/brains ask` | Open a saved knowledge group in GitSense Chat |
| `/brains ask <group-name>` | Open a saved knowledge group directly |
| `/brains ask register <url>` | Save a GitSense Chat group URL for reuse |
| `/brains ask list` | List saved knowledge groups |
| `/brains ask groups` | List saved knowledge groups |
| `/brains ask rename` | Rename a saved knowledge group |
| `/brains ask delete` | Remove a saved knowledge group |
| `/brains inbox` | Review messages drafted in GitSense Chat |
| `/brains inbox list` | List all messages in the session inbox |
| `/brains inbox status` | Show current inbox settings |
| `/brains inbox auto on` | Automatically accept new inbox messages for this session |
| `/brains inbox auto off` | Disable automatic inbox acceptance |
| `/brains inbox auto status` | Show automatic inbox acceptance status |
| `/brains inbox help` | Show inbox commands and current settings |
| `/brains dismiss` | Dismiss the GitSense unavailable notice |
| `/brains help` | Show available commands |

## Current Boundaries

- File tracking is exact for structured `read`, `edit`, and `write` tools.
- Arbitrary shell file activity may be missing.
- Brain analysis and cross-session history require GitSense integration.
- Brains are guidance, not a replacement for source verification.

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

MIT
