import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, TraceEvent } from "./server";

const PAGE_SIZE = 50;
type EventCategory = "input" | "model" | "tools" | "other";

const categoryMeta: Record<EventCategory, { label: string; badge: string; bar: string }> = {
  input: { label: "INPUT", badge: "bg-primary/15 text-primary", bar: "bg-primary" },
  model: { label: "MODEL", badge: "bg-success/15 text-success", bar: "bg-success" },
  tools: { label: "TOOLS", badge: "bg-warning/15 text-warning", bar: "bg-warning" },
  other: { label: "OTHER", badge: "bg-muted text-muted-foreground", bar: "bg-muted-foreground" },
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleTimeString();
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  const seconds = Math.round(milliseconds / 1_000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function summarize(data: Record<string, unknown>): string {
  for (const key of ["text", "message", "reason", "error", "status", "title", "name"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim() !== "") {
      const text = value.replace(/\s+/g, " ").trim();
      return text.length > 240 ? `${text.slice(0, 240)}…` : text;
    }
  }
  const keys = Object.keys(data);
  return keys.length === 0 ? "No data" : `${keys.slice(0, 4).join(", ")}${keys.length > 4 ? "…" : ""}`;
}

function formatJson(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, null, 2) ?? "null";
  } catch {
    return "Unable to format event data.";
  }
}

function eventCategory(event: TraceEvent): EventCategory {
  const role = typeof event.data.role === "string" ? event.data.role : "";
  const value = `${event.type} ${role}`.toLowerCase();
  if (value.includes("tool")) return "tools";
  if (/user|input|prompt/.test(value)) return "input";
  if (/assistant|model|response|output/.test(value)) return "model";
  return "other";
}

