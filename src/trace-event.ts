import { z } from "zod";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread") }).strict(),
  z.object({ kind: z.literal("turn"), turnId: z.string() }).strict(),
]);

export const traceEventSchema = z
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

export type TraceEvent = z.infer<typeof traceEventSchema>;

export const traceSourceStatusSchema = z.enum(["ok", "generic", "not_found", "unsupported"]);
export type TraceSourceStatus = z.infer<typeof traceSourceStatusSchema>;
