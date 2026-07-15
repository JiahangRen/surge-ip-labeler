# Local Surge Policy Mirror Plan

> **For Codex:** execute this plan with test-first changes. Do not alter the live Surge profile until a generated snapshot passes `surge-cli --check`.

**Goal:** mirror the Worker snapshot to a local Surge policy file, validating before an atomic replacement so failed requests never break the last working local copy.

**Design:** a small Node CLI obtains the read token from macOS Keychain, downloads the Worker subscription without using a system HTTP proxy, verifies non-empty Surge policy lines, validates a temporary wrapper configuration through `surge-cli --check`, then atomically replaces the output file.

## Steps

1. Add unit tests for validation-profile construction and write-on-success-only behavior.
2. Implement the testable mirror core and the Node CLI wrapper.
3. Document safe keychain setup, manual sync, and a non-routing test group before production replacement.
4. Run tests and static whitespace checks. Do not install or edit the active Surge profile automatically.
