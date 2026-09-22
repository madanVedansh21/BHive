// =============================================================================
// src/eventBus.ts — Central in-process event bus for the BHive UI daemon.
//
// Usage:
//   import { bus } from "./eventBus";
//   bus.publish("agent:wakeup", { agentId, name, tickIndex });
//
// The WS server subscribes to "bhive" events and fans them out to clients.
// All orchestrator / agentSession / improve pipeline code emits here.
// =============================================================================

import { EventEmitter } from "events";
import { BHiveEvent, BHiveEventType } from "./uiTypes";

const EVENT_NAME = "bhive";

class BHiveBus extends EventEmitter {
  publish(type: BHiveEventType, payload: unknown): void {
    const event: BHiveEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    this.emit(EVENT_NAME, event);
  }

  onEvent(listener: (event: BHiveEvent) => void): () => void {
    this.on(EVENT_NAME, listener);
    return () => this.off(EVENT_NAME, listener);
  }
}

export const bus = new BHiveBus();
bus.setMaxListeners(200);
