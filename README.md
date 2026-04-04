# codex-auth-switch

`codex-auth-switch` is a CLI for keeping multiple Codex personal-account sessions on one machine and switching between them.

It swaps only the active auth file. Your main Codex history, logs, sessions, and other state stay shared.

## Status

- Public GitHub repository: ready
- npm package name: selected as `codex-auth-switch`

For now, the supported installation path is running from this repository checkout. Package-install instructions will be added after the package is published.

## Before You Start

- **This tool runs as `./codex-auth-switch ...` in this repository.**
- Running `pnpm install` and `pnpm build` does **not** create a global `codex-auth-switch` command.
- `./codex-auth-switch` is a small wrapper that runs `node dist/index.mjs`.

## Requirements

- macOS or Linux
- Node.js `24.14.0` or newer
- `pnpm`
- Codex CLI on `PATH`

## Important Constraints

- **File-backed auth only.** `cli_auth_credentials_store` must be `"file"` or `"auto"` resolving to a readable file-backed auth file. Keyring-backed auth is not supported.
- **Email is a label.** `add <email>` stores the email as a user-provided label. It is not verified against the browser session used during `codex login`.
- **Usage is best-effort.** `usage` depends on upstream behavior that is not a public stable API.

## Install

```bash
pnpm install
pnpm build
```

After that, run the CLI like this:

```bash
./codex-auth-switch --help
```

Windows is not supported at the moment. The CLI currently depends on POSIX process inspection and file-permission behavior.

## Quick Start

### 1. Add an account

```bash
./codex-auth-switch add you@example.com
```

This opens a temporary `codex login` flow and saves the resulting auth snapshot under that email label.

Example output:

```text
Added account

  Label      : you@example.com
  Account ID : 8cd075d2-c767-41da-91d4-09ff5585276d
```

### 2. List saved accounts

```bash
./codex-auth-switch ls
```

Example:

```text
Saved accounts (2)

Active  Label            Account ID   Last used
------  ---------------  -----------  --------------------
yes     foo@example.com  8cd075d2-c767-41da-91d4-09ff5585276d  2026-04-04 21:10 local
        bar@example.com  a1b2c3d4-e5f6-7890-abcd-1234567890ef  2026-04-03 18:00 local
```

Columns:

- active flag
- email label
- full `account_id`
- `last_used_at` in local time

### 3. Switch the active account

Interactive:

```bash
./codex-auth-switch use
```

Direct:

```bash
./codex-auth-switch use foo@example.com
```

This writes the selected auth to `$CODEX_HOME/auth.json`. If `CODEX_HOME` is not set, the default target is `~/.codex/auth.json`.

Example output:

```text
Active account

  Label      : foo@example.com
  Account ID : 8cd075d2-c767-41da-91d4-09ff5585276d
```

### 4. Check usage

Current account:

```bash
./codex-auth-switch usage
```

Specific account:

```bash
./codex-auth-switch usage foo@example.com
```

All accounts:

```bash
./codex-auth-switch usage --all
```

JSON output:

```bash
./codex-auth-switch usage --all --json
```

Example:

```text
Usage summary (2 accounts)

foo@example.com
  Status    : ok
  Observed email : admin@northview.jp
  Plan      : pro
  5h limit  : 58% left (resets 14:00)
  Weekly limit : 90% left (resets 15:00 on 11 Apr)
  Fetched   : 2026-04-04 21:10 local

bar@example.com
  Status : error
  Code   : unauthorized
  Detail : Saved session was rejected
```

## Command Reference

### `./codex-auth-switch add <email>`

Starts a temporary `codex login` flow and stores the resulting auth snapshot.

- Rejects duplicate email labels
- Normalizes the label with `trim + lowercase`

### `./codex-auth-switch ls`

Lists all saved accounts.

### `./codex-auth-switch use [email]`

Switches the active account.

- With no `email`, opens an interactive selector
- With `email`, switches directly
- Fails if a Codex session appears to be running
- Syncs the current auth back into managed storage before switching

### `./codex-auth-switch usage [email] [--all] [--json]`

Reads usage information.

- No argument: current account
- `email`: specific account
- `--all`: all saved accounts
- `--json`: machine-readable output

`--all` continues when one account fails. If the resolved auth belongs to a different `account_id`, the command fails closed for that account.
If the upstream usage payload reports a different email than the saved label, the human-readable output shows `Observed email`.

Typical empty state:

```text
No saved accounts yet.
Run `./codex-auth-switch add <email>` to register your first account.
```

## Where Data Is Stored

Managed auth snapshots live outside the main Codex directory:

```text
~/.config/codex-auth-switch/
  state.json
  accounts/
    <profile_id>.json
```

- `email` is the user-facing identifier
- `profileId` is the internal primary key
- managed auth paths are derived from `profileId` at runtime

Example `state.json`:

```json
{
  "currentProfileId": "prof_123",
  "accounts": {
    "prof_123": {
      "profileId": "prof_123",
      "email": "foo@example.com",
      "accountId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "createdAt": "2026-04-04T12:00:00Z",
      "lastUsedAt": "2026-04-04T12:10:00Z"
    }
  }
}
```

## License

MIT

## Safety

- Atomic replacement of auth and state files
- Lock-file based concurrency control for `add` and `use`
- `0700` for directories and `0600` for auth files
- No logging of tokens or raw auth payloads
- Rollback on failed switch when possible

Important risk:

- If `~/.config/codex-auth-switch/` is compromised, every saved session is exposed

Please report security issues privately as described in [`SECURITY.md`](./SECURITY.md).

## Errors and Logs

Exit codes:

| Exit code | Meaning |
|-----------|---------|
| `1` | User input or validation failure |
| `2` | Local state, auth, or lock failure |
| `3` | External dependency failure |

For structured logs:

```bash
CODEX_AUTH_SWITCH_LOG_LEVEL=debug ./codex-auth-switch usage --all
```

- Output format: JSON Lines on `stderr`
- Levels: `error`, `warn`, `info`, `debug`
- Sensitive fields are redacted
