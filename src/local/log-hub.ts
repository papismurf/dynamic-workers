import type { LogEntry } from "../types.js";

type Subscriber = (entry: LogEntry) => void;

/**
 * In-process log sink + fan-out. The local counterpart of the Cloudflare
 * LogSession Durable Object: it buffers logs per task and pushes new entries
 * to live subscribers (used for SSE streaming). See
 * docs/adr/0004-state-and-observability-portability.md.
 */
export class LogHub {
  private readonly buffers = new Map<string, LogEntry[]>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  publish(taskId: string, entry: LogEntry): void {
    const buffer = this.buffers.get(taskId) ?? [];
    buffer.push(entry);
    this.buffers.set(taskId, buffer);
    for (const sub of this.subscribers.get(taskId) ?? []) {
      sub(entry);
    }
  }

  history(taskId: string): LogEntry[] {
    return this.buffers.get(taskId) ?? [];
  }

  /** Subscribe to future logs for a task; returns an unsubscribe function. */
  subscribe(taskId: string, sub: Subscriber): () => void {
    const set = this.subscribers.get(taskId) ?? new Set<Subscriber>();
    set.add(sub);
    this.subscribers.set(taskId, set);
    return () => {
      set.delete(sub);
    };
  }
}
