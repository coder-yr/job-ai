// packages/core/src/notifications/events.ts - Shared SSE event bus
import { EventEmitter } from "node:events";

export type SseEventType = "run.progress" | "matches.new" | "document.ready" | "notification.new";

export interface SseEvent<T = unknown> {
  type: SseEventType;
  data: T;
  timestamp: string;
}

class SseBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }

  broadcast<T = unknown>(type: SseEventType, data: T): void {
    const event: SseEvent<T> = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    this.emit("sse", event);
  }
}

export const sseBus = new SseBus();
