# Observable Shell Discovery Rules

These opt-in GitSense rule bundles guide Pi toward `gsc bash` for supported
shell discovery commands. They cover `rg`, `grep`, `find`, `ls`, `head`,
`tail`, `wc`, `sort`, and `uniq`, including commands composed with pipes,
`&&`, semicolons, and newlines.

Choose one mode:

- `advisory.bundle.json` sends a passive reminder at most once per context.
- `strict.bundle.json` blocks every matching unwrapped command.

Configure interactively from Pi:

```text
/brains rules shell
```

Direct forms are also available:

```text
/brains rules shell advisory personal
/brains rules shell strict repo
/brains rules shell status
/brains rules shell off personal
```

The commands below are the lower-level `gsc` equivalents for reviewing or
installing a bundle manually from a pi-brains checkout.

Review an import without writing anything:

```sh
gsc rules import rules/gsc-bash-observability/advisory.bundle.json \
  --target personal --dry-run --format json
```

Install advisory mode for all repositories used by the current user:

```sh
gsc rules import rules/gsc-bash-observability/advisory.bundle.json \
  --target personal --allow-executable
```

Switch to strict mode:

```sh
gsc rules import rules/gsc-bash-observability/strict.bundle.json \
  --target personal --allow-executable --on-conflict replace
```

Both variants intentionally use the same rule ID. Importing with
`--on-conflict replace` switches modes without leaving both policies active.
Use `--target repo` instead of `personal` when the policy should be shared only
by one repository.

Regenerate bundles after changing either trigger:

```sh
npm run rules:build
```

The trigger performs a bounded shell scan rather than executing or rewriting
the command. It recognizes common environment, `command`, `exec`, `sudo`, and
`env` prefixes. It does not attempt to interpret nested command substitutions
or indirect execution such as `xargs rg` in this first version.
