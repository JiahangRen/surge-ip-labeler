# First Scan Scheduling Design

## Goal

Start the first installed Surge IP Labeler scan within one minute, while preserving a six-hour interval between actual scans.

## Design

The module will schedule its script every minute. Before a scan, the script reads `nextScanAt` from Surge persistent storage. A missing or expired value permits a scan; a future value returns immediately and makes no network request. After a completed scan, or a Net.Coffee circuit-breaker deferral, the script stores a timestamp six hours in the future.

This preserves the existing serial lookup, cache, and circuit-breaker rules. The only new network behavior is the initial scan after module installation; minute-level invocations that are not due are local no-ops.

## Validation

Unit tests will prove that a future timestamp skips the source fetch, and that a completed scan schedules the next actual scan six hours later. The full test suite must pass before publication.
