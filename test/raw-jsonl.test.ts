import { describe, expect, it } from "vitest";
import { parseJsonl } from "../src/raw-jsonl";

describe("raw JSONL parser", () => {
  it("keeps the original record and derives the event type and timestamp", () => {
    const events = parseJsonl(
      [
        JSON.stringify({
          timestamp: "2026-09-11T00:43:45.000Z",
          type: "event_msg",
          payload: { type: "task_started", thread_id: "provider_1" },
        }),
        "incomplete",
      ].join("\n"),
      { threadId: "th_1" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      threadId: "th_1",
      seq: 1,
      type: "event_msg/task_started",
      createdAt: Date.parse("2026-09-11T00:43:45.000Z"),
      data: {
        type: "event_msg",
        payload: { type: "task_started", thread_id: "provider_1" },
      },
    });
  });
});
