import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

function event(seq: number) {
  return {
    id: `event-${seq}`,
    scope: { kind: "thread" },
    threadId: "th_1",
    seq,
    createdAt: 1_700_000_000_000 + seq,
    type: seq % 2 === 0 ? "item/completed" : "item/started",
    data: { text: `event ${seq}` },
  };
}

describe("Trace RPC", () => {
  let dispose: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await dispose?.();
    dispose = undefined;
  });

  it("reads a bounded descending page and returns it in display order", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "trace",
      sdk: {
        threads: {
          events: {
            list: async (input) => {
              calls.push(input);
              return [event(5), event(4), event(3)] as never;
            },
          },
        },
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
      events: [event(4), event(5)],
      hasMore: true,
    });
    expect(calls).toEqual([
      {
        threadId: "th_1",
        order: "desc",
        limit: "3",
      },
    ]);
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
