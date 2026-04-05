# codex-auth-switch

`codex-auth-switch` is a CLI for keeping multiple Codex personal-account sessions on one machine and switching between them.

It swaps only the active auth file. Your main Codex history, logs, sessions, and other state stay shared.

## Before You Start

- **This tool runs as `./codex-auth-switch ...` from this repository's root.**
- `pnpm install && pnpm build` does **not** create a global command. Always invoke via `./codex-auth-switch`.

## Requirements

- macOS or Linux
- Node.js `24.14.0` or newer
- `pnpm`
- Codex CLI on `PATH`

## Important Constraints

- **File-backed auth only.** Codex's `cli_auth_credentials_store` setting must be `"file"` (or `"auto"` resolving to a file). Keyring-backed auth is not supported.
- **Email is a label.** `add <email>` stores the email as a user-provided label. It is not verified against the browser session used during `codex login`.
- **Usage is best-effort.** The `usage` command relies on Codex's internal API, which is not a public stable interface and may change without notice.

## Install

```bash
pnpm install
pnpm build
```

Verify the build:

```bash
./codex-auth-switch --help
```

> **Note:** Windows is not supported. The CLI depends on POSIX process inspection and file-permission behavior.

## Quick Start

### 1. Add an account

```bash
./codex-auth-switch add you@example.com
```

This opens a temporary `codex login` flow and saves the resulting auth snapshot under that email label.

Example output:

```text
Added account

  Email      : you@example.com
  Account ID : 8cd075d2-c767-41da-91d4-09ff5585276d
```

### 2. List saved accounts

```bash
./codex-auth-switch ls
```

Example:

```text
Saved accounts (2)

           Email            Account ID                            Last used
---------  ---------------  ------------------------------------  --------------------
[Current]  foo@example.com  8cd075d2-c767-41da-91d4-09ff5585276d  2026-04-04 21:10 local
           bar@example.com  a1b2c3d4-e5f6-7890-abcd-1234567890ef  2026-04-03 18:00 local

Tip: Run `use <email>` to switch accounts.
```

Columns: current marker, email label, `account_id`, and `last_used_at` in local time.

### 3. Switch the active account

Interactive:

```bash
./codex-auth-switch use
```

Direct:

```bash
./codex-auth-switch use foo@example.com
```

This writes the selected auth to `$CODEX_HOME/auth.json` (default: `~/.codex/auth.json`).

Example output:

```text
Active account

  Email      : foo@example.com
  Account ID : 8cd075d2-c767-41da-91d4-09ff5585276d
```

### 4. Remove an account

Interactive:

```bash
./codex-auth-switch remove
```

Direct:

```bash
./codex-auth-switch remove foo@example.com
```

Skip confirmation:

```bash
./codex-auth-switch remove foo@example.com --yes
```

Example output:

```text
Removed account

  Email      : foo@example.com
  Account ID : 8cd075d2-c767-41da-91d4-09ff5585276d
```

### 5. Check usage

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

▶ foo@example.com (Current)
  Observed email : admin@northview.jp
  Plan           : Pro
  5h limit       : 58% left (resets 14:00)
  Weekly limit   : 90% left (resets 15:00 on 11 Apr)

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

### `./codex-auth-switch remove [email] [--yes]`

Removes a saved account.

- With no `email`, opens an interactive selector
- Prompts for confirmation unless `--yes` is provided
- Removes the managed auth snapshot and the state entry
- If the target is the sole active account, also removes `$CODEX_HOME/auth.json`
- Refuses to remove the active account while other saved accounts still exist
- Fails if a Codex session appears to be running during sole-active removal

### `./codex-auth-switch usage [email] [--all] [--json]`

Reads usage information.

- No argument: current account
- `email`: specific account
- `--all`: all saved accounts
- `--json`: machine-readable output

`--all` continues even when individual accounts fail. If the fetched auth belongs to a different `account_id` than expected, that account is treated as an error (fail-closed).

If the upstream response reports a different email than the saved label, the output shows it as `Observed email`.

## Where Data Is Stored

Managed auth snapshots live outside the main Codex directory:

```text
~/.config/codex-auth-switch/
  state.json
  accounts/
    <profile_id>.json
```

- `email` — user-facing identifier (the label you pass to commands)
- `profileId` — internal primary key; auth file paths are derived from it at runtime

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
- Lock-file based concurrency control for `add`, `use`, and `remove`
- `0700` for directories, `0600` for auth files
- No logging of tokens or raw auth payloads
- Rollback on failed switch or removal when possible

> **Risk:** If `~/.config/codex-auth-switch/` is compromised, every saved session is exposed.

Please report security issues privately as described in [`SECURITY.md`](./SECURITY.md).

## Errors and Logs

Exit codes:

| Exit code | Meaning |
|-----------|---------|
| `1` | User input or validation failure |
| `2` | Local state, auth, or lock failure |
| `3` | External dependency failure |

Structured logs (JSON Lines on `stderr`, sensitive fields redacted):

```bash
CODEX_AUTH_SWITCH_LOG_LEVEL=debug ./codex-auth-switch usage --all
```

Available levels: `error`, `warn`, `info`, `debug`.
