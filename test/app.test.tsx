// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../app"));
const panel = app.threadPanelActions[0]!;

const row = (seq: number, threadId = "th_1") => ({
  id: `event-${seq}`,
  scope: { kind: "thread" as const },
  threadId,
  seq,
  createdAt: 1_700_000_000_000 + seq,
  type: `event/${seq}`,
  data: { message: `message ${seq}`, nested: { seq } },
});

afterEach(cleanup);

describe("Trace panel", () => {
  it("shows the thread, events, formatted data, and earlier pages", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      panel,
      { threadId: "th_1", params: null },
      {
        rpc: {
          listEvents: (input) => {
            calls.push(input as Record<string, unknown>);
            return (input as { beforeSeq?: number }).beforeSeq === 3
              ? { events: [row(1), row(2)], hasMore: false }
              : { events: [row(3), row(4)], hasMore: true };
          },
        },
      },
    );

    expect(slot.getByRole("status").textContent).toContain("Loading events");
    await slot.findByText("Trace · th_1");
    expect(slot.getByText("event/3")).toBeTruthy();
    expect(slot.getByText("message 3")).toBeTruthy();

    fireEvent.click(slot.getByText("event/3"));
    expect(
      (await slot.findByLabelText("Formatted event data for sequence 3")).textContent,
    ).toContain('"nested"');

    fireEvent.click(slot.getByRole("button", { name: "Load earlier" }));
    await waitFor(() => expect(calls.some((input) => input.beforeSeq === 3)).toBe(true));
    await slot.findByText("event/1");

    fireEvent.change(slot.getByRole("searchbox", { name: "Search trace events" }), {
      target: { value: "message 1" },
    });
    expect(slot.getByText("event/1")).toBeTruthy();
    expect(slot.queryByText("event/4")).toBeNull();
  });

  it("ignores an earlier-page response after the thread changes", async () => {
    let resolveEarlier!: (value: { events: ReturnType<typeof row>[]; hasMore: boolean }) => void;
    const earlier = new Promise<{ events: ReturnType<typeof row>[]; hasMore: boolean }>((resolve) => {
      resolveEarlier = resolve;
    });
    const slot = renderSlot(
      panel,
      { threadId: "th_1", params: null },
      {
        rpc: {
          listEvents: (input) => {
            const request = input as { threadId: string; beforeSeq?: number };
            if (request.beforeSeq !== undefined) return earlier;
            return request.threadId === "th_2"
              ? { events: [row(20, "th_2")], hasMore: false }
              : { events: [row(3), row(4)], hasMore: true };
          },
        },
      },
    );

    await slot.findByText("event/3");
    fireEvent.click(slot.getByRole("button", { name: "Load earlier" }));
    expect(slot.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", true);

    slot.lifecycle.rerender(createElement(panel.component, { threadId: "th_2", params: null }));
    await slot.findByText("event/20");
    resolveEarlier({ events: [row(1)], hasMore: false });

    await waitFor(() => expect(slot.queryByText("event/1")).toBeNull());
    expect(slot.getByText("event/20")).toBeTruthy();
  });

  it("shows empty and error states", async () => {
    const empty = renderSlot(
      panel,
      { threadId: "th_empty", params: null },
      { rpc: { listEvents: () => ({ events: [], hasMore: false }) } },
    );
    await empty.findByText("No events recorded for this thread.");
    empty.unmount();

    const failed = renderSlot(
      panel,
      { threadId: "th_error", params: null },
      {
        rpc: {
          listEvents: () => {
            throw new Error("backend unavailable");
          },
        },
      },
    );
    expect((await failed.findByRole("alert")).textContent).toContain("backend unavailable");
    expect(failed.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
