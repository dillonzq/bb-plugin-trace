import type { TraceEvent } from "./trace-event";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function timestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 100_000_000_000 ? value * 1_000 : value;
  }
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventType(record: JsonObject): string {
  const payload = isObject(record.payload) ? record.payload : null;
  const outer = stringValue(record.type);
  const inner = payload ? stringValue(payload.type) : null;
  if (outer && inner) return `${outer}/${inner}`;
  return outer ?? inner ?? "record";
}

function eventTimestamp(record: JsonObject, fallback: number): number {
  const payload = isObject(record.payload) ? record.payload : null;
  return (
    timestampMs(record.timestamp) ??
    timestampMs(record.time) ??
    timestampMs(record.createdAt) ??
    (payload ? timestampMs(payload.timestamp) : null) ??
    (payload ? timestampMs(payload.time) : null) ??
    fallback
  );
}

export function parseJsonl(
  content: string,
  input: { threadId: string; fallbackTimestamp?: number },
): TraceEvent[] {
  const fallbackTimestamp = input.fallbackTimestamp ?? 0;
  const events: TraceEvent[] = [];

  for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Active JSONL files can end with an incomplete line; skip that line.
      continue;
    }
    const data = isObject(parsed) ? parsed : { value: parsed };
    const seq = lineIndex + 1;
    events.push({
      id: `${input.threadId}:jsonl:${seq}`,
      scope: { kind: "thread" },
      threadId: input.threadId,
      seq,
      createdAt: eventTimestamp(data, fallbackTimestamp + lineIndex),
      type: eventType(data),
      data,
    });
  }

  return events;
}

export function searchableText(event: TraceEvent): string {
  try {
    return JSON.stringify(event).toLowerCase();
  } catch {
    return `${event.id} ${event.type}`.toLowerCase();
  }
}
