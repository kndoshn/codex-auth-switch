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

- **File-backed auth only.** An omitted `cli_auth_credentials_store` uses Codex’s default file storage. You may also set `cli_auth_credentials_store = "file"` at the top level of `$CODEX_HOME/config.toml` (default: `~/.codex/config.toml`). Explicit Keyring and `"auto"` settings are unsupported; a leftover `auth.json` does not prove that auto selected file storage.
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

Codex defaults to file storage when the setting is omitted. To select it explicitly, put the following **before any `[table]` headings** in your Codex `config.toml`:

```toml
cli_auth_credentials_store = "file"
```

If you explicitly use `"auto"` or `"keyring"`, select `"file"` before switching. No configuration change is needed when the setting is omitted. The tool does not edit your configuration or migrate Keyring credentials. Close Codex before the first account is automatically activated or before switching accounts.

### 1. Add an account

```bash
./codex-auth-switch add you@example.com
```

This opens a temporary `codex login` flow and saves the resulting auth snapshot under that email label.

The temporary login explicitly uses file storage. If no account is currently active in this tool, the new account is automatically activated after the storage and running-process checks succeed. Later additions only save the new account.

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

Status                 Email            Account ID                            Last used
---------------------  ---------------  ------------------------------------  --------------------
[Selected] [Auth file]  foo@example.com  8cd075d2-c767-41da-91d4-09ff5585276d  2026-04-04 21:10 local
                       bar@example.com  a1b2c3d4-e5f6-7890-abcd-1234567890ef  2026-04-03 18:00 local

Selected: last account selected by this tool; not a live Codex status.
Auth file: account ID observed in $CODEX_HOME/auth.json; running Codex sessions may differ.
Tip: Run `use <email>` to switch accounts.
```

Columns: status markers, email label, `account_id`, and `last_used_at` in local time.

`[Selected]` comes from this tool's saved selection. `[Auth file]` matches the account ID read from `$CODEX_HOME/auth.json`. An external login can change the file without updating the saved selection; `ls` reports this mismatch without changing credentials or state. Neither marker inspects a running Codex process's cached credentials. With explicit auto or Keyring storage, the file may not be the credentials Codex uses. The former `[Current]` marker represented only the saved selection and could be misleading.

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

Account selected in this tool:

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

▶ foo@example.com (Selected)
  Observed email : admin@northview.jp
  Plan           : Pro
  5h limit       : [████████████░░░░░░░░] 58% left (resets 14:00)
  Weekly limit   : [██████████████████░░] 90% left (resets 15:00 on 11 Apr)

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
- Before initial auto-activation, requires file storage (explicit or the default) and no running Codex process; checks again after login
- Rolls back auth changes if initial activation or state persistence fails, when restoration is possible

### `./codex-auth-switch ls`

Lists all saved accounts.

### `./codex-auth-switch use [email]`

Switches the active account.

- With no `email`, opens an interactive selector
- With `email`, switches directly
- Fails if a Codex session appears to be running
- Requires file storage (explicit or the default); can restore a missing live `auth.json` from the saved account
- Syncs live auth into the saved account with the same Account ID before switching. If an external login changed the account, the old selection is not used as the destination. Unknown or ambiguous live identities stop the switch.

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

- No argument: account selected in this tool
- `email`: specific account
- `--all`: all saved accounts
- `--json`: machine-readable output

`--all` continues even when individual accounts fail. If the fetched auth belongs to a different `account_id` than expected, that account is treated as an error (fail-closed).

The selected account requires file storage (explicit or the default). If its live `auth.json` is missing, usage falls back to the managed snapshot. Invalid or unreadable live auth produces an error. A live account ID that differs from the selected account produces `auth_mismatch`; usage does not relabel another account's credentials. Unsupported active storage produces an error for that account while `--all` continues querying other saved accounts. `usage --all` marks the saved selection as `(Selected)`. Listing accounts remains available when the auth file is missing or invalid, and removing inactive accounts does not require access to the active Codex auth.

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
