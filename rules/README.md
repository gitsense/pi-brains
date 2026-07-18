# Pi Brains Rule Catalog

Pi Brains ships optional GitSense rules that users can review and install at
personal or repository scope. Installing the Pi package does not activate any
of these policies automatically.

## Available Rules

| Rule pack | Purpose | Modes |
| --- | --- | --- |
| [Observable shell discovery](gsc-bash-observability/README.md) | Route supported discovery commands through `gsc bash` for structured session evidence | Advisory, strict |

## Configure from Pi

Run the interactive configurator:

```text
/brains rules shell
```

Or select a mode and scope directly:

```text
/brains rules shell advisory personal
/brains rules shell strict repo
/brains rules shell status
/brains rules shell off personal
```

- `personal` applies the policy across repositories.
- `repo` writes it to the current repository so the project can share it.
- `off` removes only this shell policy; it does not disable other rules.

Pi Brains asks for confirmation before installing executable rule assets. The
strict mode explicitly blocks unwrapped supported discovery commands.

## Find the Catalog

A normal user-level npm installation places this directory at:

```text
~/.pi/agent/npm/node_modules/@gitsense/pi-brains/rules
```

A project-local Pi installation places it at:

```text
<repo>/.pi/npm/node_modules/@gitsense/pi-brains/rules
```

For a git or local checkout, use the `rules/` directory at the package root.

## Manual Installation

The `/brains` configurator is preferred. To inspect or import bundles directly,
personal rules follow the user across repositories:

```sh
gsc rules import \
  "$HOME/.pi/agent/npm/node_modules/@gitsense/pi-brains/rules/gsc-bash-observability/advisory.bundle.json" \
  --target personal --allow-executable
```

Repository rules are written to the current repository and can be shared with
the project. Run this from the repository root:

```sh
gsc rules import \
  "$HOME/.pi/agent/npm/node_modules/@gitsense/pi-brains/rules/gsc-bash-observability/advisory.bundle.json" \
  --target repo --allow-executable
```

For a project-local Pi package, replace the bundle path above with:

```text
.pi/npm/node_modules/@gitsense/pi-brains/rules/gsc-bash-observability/advisory.bundle.json
```

Executable bundles require `--allow-executable` so installation remains an
explicit choice. Use `--dry-run --format json` first to inspect the planned
rules, topics, and trigger assets without writing anything.

List configured policies with `gsc rules list`. Remove this catalog's current
observable-shell policy with:

```sh
gsc rules delete rule_pi_bash_observability_v1 --target personal
```

Use `--target repo` instead when it was installed into a repository.
