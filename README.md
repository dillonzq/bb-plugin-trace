# Trace for BB

Inspect the original agent JSONL trace for the current [BB](https://github.com/get-bb/bb) thread from its side panel.

Trace presents the raw event stream as a compact trajectory explorer with:

- event, tool, and duration summaries;
- input, model, and tool timeline lanes;
- event-category filters and payload search;
- expandable raw JSON payloads;
- ascending pagination from the first event through the latest event;
- full-history search across event types and nested payloads.

Trace resolves the provider session through BB's Plugin SDK, then reads and parses the matching local JSONL file on the connected host. It keeps the original records, does not create a separate index, and does not send trace data elsewhere.

## Install

```sh
bb plugin install https://github.com/dillonzq/bb-plugin-trace
```

Open any thread, open the side panel actions, and select **Trace**.

## Development

Requires BB 0.42 or newer and Node.js 22 or newer.

```sh
npm install
npm run typecheck
npm test
bb plugin build .
bb plugin install path:$PWD
```

After editing an installed local copy, run `bb plugin reload trace`.

## Privacy

Event payloads can contain prompts, tool inputs, paths, or other sensitive data. Trace displays them only inside the local BB plugin panel. Review payloads before sharing screenshots or copied JSON.

## License

[MIT](LICENSE)
