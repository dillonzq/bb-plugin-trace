## What you get

Open **Trace** from any thread's side panel to inspect the original agent JSONL trace for that conversation. A compact ledger shows event sequence, category, summary, and timestamp, while input, model, and tool lanes provide a quick visual map of the trajectory.

Search event types and nested payloads across the full thread, filter by category, expand an event to inspect its formatted JSON, or load later pages without leaving the thread.

## How it works

Trace uses BB's Plugin SDK only to resolve the provider session, then reads and parses its matching local JSONL file through the connected host. It keeps the original records, does not maintain a separate database, and does not upload event data.

## Requirements

Requires BB 0.42 or newer. Event payloads may contain sensitive prompts, tool inputs, and paths, so review them before sharing screenshots or copied JSON.
