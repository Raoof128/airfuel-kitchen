import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecipeNoteDrafts,
  readRecipeNoteDraft,
  removeRecipeNoteDraft,
  subscribeToDraftReset,
  writeRecipeNoteDraft,
} from "../../src/lib/noteDrafts";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class MockChannel {
  static instances: MockChannel[] = [];
  sent: unknown[] = [];
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    MockChannel.instances.push(this);
  }
  postMessage(value: unknown) {
    this.sent.push(value);
  }
  close() {
    this.closed = true;
  }
  receive(value: unknown) {
    this.onmessage?.({ data: value });
  }
}

const subscriptions: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("localStorage", new MemoryStorage());
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("BroadcastChannel", MockChannel);
  MockChannel.instances = [];
});
afterEach(() => {
  for (const unsubscribe of subscriptions) unsubscribe();
  subscriptions.length = 0;
  vi.unstubAllGlobals();
});

describe("temporary recipe-note privacy", () => {
  it("clears every note draft locally, notifies mounted views and broadcasts no private content", () => {
    const notify = vi.fn();
    subscriptions.push(subscribeToDraftReset(notify));
    expect(writeRecipeNoteDraft("chicken", "Private note one")).toBe(true);
    expect(writeRecipeNoteDraft("salmon", "Private note two")).toBe(true);
    sessionStorage.setItem("unrelated-app-key", "keep");
    expect(clearRecipeNoteDrafts()).toBe(true);
    expect(readRecipeNoteDraft("chicken")).toBeNull();
    expect(readRecipeNoteDraft("salmon")).toBeNull();
    expect(sessionStorage.getItem("unrelated-app-key")).toBe("keep");
    expect(notify).toHaveBeenCalledTimes(1);
    const channel = MockChannel.instances[0];
    expect(channel.name).toBe("airfuel-note-drafts");
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({
      type: "clear-note-drafts",
      version: 1,
    });
    expect(JSON.stringify(channel.sent)).not.toContain("Private");
    expect(localStorage.getItem("airfuel-note-draft-reset")).not.toContain(
      "Private",
    );
  });

  it("clears a remote tab reset and ignores duplicate deliveries without erasing a new draft", () => {
    const notify = vi.fn();
    subscriptions.push(subscribeToDraftReset(notify));
    writeRecipeNoteDraft("chicken", "Old draft in the receiving tab");
    const message = {
      type: "clear-note-drafts",
      version: 1,
      id: crypto.randomUUID(),
    };
    const channel = MockChannel.instances[0];
    channel.receive(message);
    expect(readRecipeNoteDraft("chicken")).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(channel.sent).toHaveLength(0);
    writeRecipeNoteDraft("chicken", "New note after deletion");
    channel.receive(message);
    expect(readRecipeNoteDraft("chicken")).toBe("New note after deletion");
    expect(notify).toHaveBeenCalledTimes(1);
    channel.receive({ ...message, id: "invalid", version: 999 });
    expect(readRecipeNoteDraft("chicken")).toBe("New note after deletion");
  });

  it("prevents drafts in a suspended tab from returning after a missed broadcast", () => {
    writeRecipeNoteDraft("chicken", "Draft before global deletion");
    localStorage.setItem(
      "airfuel-note-draft-reset",
      JSON.stringify({
        type: "clear-note-drafts",
        version: 1,
        id: crypto.randomUUID(),
      }),
    );
    expect(readRecipeNoteDraft("chicken")).toBeNull();
    expect(writeRecipeNoteDraft("chicken", "New note after deletion")).toBe(
      true,
    );
    expect(readRecipeNoteDraft("chicken")).toBe("New note after deletion");
    expect(removeRecipeNoteDraft("chicken")).toBe(true);
    expect(readRecipeNoteDraft("chicken")).toBeNull();
  });

  it("tolerates unavailable optional storage and reports that deletion could not be confirmed", () => {
    vi.stubGlobal("sessionStorage", {
      get length() {
        throw new Error("Storage blocked");
      },
      getItem() {
        throw new Error("Storage blocked");
      },
      setItem() {
        throw new Error("Storage blocked");
      },
      removeItem() {
        throw new Error("Storage blocked");
      },
    });
    expect(writeRecipeNoteDraft("chicken", "Unsaved")).toBe(false);
    expect(readRecipeNoteDraft("chicken")).toBeNull();
    expect(removeRecipeNoteDraft("chicken")).toBe(false);
    expect(clearRecipeNoteDrafts()).toBe(false);
  });
});
