import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, TraceEvent, TraceSourceStatus } from "./server";

const PAGE_SIZE = 50;
type EventCategory = "input" | "model" | "tools" | "other";
type InspectorTab = "json" | "raw" | "timing";
type TimelineLane = "input" | "model" | "tools";

const categoryMeta: Record<EventCategory, { label: string; badge: string; bar: string }> = {
  input: { label: "INPUT", badge: "bg-primary/15 text-primary", bar: "bg-primary" },
  model: { label: "MODEL", badge: "bg-violet-500/15 text-violet-300", bar: "bg-violet-400" },
  tools: { label: "TOOLS", badge: "bg-warning/15 text-warning", bar: "bg-warning" },
  other: { label: "OTHER", badge: "bg-muted text-muted-foreground", bar: "bg-muted-foreground" },
};

const laneLabels: Record<TimelineLane, string> = {
  input: "Input",
  model: "Model",
  tools: "Tools",
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function stringValue(data: unknown, ...keys: string[]): string | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = stringValue(item, ...keys);
      if (found !== null) return found;
    }
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  for (const value of Object.values(record)) {
    const found = stringValue(value, ...keys);
    if (found !== null) return found;
  }
  return null;
}

function numberValue(data: unknown, ...keys: string[]): number | null {
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = numberValue(item, ...keys);
      if (found !== null) return found;
    }
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  for (const value of Object.values(record)) {
    const found = numberValue(value, ...keys);
    if (found !== null) return found;
  }
  return null;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}

function formatDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "—";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1_000;
  return seconds < 60
    ? `${seconds.toFixed(1)} s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

const summaryKeys = ["text", "prompt", "input", "message", "content", "command", "reason", "error", "item", "status", "title", "name"];

function findSummaryText(value: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  if (typeof value === "string" && value.trim() !== "") return value.replace(/\s+/g, " ").trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = findSummaryText(item, depth + 1);
      if (text !== null) return text;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of summaryKeys) {
    if (!(key in object)) continue;
    const text = findSummaryText(object[key], depth + 1);
    if (text !== null) return text;
  }
  for (const item of Object.values(object)) {
    const text = findSummaryText(item, depth + 1);
    if (text !== null) return text;
  }
  return null;
}

function summarize(data: Record<string, unknown>): string {
  const text = findSummaryText(data);
  if (text !== null) return text.length > 240 ? `${text.slice(0, 240)}…` : text;
  const keys = Object.keys(data);
  return keys.length === 0 ? "No payload" : keys.slice(0, 4).join(", ") + (keys.length > 4 ? "…" : "");
}

function formatJson(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data, null, 2) ?? "null";
  } catch {
    return "Unable to format event data.";
  }
}

function eventRole(event: TraceEvent): "user" | "assistant" | "tool" | "context" | "other" {
  const role = stringValue(event.data, "role")?.toLowerCase() ?? "";
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "developer" || role === "system") return "context";

  const value = `${event.type} ${stringValue(event.data, "type") ?? ""}`.toLowerCase();
  if (role.includes("tool") || value.includes("tool") || /function[_/]/.test(value)) return "tool";
  if (/input|prompt|request/.test(value)) return "user";
  if (/assistant|model|response|output/.test(value)) return "assistant";
  if (/system|reason|context/.test(value)) return "context";
  return "other";
}

function eventCategory(event: TraceEvent): EventCategory {
  const role = eventRole(event);
  if (role === "tool") return "tools";
  if (role === "user" || role === "context") return "input";
  if (role === "assistant") return "model";
  return "other";
}

function eventKind(event: TraceEvent): string {
  const role = eventRole(event);
  if (role === "tool") return "TOOL";
  if (role === "user") return "USER";
  if (role === "assistant") return "ASSISTANT";
  if (role === "context") return "CONTEXT";
  return event.type.toUpperCase().slice(0, 14);
}

function eventTone(event: TraceEvent): string {
  const role = eventRole(event);
  if (role === "tool") return "text-warning";
  if (role === "user") return "text-primary";
  if (role === "assistant") return "text-violet-300";
  if (role === "context") return "text-muted-foreground";
  return "text-success";
}

function eventTag(event: TraceEvent): string {
  const role = eventRole(event);
  if (role === "tool") return "bg-warning/15 text-warning";
  if (role === "user") return "bg-primary/15 text-primary";
  if (role === "assistant") return "bg-violet-500/15 text-violet-300";
  if (role === "context") return "bg-muted text-muted-foreground";
  return "bg-success/15 text-success";
}

function eventLane(event: TraceEvent): TimelineLane {
  const category = eventCategory(event);
  return category === "tools" ? "tools" : category === "model" ? "model" : "input";
}

function eventDuration(event: TraceEvent): number | null {
  const duration = numberValue(event.data, "durationMs", "duration_ms", "duration");
  return duration !== null && duration >= 0 ? duration : null;
}

function eventTurn(event: TraceEvent): number | null {
  const turn = numberValue(event.data, "turn", "turnNumber", "turn_number");
  return turn !== null ? Math.round(turn) : null;
}

function eventTokens(event: TraceEvent, kind: "input" | "output"): number | null {
  return numberValue(
    event.data,
    kind === "input" ? "inputTokens" : "outputTokens",
    kind === "input" ? "input_tokens" : "output_tokens",
    kind, // ponytail: pi bridge uses usage.input/usage.output; key-order makes the broad key safe
  );
}

function eventModel(event: TraceEvent): string {
  return stringValue(event.data, "model", "modelName", "model_name", "modelId", "model_id") ?? "—";
}

function eventDirectory(event: TraceEvent): string {
  return stringValue(event.data, "cwd", "workingDirectory", "working_directory", "directory") ?? "—";
}

function eventSummary(event: TraceEvent): string {
  const summary = summarize(event.data);
  if (eventRole(event) === "tool") {
    const toolName = stringValue(event.data, "name", "tool", "toolName", "tool_name");
    return toolName && toolName !== summary ? `${toolName}  ${summary}` : summary;
  }
  return summary;
}

function eventIsError(event: TraceEvent): boolean {
  const value = `${event.type} ${stringValue(event.data, "status", "error", "level") ?? ""}`.toLowerCase();
  return value.includes("error") || value.includes("failed") || value.includes("failure");
}

function timelineSegmentClass(event: TraceEvent): string {
  return categoryMeta[eventCategory(event)].bar;
}

function FilterCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-8 items-center gap-2 rounded px-2 text-xs text-foreground hover:bg-muted/60">
      <input
        type="checkbox"
        aria-label={label}
        className="size-3.5 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function EventFilterMenu({
  category,
  onCategory,
}: {
  category: "all" | EventCategory;
  onCategory: (category: "all" | EventCategory) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const active = category === "all" ? 0 : 1;
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const choose = (nextCategory: "all" | EventCategory) => {
    setOpen(false);
    onCategory(nextCategory);
  };

  return (
    <details ref={menuRef} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="relative z-20 shrink-0">
      <summary
        role="button"
        aria-label="Event filters"
        className="inline-flex h-7 cursor-pointer list-none items-center gap-1.5 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground [&::-webkit-details-marker]:hidden"
      >
        Event filters
        {active ? <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{active}</span> : null}
      </summary>
      <div className="absolute left-0 top-full mt-1 w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
        <FilterCheck label="All events" checked={category === "all"} onChange={(checked) => checked && choose("all")} />
        <FilterCheck label="Input" checked={category === "input"} onChange={(checked) => checked && choose("input")} />
        <FilterCheck label="Model" checked={category === "model"} onChange={(checked) => checked && choose("model")} />
        <FilterCheck label="Tools" checked={category === "tools"} onChange={(checked) => checked && choose("tools")} />
        <FilterCheck label="Other" checked={category === "other"} onChange={(checked) => checked && choose("other")} />
      </div>
    </details>
  );
}

function EventTimeline({ events, selectedId, onSelect }: { events: TraceEvent[]; selectedId: string | null; onSelect: (event: TraceEvent) => void }) {
  const timed = events.filter((event) => Number.isFinite(event.createdAt));
  const start = timed.length ? Math.min(...timed.map((event) => event.createdAt)) : 0;
  const end = timed.length ? Math.max(...timed.map((event) => event.createdAt + (eventDuration(event) ?? 1))) : 1;
  const span = Math.max(1, end - start);
  const lanes: TimelineLane[] = ["input", "model", "tools"];
  const turnBoundaries = events.filter((event, index) => {
    const turn = eventTurn(event);
    const previous = events[index - 1];
    return turn !== null && (previous === undefined || turn !== eventTurn(previous));
  });

  return (
    <div className="grid h-[50px] shrink-0 grid-cols-[44px_minmax(0,1fr)] border-b border-border bg-background" aria-label="Trajectory timeline">
      <div className="grid grid-rows-3 border-r border-border text-[9px] uppercase leading-none text-muted-foreground">
        {lanes.map((lane) => (
          <div key={lane} className="flex items-center justify-end border-b border-border/60 pr-1 last:border-b-0">
            {laneLabels[lane]}
          </div>
        ))}
      </div>
      <div className="relative min-w-0 overflow-hidden">
        {lanes.map((lane, index) => (
          <div key={lane} className="absolute inset-x-0 border-b border-border/60 last:border-b-0" style={{ top: `${index * 16.66}%`, height: "16.66%" }} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((line) => (
          <span key={line} className="absolute inset-y-0 border-l border-border/30" style={{ left: `${line * 10}%` }} aria-hidden="true" />
        ))}
        {turnBoundaries.map((event) => (
          <span
            key={`${event.id}-turn`}
            className="absolute inset-y-0 border-l border-primary/25"
            style={{ left: `${Math.min(99.5, Math.max(0, ((event.createdAt - start) / span) * 100))}%` }}
            aria-hidden="true"
          />
        ))}
        {events.map((event, index) => {
          const position = Number.isFinite(event.createdAt) ? (event.createdAt - start) / span : index / Math.max(1, events.length);
          const duration = eventDuration(event);
          const width = duration === null ? 0.8 : Math.max(0.6, (duration / span) * 100);
          const laneIndex = lanes.indexOf(eventLane(event));
          return (
            <button
              key={event.id}
              type="button"
              className={`absolute h-2 min-w-[3px] rounded-sm opacity-90 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${timelineSegmentClass(event)} ${selectedId === event.id ? "ring-1 ring-foreground" : ""}`}
              style={{ left: `${Math.min(99.5, Math.max(0, position * 100))}%`, top: `${laneIndex * 16.66 + 4}px`, width: `${Math.min(20, width)}%` }}
              onClick={() => onSelect(event)}
              title={`${eventKind(event)} · ${eventSummary(event)} · ${formatTime(event.createdAt)}`}
              aria-label={`Select ${eventKind(event)} event ${event.seq}`}
            />
          );
        })}
      </div>
    </div>
  );
}

function PrettyPayload({ event }: { event: TraceEvent }) {
  return (
    <pre
      aria-label={`Formatted event data for sequence ${event.seq}`}
      className="max-h-[min(70vh,48rem)] overflow-auto whitespace-pre-wrap break-words rounded-sm border border-border/70 bg-background p-3 font-mono text-[10px] leading-relaxed text-foreground"
    >
      {formatJson(event.data)}
    </pre>
  );
}

function SessionInspector({ event, onClose }: { event: TraceEvent; onClose: () => void }) {
  const [tab, setTab] = useState<InspectorTab>("json");
  useEffect(() => setTab("json"), [event.id]);
  const duration = eventDuration(event);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-popover text-popover-foreground shadow-xl backdrop-blur-2xl" aria-label="Selected event inspector">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className={`text-[10px] font-semibold ${eventTone(event)}`}>{eventKind(event)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{event.type} · #{event.seq}</span>
        <button
          type="button"
          className="size-6 rounded text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onClose}
          aria-label="Close event inspector"
        >
          ×
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2">
        {(["json", "raw", "timing"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={`h-8 shrink-0 border-b-2 px-2 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => setTab(item)}
          >
            {item === "json" ? "JSON" : item === "raw" ? "Raw" : "Timing"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === "json" ? <PrettyPayload event={event} /> : null}
        {tab === "raw" ? <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-foreground">{formatJson(event.data)}</pre> : null}
        {tab === "timing" ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[11px]">
            <dt className="text-muted-foreground">Timestamp</dt><dd className="text-foreground">{formatDateTime(event.createdAt)}</dd>
            {duration !== null ? <><dt className="text-muted-foreground">Duration</dt><dd className="text-foreground">{formatDuration(duration)}</dd></> : null}
            {eventTokens(event, "input") !== null ? <><dt className="text-muted-foreground">Input tokens</dt><dd className="text-foreground">{formatCount(eventTokens(event, "input")!)}</dd></> : null}
            {eventTokens(event, "output") !== null ? <><dt className="text-muted-foreground">Output tokens</dt><dd className="text-foreground">{formatCount(eventTokens(event, "output")!)}</dd></> : null}
            {eventModel(event) !== "—" ? <><dt className="text-muted-foreground">Model</dt><dd className="break-all font-mono text-foreground">{eventModel(event)}</dd></> : null}
            {eventDirectory(event) !== "—" ? <><dt className="text-muted-foreground">Working directory</dt><dd className="break-all font-mono text-foreground">{eventDirectory(event)}</dd></> : null}
          </dl>
        ) : null}
      </div>
    </aside>
  );
}

