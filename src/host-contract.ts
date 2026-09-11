import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { traceEventSchema, traceSourceStatusSchema } from "./trace-event";

export const traceHostContract = defineRpcContract({
  readEvents: {
    input: z
      .object({
        threadId: z.string().min(1),
        providerId: z.string().nullable(),
        providerThreadId: z.string().nullable(),
      })
      .strict(),
    output: z
      .object({
        status: traceSourceStatusSchema,
        events: z.array(traceEventSchema),
      })
      .strict(),
  },
});
