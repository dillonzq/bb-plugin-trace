// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../app"));
const panel = app.threadPanelActions[0]!;

const row = (seq: number, threadId = "th_1", turn?: number) => ({
  id: `event-${seq}`,
  scope: { kind: "thread" as const },
  threadId,
  seq,
  createdAt: 1_700_000_000_000 + seq,
  type: `event/${seq}`,
  data: { message: `message ${seq}`, nested: { seq }, ...(turn === undefined ? {} : { turn }) },
});

afterEach(cleanup);

describe("Trace panel", () => {
  it("shows the thread, events, formatted data, and later pages", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const searchCalls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      panel,
      { threadId: "th_1", params: null },
      {
        rpc: {
          listEvents: (input) => {
            calls.push(input as Record<string, unknown>);
            return (input as { afterSeq?: number }).afterSeq === 2
              ? { events: [row(3), row(4)], hasMore: false }
              : { events: [row(1), row(2)], hasMore: true };
          },
          searchEvents: (input) => {
            searchCalls.push(input as Record<string, unknown>);
            return { events: [row(4)], hasMore: false };
          },
        },
      },
    );

    expect(slot.getByRole("status").textContent).toContain("Loading events");
    await slot.findByText("Trace");
    expect(slot.getByText("event/1")).toBeTruthy();
    expect(slot.getByText("#1")).toBeTruthy();
    expect(slot.queryByText("#3")).toBeNull();
    expect(slot.getByText("message 1")).toBeTruthy();

    fireEvent.click(slot.getByText("event/1"));
    expect(
      (await slot.findByLabelText("Formatted event data for sequence 1")).textContent,
    ).toContain('"nested"');

    const ledger = slot.getByLabelText("Trajectory event ledger");
    Object.defineProperties(ledger, {
      scrollTop: { configurable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(ledger);
    await waitFor(() => expect(calls.some((input) => input.afterSeq === 2)).toBe(true));
    await slot.findByText("event/4");

    fireEvent.change(slot.getByRole("searchbox", { name: "Search trace events" }), {
      target: { value: "prompt from the first turn" },
    });
    await waitFor(() => expect(searchCalls).toHaveLength(1));
    expect(slot.getByText("event/4")).toBeTruthy();
    expect(slot.queryByText("event/2")).toBeNull();
  });

  it("renders a first event that starts a turn", async () => {
    const slot = renderSlot(
      panel,
      { threadId: "th_turn", params: null },
      { rpc: { listEvents: () => ({ events: [row(1, "th_turn", 1)], hasMore: false }) } },
    );

    await slot.findByText("event/1");
    expect(slot.getByLabelText("Trajectory timeline")).toBeTruthy();
  });

  it("uses nested raw message roles before event type heuristics", async () => {
    const nestedUser = {
      ...row(1, "th_nested_role"),
      type: "response_item/message",
      data: { payload: { type: "message", role: "user", content: [{ type: "text", text: "hello" }] } },
    };
    const slot = renderSlot(
      panel,
      { threadId: "th_nested_role", params: null },
      { rpc: { listEvents: () => ({ events: [nestedUser], hasMore: false }) } },
    );

    await slot.findByText("response_item/message");
    expect(slot.getByText("USER")).toBeTruthy();
  });

  it("shortens long non-role event types to fit the role column", async () => {
    const slot = renderSlot(
      panel,
      { threadId: "th_long_kind", params: null },
      {
        rpc: {
          listEvents: () => ({
            events: [
              { ...row(1, "th_long_kind"), type: "token_usage_record" },
              { ...row(2, "th_long_kind"), type: "event_msg/item_completed" },
              { ...row(3, "th_long_kind"), type: "event_msg/token_count" },
              { ...row(4, "th_long_kind"), type: "event/4" },
              { ...row(5, "th_long_kind"), type: "anextremelylongsinglewordtype" },
            ],
            hasMore: false,
          }),
        },
      },
    );

    await slot.findByText("token_usage_record");
    expect(slot.getByText("TOKEN")).toBeTruthy();
    expect(slot.getByText("ITEM")).toBeTruthy();
    expect(slot.getByText("TOKEN_COUNT")).toBeTruthy();
    expect(slot.getByText("EVENT/4")).toBeTruthy();
    expect(slot.getByText("ANEXTREMELYL")).toBeTruthy();
  });

  it("shows pi bridge usage in Timing and hides empty fields", async () => {
    const piAssistant = {
      ...row(1, "th_pi_timing"),
      type: "message",
      data: { message: { role: "assistant", content: [{ type: "text", text: "hi" }], model: "glm-5.3-flash", usage: { input: 1234, output: 56 } } },
    };
    const slot = renderSlot(
      panel,
      { threadId: "th_pi_timing", params: null },
      { rpc: { listEvents: () => ({ events: [piAssistant], hasMore: false }) } },
    );

    await slot.findByText("message");
    fireEvent.click(slot.getByText("message"));
    fireEvent.click(await slot.findByText("Timing"));
    const inspector = await slot.findByLabelText("Selected event inspector");
    expect(inspector.textContent).toContain("glm-5.3-flash");
    expect(inspector.textContent).toContain("1,234");
    expect(inspector.textContent).toContain("56");
    expect(inspector.textContent).not.toContain("—");
  });

  it("keeps pagination available when a category hides the current page", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const slot = renderSlot(
      panel,
      { threadId: "th_filter", params: null },
      {
        rpc: {
          listEvents: (input) => {
            calls.push(input as Record<string, unknown>);
            return (input as { afterSeq?: number }).afterSeq === 2
              ? { events: [row(3, "th_filter")], hasMore: false }
              : { events: [row(1, "th_filter"), row(2, "th_filter")], hasMore: true };
          },
        },
      },
    );

    await slot.findByText("event/1");
    fireEvent.click(slot.getByRole("button", { name: "Event filters" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Input" }));
    await waitFor(() => expect(calls.some((input) => input.afterSeq === 2)).toBe(true));
    expect(slot.queryByRole("button", { name: "Load later" })).toBeNull();
  });

  it("stops automatic pagination after a page-load error", async () => {
    let laterCalls = 0;
    const slot = renderSlot(
      panel,
      { threadId: "th_load_error", params: null },
      {
        rpc: {
          listEvents: (input) => {
            if ((input as { afterSeq?: number }).afterSeq !== undefined) {
              laterCalls += 1;
              throw new Error("page unavailable");
            }
            return { events: [row(1, "th_load_error"), row(2, "th_load_error")], hasMore: true };
          },
        },
      },
    );

    await slot.findByText("event/1");
    const ledger = slot.getByLabelText("Trajectory event ledger");
    Object.defineProperties(ledger, {
      scrollTop: { configurable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(ledger);
    await slot.findByRole("alert");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(laterCalls).toBe(1);

    fireEvent.click(slot.getByRole("button", { name: "Event filters" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Input" }));
    await waitFor(() => expect(laterCalls).toBe(2));
  });

  it("does not let an old page-load error block a new search", async () => {
    let rejectLater!: (cause: Error) => void;
    const later = new Promise<{ events: ReturnType<typeof row>[]; hasMore: boolean }>((_, reject) => {
      rejectLater = reject;
    });
    const slot = renderSlot(
      panel,
      { threadId: "th_search_context", params: null },
      {
        rpc: {
          listEvents: (input) => {
            return (input as { afterSeq?: number }).afterSeq === undefined
              ? { events: [row(1, "th_search_context"), row(2, "th_search_context")], hasMore: true }
              : later;
          },
          searchEvents: () => ({ events: [row(9, "th_search_context")], hasMore: false }),
        },
      },
    );

    await slot.findByText("event/1");
    const ledger = slot.getByLabelText("Trajectory event ledger");
    Object.defineProperties(ledger, {
      scrollTop: { configurable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(ledger);
    fireEvent.change(slot.getByRole("searchbox", { name: "Search trace events" }), { target: { value: "needle" } });
    await slot.findByText("event/9");
    rejectLater(new Error("stale page unavailable"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("does not let an old page-load error block a new filter", async () => {
    let rejectLater!: (cause: Error) => void;
    let laterCalls = 0;
    const later = new Promise<{ events: ReturnType<typeof row>[]; hasMore: boolean }>((_, reject) => {
      rejectLater = reject;
    });
    const slot = renderSlot(
      panel,
      { threadId: "th_filter_context", params: null },
      {
        rpc: {
          listEvents: (input) => {
            if ((input as { afterSeq?: number }).afterSeq === undefined) {
              return { events: [row(1, "th_filter_context"), row(2, "th_filter_context")], hasMore: true };
            }
            laterCalls += 1;
            return laterCalls === 1 ? later : { events: [row(3, "th_filter_context")], hasMore: false };
          },
        },
      },
    );

    await slot.findByText("event/1");
    const ledger = slot.getByLabelText("Trajectory event ledger");
    Object.defineProperties(ledger, {
      scrollTop: { configurable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(ledger);
    fireEvent.click(slot.getByRole("button", { name: "Event filters" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Input" }));
    rejectLater(new Error("stale page unavailable"));
    await waitFor(() => expect(laterCalls).toBe(2));
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("does not let an old list page clear new search loading", async () => {
    let resolveListLater!: (value: { events: ReturnType<typeof row>[]; hasMore: boolean }) => void;
    const listLater = new Promise<{ events: ReturnType<typeof row>[]; hasMore: boolean }>((resolve) => {
      resolveListLater = resolve;
    });
    let resolveSearchPage!: (value: { events: ReturnType<typeof row>[]; hasMore: boolean }) => void;
    const searchPage = new Promise<{ events: ReturnType<typeof row>[]; hasMore: boolean }>((resolve) => {
      resolveSearchPage = resolve;
    });
    let searchPageCalls = 0;
    const searchEvent = { ...row(9, "th_loading_context"), type: "assistant/output", data: { role: "assistant", text: "match" } };
    const slot = renderSlot(
      panel,
      { threadId: "th_loading_context", params: null },
      {
        rpc: {
          listEvents: (input) => (input as { afterSeq?: number }).afterSeq === undefined
            ? { events: [row(1, "th_loading_context"), row(2, "th_loading_context")], hasMore: true }
            : listLater,
          searchEvents: (input) => {
            if ((input as { afterSeq?: number }).afterSeq !== undefined) {
              searchPageCalls += 1;
              return searchPage;
            }
            return { events: [searchEvent], hasMore: true };
          },
        },
      },
    );

    await slot.findByText("event/1");
    const ledger = slot.getByLabelText("Trajectory event ledger");
    Object.defineProperties(ledger, {
      scrollTop: { configurable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(ledger);
    fireEvent.change(slot.getByRole("searchbox", { name: "Search trace events" }), { target: { value: "needle" } });
    await slot.findByText("assistant/output");
    fireEvent.click(slot.getByRole("button", { name: "Event filters" }));
    fireEvent.click(slot.getByRole("checkbox", { name: "Input" }));
    await waitFor(() => expect(searchPageCalls).toBe(1));

    resolveListLater({ events: [row(3, "th_loading_context")], hasMore: true });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(searchPageCalls).toBe(1);
    resolveSearchPage({ events: [], hasMore: false });
  });

  it("ignores a later-page response after the thread changes", async () => {
    let resolveLater!: (value: { events: ReturnType<typeof row>[]; hasMore: boolean }) => void;
    const later = new Promise<{ events: ReturnType<typeof row>[]; hasMore: boolean }>((resolve) => {
      resolveLater = resolve;
    });
    const slot = renderSlot(
      panel,
      { threadId: "th_1", params: null },
      {
        rpc: {
          listEvents: (input) => {
            const request = input as { threadId: string; afterSeq?: number };
            if (request.afterSeq !== undefined) return later;
            return request.threadId === "th_2"
              ? { events: [row(20, "th_2")], hasMore: false }
              : { events: [row(1), row(2)], hasMore: true };
          },
        },
      },
    );

    await slot.findByText("event/1");
    const ledger = slot.getByLabelText("Trajectory event ledger");
    Object.defineProperties(ledger, {
      scrollTop: { configurable: true, value: 1_000 },
      scrollHeight: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 300 },
    });
    fireEvent.scroll(ledger);
    expect(slot.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", true);

    slot.lifecycle.rerender(createElement(panel.component, { threadId: "th_2", params: null }));
    await slot.findByText("event/20");
    resolveLater({ events: [row(3)], hasMore: false });

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
