import { describe, expect, it } from "vitest";
import { EventBus } from "../src/events.js";

describe("EventBus", () => {
  it("fans out per review and unsubscribes", () => {
    const bus = new EventBus();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const unsubA = bus.subscribe("r1", (e) => a.push(e));
    bus.subscribe("r2", (e) => b.push(e));
    bus.publish("r1", { type: "error", message: "x" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
    unsubA();
    bus.publish("r1", { type: "error", message: "y" });
    expect(a).toHaveLength(1);
    expect(bus.subscriberCount("r1")).toBe(0);
  });
});