function EventLedger({
  events,
  selectedId,
  hasMore,
  loading,
  search,
  canLoadMore,
  onSelect,
  onLoadMore,
}: {
  events: TraceEvent[];
  selectedId: string | null;
  hasMore: boolean;
  loading: boolean;
  search: boolean;
  canLoadMore: boolean;
  onSelect: (event: TraceEvent) => void;
  onLoadMore: () => void;
}) {
  useEffect(() => {
    if (events.length !== 0 || !hasMore || loading || !canLoadMore) return;
    onLoadMore();
  }, [canLoadMore, events.length, hasMore, loading, onLoadMore]);

  let previousTurn: number | null = null;
  return (
    <div
      className="relative min-w-0 flex-1 overflow-auto bg-background"
      aria-label="Trajectory event ledger"
      onScroll={(event) => {
        const target = event.currentTarget;
        if (canLoadMore && hasMore && !loading && target.scrollHeight - target.scrollTop - target.clientHeight <= 240) onLoadMore();
      }}
    >
      <div className="sticky top-0 z-10 grid h-5 grid-cols-[8rem_minmax(0,1fr)_auto] items-center border-b border-border bg-muted backdrop-blur-md px-2 text-[9px] uppercase tracking-wide text-muted-foreground">
        <div className="flex items-center gap-1.5"><span className="w-7 shrink-0" />Role</div><div>Event</div><div>Time</div>
      </div>
      {events.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">No events match the current filters.</div>
      ) : (
        events.map((event) => {
          const turn = eventTurn(event);
          const turnStart = turn !== null && turn !== previousTurn;
          previousTurn = turn;
          return (
            <div key={`${event.seq}-${event.id}`}>
              {turnStart ? <div className="flex h-5 items-center border-t-2 border-border bg-muted/20 px-2 text-[9px] uppercase tracking-wide text-muted-foreground">Turn {turn}</div> : null}
              <button
                type="button"
                className={`group grid min-h-[34px] w-full grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/80 px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${selectedId === event.id ? "bg-primary/10" : "hover:bg-muted/50"}`}
                onClick={() => onSelect(event)}
                aria-pressed={selectedId === event.id}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="w-7 shrink-0 text-right font-mono text-[9px] text-muted-foreground">#{event.seq}</span>
                  <span className={`inline-flex min-w-0 truncate rounded-[3px] px-1.5 text-[9px] font-semibold tracking-[0.035em] ${eventTag(event)}`} title={eventKind(event)}>{eventKind(event)}</span>
                </div>
                <div className={`flex min-w-0 items-center gap-2 truncate text-[11px] text-foreground ${eventRole(event) === "tool" ? "font-mono" : ""}`} title={`${event.type} · ${eventSummary(event)}`}>
                  <code className="shrink-0 text-[10px] font-semibold">{event.type}</code>
                  <span className="truncate text-muted-foreground">{eventSummary(event)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[9px] text-muted-foreground">
                  {eventIsError(event) ? <span className="text-destructive">error</span> : null}
                  <span>{formatTime(event.createdAt)}</span>
                  {eventDuration(event) !== null ? <span>{formatDuration(eventDuration(event))}</span> : null}
                </div>
              </button>
            </div>
          );
        })
      )}
      {hasMore ? (
        <div className="flex min-h-9 items-center justify-center border-t border-border bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground" aria-live="polite">
          {!canLoadMore ? "Unable to load more; refresh to retry" : loading ? (search ? "Loading more matches…" : "Loading later events…") : "Scroll for more"}
        </div>
      ) : null}
    </div>
  );
}

function TracePanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchEvents, setSearchEvents] = useState<TraceEvent[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchRevision, setSearchRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<TraceSourceStatus>("ok");
  const [loadMoreBlocked, setLoadMoreBlocked] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | EventCategory>("all");
  const [selectedEvent, setSelectedEvent] = useState<TraceEvent | null>(null);
  const requestGeneration = useRef(0);
  const searchGeneration = useRef(0);
  const viewGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    viewGeneration.current += 1;
    setLoading(true);
    setLoadingMore(false);
    setSearchEvents([]);
    setSearchHasMore(false);
    setSelectedEvent(null);
    setError(null);
    setSourceStatus("ok");
    setLoadMoreBlocked(false);
    setSearchRevision((value) => value + 1);
    try {
      const result = await rpc.call("listEvents", { threadId, limit: PAGE_SIZE });
      if (requestId !== requestGeneration.current) return;
      setEvents(result.events);
      setHasMore(result.hasMore);
      setSourceStatus(result.status);
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

  useEffect(() => {
    const normalizedQuery = query.trim();
    const requestId = ++searchGeneration.current;
    setLoadMoreBlocked(false);
    if (normalizedQuery === "") {
      setSearchEvents([]);
      setSearchHasMore(false);
      setSearchLoading(false);
      setLoadingMore(false);
      return;
    }

    setLoadingMore(false);
    setSearchLoading(true);
    setError(null);
    void rpc
      .call("searchEvents", { threadId, query: normalizedQuery, limit: PAGE_SIZE })
      .then((result) => {
        if (requestId !== searchGeneration.current) return;
        setSearchEvents(result.events);
        setSearchHasMore(result.hasMore);
        setSourceStatus(result.status);
      })
      .catch((cause) => {
        if (requestId !== searchGeneration.current) return;
        setSearchEvents([]);
        setSearchHasMore(false);
        setError(errorMessage(cause));
      })
      .finally(() => {
        if (requestId === searchGeneration.current) setSearchLoading(false);
      });
  }, [query, rpc, searchRevision, threadId]);

  const loadMore = useCallback(async () => {
    const searchActive = query.trim() !== "";
    if (loadMoreBlocked || loading || loadingMore || (searchActive ? searchLoading || searchEvents.length === 0 : events.length === 0)) return;
    const requestId = searchActive ? searchGeneration.current : requestGeneration.current;
    const viewId = viewGeneration.current;
    setLoadingMore(true);
    setError(null);
    try {
      if (searchActive) {
        const result = await rpc.call("searchEvents", {
          threadId,
          query: query.trim(),
          afterSeq: searchEvents.at(-1)!.seq,
          limit: PAGE_SIZE,
        });
        if (requestId !== searchGeneration.current) return;
        setSearchEvents((current) => [...current, ...result.events]);
        setSearchHasMore(result.hasMore);
        setSourceStatus(result.status);
      } else {
        const result = await rpc.call("listEvents", {
          threadId,
          afterSeq: events.at(-1)!.seq,
          limit: PAGE_SIZE,
        });
        if (requestId !== requestGeneration.current) return;
        setEvents((current) => [...current, ...result.events]);
        setHasMore(result.hasMore);
        setSourceStatus(result.status);
      }
    } catch (cause) {
      const current = searchActive ? requestId === searchGeneration.current : requestId === requestGeneration.current;
      if (current && viewId === viewGeneration.current) {
        setError(errorMessage(cause));
        setLoadMoreBlocked(true);
      }
    } finally {
      const current = searchActive ? requestId === searchGeneration.current : requestId === requestGeneration.current;
      if (current && viewId === viewGeneration.current) setLoadingMore(false);
    }
  }, [events, loadMoreBlocked, loading, loadingMore, query, rpc, searchEvents, searchLoading, threadId]);

  const searchActive = query.trim() !== "";
  const visibleEvents = searchActive ? searchEvents : events;
  const displayHasMore = searchActive ? searchHasMore : hasMore;
  const filteredEvents = useMemo(() => {
    return visibleEvents.filter((event) => {
      if (category !== "all" && eventCategory(event) !== category) return false;
      return true;
    });
  }, [category, visibleEvents]);

  const duration = events.length > 1 ? events.at(-1)!.createdAt - events[0]!.createdAt : null;
  const toolCount = events.filter((event) => eventCategory(event) === "tools").length;
  const busy = loading || loadingMore || searchLoading;
  const sourceMessage = sourceStatus === "unsupported"
    ? "This Provider is not supported yet, and no generic JSONL trace was found."
    : sourceStatus === "not_found"
      ? "No matching source JSONL file was found on the thread's host."
      : "No events recorded for this thread.";

  return (
    <section aria-label="Thread trace" className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">BB Trace</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Trace</span>
        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">{formatCount(events.length)} events · {toolCount} tools · {formatDuration(duration)}</span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-2 py-1">
        <EventFilterMenu
          category={category}
          onCategory={(nextCategory) => {
            viewGeneration.current += 1;
            setCategory(nextCategory);
            setSelectedEvent(null);
            setError(null);
            setLoadMoreBlocked(false);
            setLoadingMore(false);
          }}
        />
        <label className="ml-auto flex h-[22px] w-48 items-center rounded border border-border bg-muted/30 px-1.5 focus-within:border-ring focus-within:bg-background">
          <span className="sr-only">Search trace events</span>
          <input
            aria-label="Search trace events"
            className="min-w-0 w-full bg-transparent px-0.5 text-[11px] text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Search events, tools, and messages"
            type="search"
            value={query}
            onChange={(event) => {
              viewGeneration.current += 1;
              setQuery(event.target.value);
              setSelectedEvent(null);
              setError(null);
              setLoadMoreBlocked(false);
              setLoadingMore(false);
            }}
          />
        </label>
      </div>

      <EventTimeline events={filteredEvents} selectedId={selectedEvent?.id ?? null} onSelect={setSelectedEvent} />

      {error !== null && (events.length > 0 || searchActive) ? <div role="alert" className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-[10px] text-destructive">{error}</div> : null}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {loading || (searchActive && searchLoading) ? (
          <div className="flex min-h-40 flex-1 items-center justify-center text-sm text-muted-foreground" role="status">{searchActive ? "Searching events…" : "Loading events…"}</div>
        ) : error !== null && events.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
            <p role="alert" className="text-sm text-destructive">Unable to load trace: {error}</p>
            <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={() => void refresh()}>Retry</button>
          </div>
        ) : (sourceStatus === "unsupported" || sourceStatus === "not_found") ? (
          <p className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">{sourceMessage}</p>
        ) : !searchActive && events.length === 0 ? (
          <p className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">{sourceMessage}</p>
        ) : filteredEvents.length === 0 && !displayHasMore ? (
          <p className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">{searchActive ? "No events match the current search." : "No events match the current filters."}</p>
        ) : (
          <EventLedger
            events={filteredEvents}
            selectedId={selectedEvent?.id ?? null}
            hasMore={displayHasMore}
            loading={loadingMore}
            search={searchActive}
            canLoadMore={!loadMoreBlocked}
            onSelect={setSelectedEvent}
            onLoadMore={() => void loadMore()}
          />
        )}
        {selectedEvent ? <div className="absolute inset-y-0 right-0 z-10 w-[min(92%,420px)] lg:relative lg:inset-auto lg:z-auto lg:w-[clamp(300px,36%,440px)]"><SessionInspector event={selectedEvent} onClose={() => setSelectedEvent(null)} /></div> : null}
      </div>
    </section>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "trace",
    title: "Trace",
    icon: "Activity",
    component: TracePanel,
    layout: "flush",
  });
});
