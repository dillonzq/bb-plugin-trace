import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { parseJsonl } from "./src/raw-jsonl";
import { traceHostContract } from "./src/host-contract";
import type { TraceSourceStatus } from "./src/trace-event";

type Root = { source: string; path: string };
type ProviderSource = "codex" | "claude" | "pi" | "omp" | "dsh";

const ROOTS: Root[] = [
  { source: "dsh", path: join(homedir(), ".dsh", "sessions") },
  { source: "claude", path: join(homedir(), ".claude", "projects") },
  { source: "pi", path: join(homedir(), ".pi", "agent", "sessions") },
  { source: "pi", path: join(homedir(), ".bb", "pi-bridge-sessions") },
  { source: "omp", path: join(homedir(), ".omp", "agent", "sessions") },
  { source: "codex", path: join(homedir(), ".codex", "archived_sessions") },
  { source: "codex", path: join(homedir(), ".codex", "pi-subagents-cli", "sessions") },
  { source: "codex", path: join(homedir(), ".codex", "sessions") },
];

const MAX_DISCOVERED_FILES = 4_096;
const MAX_FALLBACK_FILES = 256;
const PREFIX_BYTES = 64 * 1024;
// Host RPC output is capped at 8 MiB; keep parsed traces comfortably below it.
const MAX_FIELD_CHARS = 2_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
type HostReadEventsResult = {
  status: TraceSourceStatus;
  events: ReturnType<typeof parseJsonl>;
};

function rootsFor(providerId: string | null): { roots: Root[]; known: boolean } {
  const value = providerId?.toLowerCase() ?? "";
  const source: ProviderSource | null = value.includes("codex")
    ? "codex"
    : value.includes("claude")
      ? "claude"
      : value.includes("pi")
        ? "pi"
        : value.includes("omp")
          ? "omp"
          : value.includes("dsh") || value.includes("deepseek")
            ? "dsh"
            : null;
  return {
    roots: source === null ? ROOTS : ROOTS.filter((root) => root.source === source),
    known: source !== null,
  };
}

async function walkJsonl(root: string, signal: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (signal.aborted || depth > 8 || files.length >= MAX_DISCOVERED_FILES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (signal.aborted || files.length >= MAX_DISCOVERED_FILES) return;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(path);
      }
    }
  }
  await visit(root, 0);
  return files;
}

async function containsInPrefix(path: string, needle: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(PREFIX_BYTES);
    const result = await handle.read(buffer, 0, PREFIX_BYTES, 0);
    return result.bytesRead > 0 && buffer.subarray(0, result.bytesRead).includes(needle);
  } finally {
    await handle.close();
  }
}

// ponytail: truncate long strings + drop oldest events past a byte budget; a real
// pagination contract in the host RPC is the upgrade path if tails matter.
function compact(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}…(+${value.length - MAX_FIELD_CHARS} chars)`
      : value;
  }
  if (Array.isArray(value)) return value.map(compact);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compact(child)]));
  }
  return value;
}

function compactEvents(events: ReturnType<typeof parseJsonl>): ReturnType<typeof parseJsonl> {
  const kept: typeof events = [];
  let budget = MAX_OUTPUT_BYTES;
  for (const event of events) {
    const candidate = { ...event, data: compact(event.data) as Record<string, unknown> };
    const size = Buffer.byteLength(JSON.stringify(candidate));
    if (size > budget) break;
    budget -= size;
    kept.push(candidate);
  }
  return kept;
}

async function findSessionFile(
  providerId: string | null,
  providerThreadId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const files: string[] = [];
  for (const root of rootsFor(providerId).roots) {
    files.push(...(await walkJsonl(root.path, signal)));
    if (files.some((path) => basename(path).includes(providerThreadId))) break;
  }
  const filenameMatch = files.find((path) => basename(path).includes(providerThreadId));
  if (filenameMatch) return filenameMatch;

  // ponytail: bounded prefix scan; add a durable index if providers stop putting session ids in paths.
  for (const path of files.slice(0, MAX_FALLBACK_FILES)) {
    if (signal.aborted) return null;
    try {
      if (await containsInPrefix(path, providerThreadId)) return path;
    } catch {
      // The file may disappear while an agent is writing it.
    }
  }
  return null;
}

export default experimental_defineHostEntry({
  contract: traceHostContract,
  handlers: {
    async readEvents(input, context): Promise<HostReadEventsResult> {
      const source = rootsFor(input.providerId);
      if (context.signal.aborted || input.providerThreadId === null) {
        return { status: "unsupported", events: [] };
      }
      const path = await findSessionFile(input.providerId, input.providerThreadId, context.signal);
      if (path === null || context.signal.aborted) {
        return { status: source.known ? "not_found" : "unsupported", events: [] };
      }
      try {
        const [content, metadata] = await Promise.all([
          readFile(path, "utf8"),
          stat(path),
        ]);
        return {
          status: source.known ? "ok" : "generic",
          events: compactEvents(
            parseJsonl(content, {
              threadId: input.threadId,
              fallbackTimestamp: metadata.mtimeMs,
            }),
          ),
        };
      } catch {
        return { status: source.known ? "not_found" : "unsupported", events: [] };
      }
    },
  },
});
