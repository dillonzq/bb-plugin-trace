## What you get

Open **Trace** from any thread's side panel to inspect the native event history BB recorded for that conversation. A compact ledger shows event sequence, category, summary, and timestamp, while input, model, and tool lanes provide a quick visual map of the trajectory.

Search event types and nested payloads across the full thread, filter by category, expand an event to inspect its formatted JSON, or load later pages without leaving the thread.

## How it works

Trace reads the selected thread through BB's Plugin SDK. It does not scan agent session directories, maintain a separate database, or upload event data. The native BB event stream remains the source of truth.

## Requirements

Requires BB 0.42 or newer. Event payloads may contain sensitive prompts, tool inputs, and paths, so review them before sharing screenshots or copied JSON.