function EventTimeline({ events }: { events: TraceEvent[] }) {
  return (
    <div className="shrink-0 border-b border-border py-1.5">
      {(["input", "model", "tools"] as const).map((category) => (
        <div key={category} className="grid grid-cols-[3.25rem_1fr] items-center gap-1 px-2">
          <span className="text-[9px] font-medium text-muted-foreground">{categoryMeta[category].label}</span>
          <div className="flex h-2 min-w-0 gap-px" aria-label={`${categoryMeta[category].label} timeline`}>
            {events.map((event) => (
              <span
                key={event.id}
                className={`min-w-px flex-1 rounded-sm ${eventCategory(event) === category ? categoryMeta[category].bar : "bg-transparent"}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventRow({ event }: { event: TraceEvent }) {
  const category = eventCategory(event);
  return (
    <li className="border-b border-border last:border-b-0">
      <details>
        <summary className="grid cursor-pointer list-none grid-cols-[2.5rem_5.5rem_minmax(0,1fr)_4.75rem] items-center gap-2 px-2 py-2 text-xs hover:bg-muted/50">
          <span className="text-right font-mono text-[10px] text-muted-foreground">#{event.seq}</span>
          <span className={`w-fit rounded px-1.5 py-0.5 text-[9px] font-semibold ${categoryMeta[category].badge}`}>
            {categoryMeta[category].label}
          </span>
          <span className="flex min-w-0 items-center gap-2 truncate text-foreground" title={`${event.type} · ${summarize(event.data)}`}>
            <code className="shrink-0 text-[10px] font-semibold">{event.type}</code>
            <span className="truncate text-muted-foreground">{summarize(event.data)}</span>
          </span>
          <time className="text-right text-[10px] text-muted-foreground">{formatTime(event.createdAt)}</time>
        </summary>
        <pre
          aria-label={`Formatted event data for sequence ${event.seq}`}
          className="mx-2 mb-2 overflow-x-auto rounded-md bg-muted p-3 text-[10px] leading-relaxed text-foreground"
        >
          {formatJson(event.data)}
        </pre>
      </details>
    </li>
  );
}

function TracePanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | EventCategory>("all");
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setLoading(true);
    setLoadingEarlier(false);
    setError(null);
    try {
      const result = await rpc.call("listEvents", { threadId, limit: PAGE_SIZE });
      if (requestId !== requestGeneration.current) return;
      setEvents(result.events);
      setHasMore(result.hasMore);
    } catch (cause) {
      if (requestId !== requestGeneration.current) return;
      setEvents([]);
      setHasMore(false);
      setError(errorMessage(cause));
    } finally {
      if (requestId === requestGeneration.current) setLoading(false);
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadEarlier = useCallback(async () => {
    if (loading || loadingEarlier || events.length === 0) return;
    const requestId = requestGeneration.current;
    setLoadingEarlier(true);
    setError(null);
    try {
      const result = await rpc.call("listEvents", {
        threadId,
        beforeSeq: events[0]!.seq,
        limit: PAGE_SIZE,
      });
      if (requestId !== requestGeneration.current) return;
      setEvents((current) => [...result.events, ...current]);
      setHasMore(result.hasMore);
    } catch (cause) {
      if (requestId === requestGeneration.current) setError(errorMessage(cause));
    } finally {
      if (requestId === requestGeneration.current) setLoadingEarlier(false);
    }
  }, [events, loading, loadingEarlier, rpc, threadId]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return events.filter((event) => {
      if (category !== "all" && eventCategory(event) !== category) return false;
      return normalizedQuery === "" || `${event.type} ${summarize(event.data)} ${formatJson(event.data)}`.toLowerCase().includes(normalizedQuery);
    });
  }, [category, events, query]);

  const duration = events.length > 1 ? events.at(-1)!.createdAt - events[0]!.createdAt : 0;
  const toolCount = events.filter((event) => eventCategory(event) === "tools").length;
  const busy = loading || loadingEarlier;

  return (
    <section aria-label="Thread trace" className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">Trace · {threadId}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{events.length} events · {toolCount} tools · {formatDuration(duration)}</span>
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted disabled:cursor-wait disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2">
        <select
          aria-label="Event filters"
          className="h-7 rounded border border-border bg-background px-2 text-xs text-foreground"
          value={category}
          onChange={(event) => setCategory(event.target.value as "all" | EventCategory)}
        >
          <option value="all">Event filters</option>
          <option value="input">Input</option>
          <option value="model">Model</option>
          <option value="tools">Tools</option>
          <option value="other">Other</option>
        </select>
        <input
          aria-label="Search trace events"
          className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Search events, tools, and messages"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <EventTimeline events={events} />

      <div className="grid shrink-0 grid-cols-[2.5rem_5.5rem_minmax(0,1fr)_4.75rem] gap-2 border-b border-border bg-muted/30 px-2 py-1 text-[9px] font-medium text-muted-foreground">
        <span className="text-right">#</span><span>ROLE</span><span>EVENT</span><span className="text-right">TIME</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p role="status" className="p-4 text-sm text-muted-foreground">Loading events…</p>
        ) : error !== null && events.length === 0 ? (
          <div className="space-y-2 p-4">
            <p role="alert" className="text-sm text-destructive">Unable to load trace: {error}</p>
            <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => void refresh()}>Retry</button>
          </div>
        ) : events.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No events recorded for this thread.</p>
        ) : filteredEvents.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No events match the current filters.</p>
        ) : (
          <ol aria-label="Thread events" className="m-0 list-none p-0">
            {filteredEvents.map((event) => <EventRow key={`${event.seq}-${event.id}`} event={event} />)}
          </ol>
        )}
        {error !== null && events.length > 0 ? <p role="alert" className="px-3 py-2 text-xs text-destructive">Could not load earlier events: {error}</p> : null}
      </div>

      {events.length > 0 && hasMore ? (
        <button
          type="button"
          className="m-2 shrink-0 rounded border border-border px-3 py-2 text-xs hover:bg-muted disabled:cursor-wait disabled:opacity-50"
          onClick={() => void loadEarlier()}
          disabled={busy}
        >
          {loadingEarlier ? "Loading earlier…" : "Load earlier"}
        </button>
      ) : null}
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "trace",
    title: "Trace",
    icon: "Workflow",
    component: TracePanel,
    layout: "flush",
  });
});
