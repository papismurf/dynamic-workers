import {
  DurableObject,
  RpcTarget,
  WorkerEntrypoint,
  exports,
} from "cloudflare:workers";
import type { LogEntry } from "./types";

// ---------------------------------------------------------------------------
// LogWaiter — RPC target that collects logs and resolves when ready
// ---------------------------------------------------------------------------

class LogWaiter extends RpcTarget {
  private logs: LogEntry[] = [];
  private resolve: ((logs: LogEntry[]) => void) | undefined;

  addLogs(logs: LogEntry[]) {
    this.logs.push(...logs);
    if (this.resolve) {
      this.resolve(this.logs);
      this.resolve = undefined;
    }
  }

  async getLogs(timeoutMs: number): Promise<LogEntry[]> {
    if (this.logs.length > 0) return this.logs;

    return new Promise<LogEntry[]>((resolve) => {
      const timeout = setTimeout(() => resolve(this.logs), timeoutMs);
      this.resolve = (logs) => {
        clearTimeout(timeout);
        resolve(logs);
      };
    });
  }
}

// ---------------------------------------------------------------------------
// LogSession Durable Object — bridges Tail Workers and HTTP callers
// ---------------------------------------------------------------------------

export class LogSession extends DurableObject {
  private waiters: LogWaiter[] = [];
  private allLogs: LogEntry[] = [];
  private websockets: Set<WebSocket> = new Set();

  async addLogs(logs: LogEntry[]) {
    this.allLogs.push(...logs);
    for (const waiter of this.waiters) {
      waiter.addLogs(logs);
    }
    for (const ws of this.websockets) {
      try {
        ws.send(JSON.stringify({ type: "logs", data: logs }));
      } catch {
        this.websockets.delete(ws);
      }
    }
  }

  async waitForLogs(): Promise<LogWaiter> {
    const waiter = new LogWaiter();
    this.waiters.push(waiter);
    return waiter;
  }

  async getAllLogs(): Promise<LogEntry[]> {
    return this.allLogs;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();

      this.websockets.add(server);
      server.addEventListener("close", () => this.websockets.delete(server));

      if (this.allLogs.length > 0) {
        server.send(JSON.stringify({ type: "logs", data: this.allLogs }));
      }

      return new Response(null, { status: 101, webSocket: client });
    }

    return Response.json(this.allLogs);
  }
}

// ---------------------------------------------------------------------------
// DynamicWorkerTail — Tail Worker that captures agent console.log output
// ---------------------------------------------------------------------------

interface TailProps {
  workerId: string;
  taskId: string;
}

function normalizeLogMessage(message: unknown): string {
  if (Array.isArray(message)) {
    return message
      .map((entry) =>
        typeof entry === "string" ? entry : JSON.stringify(entry)
      )
      .join(" ");
  }
  return typeof message === "string" ? message : JSON.stringify(message);
}

export class DynamicWorkerTail extends WorkerEntrypoint<Env, TailProps> {
  override async tail(events: TraceItem[]) {
    const { workerId, taskId } = this.ctx.props;
    const logSessionStub = (exports as unknown as { LogSession: { getByName(name: string): { addLogs(logs: LogEntry[]): Promise<void> } } }).LogSession.getByName(workerId);
    const logs: LogEntry[] = [];

    for (const event of events) {
      for (const log of event.logs) {
        const entry: LogEntry = {
          level: log.level,
          message: normalizeLogMessage(log.message),
          timestamp: log.timestamp,
          workerId,
          taskId,
        };
        console.log(JSON.stringify(entry));
        logs.push(entry);
      }

      for (const exception of event.exceptions) {
        const entry: LogEntry = {
          level: "error",
          message: `${exception.name}: ${exception.message}`,
          timestamp: exception.timestamp,
          workerId,
          taskId,
        };
        console.error(JSON.stringify(entry));
        logs.push(entry);
      }
    }

    if (logs.length > 0) {
      await logSessionStub.addLogs(logs);
    }
  }
}
