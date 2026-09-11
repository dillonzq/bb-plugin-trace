import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const SEARCH_SCAN_PAGE_SIZE = 100;

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread") }).strict(),
  z.object({ kind: z.literal("turn"), turnId: z.string() }).strict(),
]);

const traceEventSchema = z
  .object({
    id: z.string(),
    scope: scopeSchema,
    threadId: z.string(),
    seq: z.number().int().nonnegative(),
    createdAt: z.number().finite(),
    type: z.string(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

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
        events: z.array(traceEventSchema),
        hasMore: z.boolean(),
      })
      .strict(),
  },
  searchEvents: {
    input: searchEventsInputSchema,
    output: z
      .object({
        events: z.array(traceEventSchema),
        hasMore: z.boolean(),
      })
      .strict(),
  },
});

export type TraceEvent = z.infer<typeof traceEventSchema>;
type SdkEventRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>[number];

function toTraceEvent(row: SdkEventRow): TraceEvent {
  return {
    id: row.id,
    scope:
      row.scope.kind === "turn"
        ? { kind: "turn", turnId: row.scope.turnId }
        : { kind: "thread" },
    threadId: row.threadId,
    seq: row.seq,
    createdAt: row.createdAt,
    type: row.type,
    data: row.data as Record<string, unknown>,
  };
}

function searchableText(row: SdkEventRow): string {
  try {
    return JSON.stringify(row).toLowerCase();
  } catch {
    return `${row.id} ${row.type}`.toLowerCase();
  }
}

export default function plugin(bb: BbPluginApi): void {
  bb.rpc.register(rpcContract, {
    async listEvents({ threadId, afterSeq, limit }) {
      const rows = await bb.sdk.threads.events.list({
        threadId,
        order: "asc",
        limit: String(limit + 1),
        ...(afterSeq === undefined ? {} : { afterSeq: String(afterSeq) }),
      });
      const hasMore = rows.length > limit;
      return {
        events: rows.slice(0, limit).map(toTraceEvent),
        hasMore,
      };
    },
    async searchEvents({ threadId, query, afterSeq, limit }) {
      const needle = query.toLowerCase();
      const matches: TraceEvent[] = [];
      let cursor = afterSeq;
      let hasMore = false;

      for (;;) {
        const rows = await bb.sdk.threads.events.list({
          threadId,
          order: "asc",
          limit: String(SEARCH_SCAN_PAGE_SIZE),
          ...(cursor === undefined ? {} : { afterSeq: String(cursor) }),
        });

        for (const row of rows) {
          cursor = row.seq;
          if (!searchableText(row).includes(needle)) continue;
          if (matches.length < limit) {
            matches.push(toTraceEvent(row));
          } else {
            hasMore = true;
            break;
          }
        }

        if (hasMore || rows.length < SEARCH_SCAN_PAGE_SIZE) break;
      }

      return { events: matches, hasMore };
    },
  });
}
