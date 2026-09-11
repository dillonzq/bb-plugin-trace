import { defineRpcContract, type BbPluginApi, type ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { traceHostContract } from "./src/host-contract";
import { searchableText } from "./src/raw-jsonl";
import {
  traceEventSchema,
  traceSourceStatusSchema,
  type TraceEvent,
  type TraceSourceStatus,
} from "./src/trace-event";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const listEventsInputSchema = z
  .object({
    threadId: z.string().trim().min(1).max(256),
    afterSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

const searchEventsInputSchema = z
  .object({
    threadId: z.string().trim().min(1).max(256),
    query: z.string().trim().min(1).max(500),
    afterSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export const rpcContract = defineRpcContract({
  listEvents: {
    input: listEventsInputSchema,
    output: z
      .object({
        status: traceSourceStatusSchema,
        events: z.array(traceEventSchema),
        hasMore: z.boolean(),
      })
      .strict(),
  },
  searchEvents: {
    input: searchEventsInputSchema,
    output: z
      .object({
        status: traceSourceStatusSchema,
        events: z.array(traceEventSchema),
        hasMore: z.boolean(),
      })
      .strict(),
  },
});

export type { TraceEvent, TraceSourceStatus } from "./src/trace-event";

function providerThreadId(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = providerThreadId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.providerThreadId === "string" && record.providerThreadId.trim() !== "") {
    return record.providerThreadId;
  }
  for (const child of Object.values(record)) {
    const found = providerThreadId(child, depth + 1);
    if (found) return found;
  }
  return null;
}

async function hostId(bb: BbPluginApi): Promise<string> {
  const config = (await bb.sdk.system.config()) as unknown as { primaryHostId?: unknown };
  if (typeof config.primaryHostId === "string" && config.primaryHostId.length > 0) {
    return config.primaryHostId;
  }
  const hosts = await bb.sdk.hosts.list();
  const host = hosts.find((candidate) => candidate.status === "connected") ?? hosts[0];
  if (!host) throw new Error("No connected host available for raw trace reading");
  return host.id;
}

async function rawEventsForThread(
  bb: BbPluginApi,
  traceHost: ExperimentalHostClient<typeof traceHostContract>,
  threadId: string,
): Promise<{ status: TraceSourceStatus; events: TraceEvent[] }> {
  const [thread, rows] = await Promise.all([
    bb.sdk.threads.get({ include: "environment,host", threadId }),
    bb.sdk.threads.events.list({ threadId, order: "asc", limit: "100" }),
  ]);
  const threadLocation = thread as typeof thread & {
    environment?: { hostId: string } | null;
    host?: { id: string } | null;
  };
  const providerId = threadLocation.providerId;
  const targetHostId =
    threadLocation.host?.id ??
    threadLocation.environment?.hostId ??
    (await hostId(bb));
  const providerIdFromEvents = rows
    .map((row) => providerThreadId(row.data))
    .find((value): value is string => value !== null) ?? null;
  if (providerIdFromEvents === null) {
    return { status: "unsupported", events: [] };
  }
  return traceHost.call(
    "readEvents",
    { threadId, providerId, providerThreadId: providerIdFromEvents },
    { hostId: targetHostId },
  );
}

function pageEvents(
  source: { status: TraceSourceStatus; events: TraceEvent[] },
  afterSeq: number | undefined,
  limit: number,
): { status: TraceSourceStatus; events: TraceEvent[]; hasMore: boolean } {
  const { events } = source;
  const eligible = afterSeq === undefined ? events : events.filter((event) => event.seq > afterSeq);
  return { status: source.status, events: eligible.slice(0, limit), hasMore: eligible.length > limit };
}

export default function plugin(bb: BbPluginApi): void {
  const traceHost = bb.hosts.experimental_client({ contract: traceHostContract });

  bb.rpc.register(rpcContract, {
    async listEvents({ threadId, afterSeq, limit }) {
      return pageEvents(await rawEventsForThread(bb, traceHost, threadId), afterSeq, limit);
    },
    async searchEvents({ threadId, query, afterSeq, limit }) {
      const needle = query.toLowerCase();
      const source = await rawEventsForThread(bb, traceHost, threadId);
      return pageEvents(
        { ...source, events: source.events.filter((event) => searchableText(event).includes(needle)) },
        afterSeq,
        limit,
      );
    },
  });
}
