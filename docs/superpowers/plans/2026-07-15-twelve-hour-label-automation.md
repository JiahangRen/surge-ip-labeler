# Twelve-Hour Label Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** run the Sub-Store label scan twice per day and safely reflect its completed Worker snapshot in Surge's local `ip-labels.conf`.

**Architecture:** keep the installed Sub-Store daily 23:55 cron and add the same official artifact-sync script at 11:55. A user LaunchAgent runs the existing validated mirror CLI every 12 hours and refreshes the local Surge external resource only after the CLI succeeds.

**Tech Stack:** Surge cron scripts, macOS launchd, Node.js, `surge-cli`, Cloudflare Worker/KV.

## Global Constraints

- Never place `READ_TOKEN`, `SYNC_TOKEN`, subscription URLs, or proxy descriptors in a config, log, or repository file.
- Keep the existing `23:55` Sub-Store cron intact; add only `11:55` to obtain a 12-hour cadence.
- The mirror must preserve the previous `ip-labels.conf` when download or Surge validation fails.
- Refresh only the local `ip-labels.conf` resource; do not reload the full Surge profile from the automated task.

---

### Task 1: Add the second Sub-Store scan schedule

**Files:**
- Modify: `/Users/jeffereyreng/Library/Application Support/Surge/Profiles/surge-config-optimized.conf`

**Interfaces:**
- Consumes: Sub-Store's official `cron-sync-artifacts.min.js` script.
- Produces: a `type=cron` task at `55 11 * * *`.

- [ ] Add the following `[Script]` entry without replacing the module-provided 23:55 entry:

```ini
Sub-Store IP Labeler Midday Sync = type=cron,cronexp=55 11 * * *,wake-system=1,timeout=900,script-path=https://github.com/sub-store-org/Sub-Store/releases/latest/download/cron-sync-artifacts.min.js
```

- [ ] Run `surge-cli --check` and reload only after it reports `OK`.
- [ ] Verify the effective profile contains both `55 11 * * *` and `55 23 * * *` schedules.

### Task 2: Install the 12-hour local mirror LaunchAgent

**Files:**
- Create: `/Users/jeffereyreng/Library/Application Support/Surge/Scripts/sync-ip-labels.sh`
- Create: `/Users/jeffereyreng/Library/LaunchAgents/com.jiahangren.surge-ip-labeler.plist`

**Interfaces:**
- Consumes: `scripts/sync-local-policy-file.mjs`, macOS Keychain service `surge-ip-labeler-read-token`, and local resource key `d8d090b2170f2ddcd948ea6f2721a0cd`.
- Produces: an atomic local policy mirror refresh every 43,200 seconds.

- [ ] Create the shell wrapper:

```sh
#!/bin/zsh
set -eu
/opt/homebrew/bin/node /Users/jeffereyreng/Documents/surge模块/.worktrees/surge-ip-labeler/scripts/sync-local-policy-file.mjs --output /Users/jeffereyreng/Library/Application\ Support/Surge/Profiles/ip-labels.conf --keychain-account jeffereyreng
/opt/homebrew/bin/surge-cli external-resource update d8d090b2170f2ddcd948ea6f2721a0cd
```

- [ ] Create a LaunchAgent that runs the wrapper at load and each `43200` seconds, with stdout/stderr restricted to the Surge Scripts directory.
- [ ] Bootstrap the agent with `launchctl bootstrap gui/$(id -u)` and run it once with `launchctl kickstart`.
- [ ] Verify the local resource remains `ready = 1` and the wrapper output contains only policy counts.
