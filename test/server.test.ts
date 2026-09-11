import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

function event(seq: number, data: Record<string, unknown> = { text: `event ${seq}` }) {
  return {
    id: `event-${seq}`,
    scope: { kind: "thread" },
    threadId: "th_1",
    seq,
    createdAt: 1_700_000_000_000 + seq,
    type: seq % 2 === 0 ? "item/completed" : "item/started",
    data,
  };
}

describe("Trace RPC", () => {
  let dispose: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await dispose?.();
    dispose = undefined;
  });

  it("reads a bounded ascending page", async () => {
    const calls: unknown[] = [];
    const hostIds: string[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "trace",
      sdk: {
        system: { config: async () => ({ primaryHostId: "host_1" }) },
        threads: {
          get: async () => ({ providerId: "codex", host: { id: "host_remote" } }) as never,
          events: {
            list: async () => [event(0, { providerThreadId: "provider_1" })] as never,
          },
        },
      },
      experimental_callHostRpc: (call) => {
        calls.push(call.input);
        hostIds.push(call.hostId);
        return { status: "ok", events: [event(1), event(2), event(3)] };
      },
    });
    dispose = harness.lifecycle.dispose;
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("listEvents", {
        threadId: " th_1 ",
        limit: 2,
      }),
    ).resolves.toEqual({
      status: "ok",
      events: [event(1), event(2)],
      hasMore: true,
    });
    expect(calls).toEqual([
      {
        threadId: "th_1",
        providerId: "codex",
        providerThreadId: "provider_1",
      },
    ]);

    await expect(
      harness.behavior.callRpc("listEvents", {
        threadId: "th_1",
        afterSeq: 2,
        limit: 2,
      }),
    ).resolves.toEqual({
      status: "ok",
      events: [event(3)],
      hasMore: false,
    });
    expect(calls[1]).toEqual(calls[0]);
    expect(hostIds).toEqual(["host_remote", "host_remote"]);
  });

  it("searches nested event payloads across the full history", async () => {
    const calls: unknown[] = [];
    const rows = [
      event(1, { input: [{ type: "text", text: "needle from prompt" }] }),
      event(2, { nested: { message: "needle in payload" } }),
      event(3, { text: "other" }),
    ];
    const discovery = event(0, { providerThreadId: "provider_1" });
    const { bb, harness } = createFakePluginHost({
      pluginId: "trace",
      sdk: {
        system: { config: async () => ({ primaryHostId: "host_1" }) },
        threads: {
          get: async () => ({ providerId: "codex" }) as never,
          events: { list: async () => [discovery] as never },
        },
      },
      experimental_callHostRpc: (call) => {
        calls.push(call.input);
        return { status: "ok", events: rows };
      },
    });
    dispose = harness.lifecycle.dispose;
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("searchEvents", {
        threadId: " th_1 ",
        query: " NEEDLE ",
        limit: 1,
      }),
    ).resolves.toEqual({ status: "ok", events: [event(1, rows[0]!.data)], hasMore: true });

    await expect(
      harness.behavior.callRpc("searchEvents", {
        threadId: "th_1",
        query: "needle",
        afterSeq: 1,
        limit: 1,
      }),
    ).resolves.toEqual({ status: "ok", events: [event(2, rows[1]!.data)], hasMore: false });

    expect(calls).toEqual([
      { threadId: "th_1", providerId: "codex", providerThreadId: "provider_1" },
      { threadId: "th_1", providerId: "codex", providerThreadId: "provider_1" },
    ]);
  });

  it("reports an unsupported provider instead of returning a silent empty trace", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "trace",
      sdk: {
        system: { config: async () => ({ primaryHostId: "host_1" }) },
        threads: {
          get: async () => ({ providerId: "gemini" }) as never,
          events: { list: async () => [event(0, { providerThreadId: "provider_1" })] as never },
        },
      },
      experimental_callHostRpc: async () => ({ status: "unsupported", events: [] }),
    });
    dispose = harness.lifecycle.dispose;
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("listEvents", { threadId: "th_1", limit: 2 }),
    ).resolves.toEqual({ status: "unsupported", events: [], hasMore: false });
  });

  it("validates the page before touching the SDK", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "trace",
      sdk: {
        threads: {
          events: {
            list: async (input) => {
              calls.push(input);
              return [] as never;
            },
          },
        },
      },
    });
    dispose = harness.lifecycle.dispose;
    await plugin(bb);

    await expect(
      harness.behavior.callRpc("listEvents", { threadId: "", limit: 101 }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
