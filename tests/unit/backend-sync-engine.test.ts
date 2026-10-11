// Client sync engine with a fake transport (no network). Covers durable offline queueing, idempotent
// drains, bounded retries, permanent vs transient failures, auth expiry, partial failure, delete
// propagation and multi-device conflicts. The Supabase adapter is exercised separately in
// backend-sync-transport.test.ts.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifySyncError,
  compareVersion,
  forgetSyncBaselines,
  retryDelay,
  retryRejected,
  SyncDB,
  SyncEngine,
  SyncError,
  validateWire,
  type CloudAdapter,
  type WireRecord,
} from "../../src/cloud/core";
import { createActions, KitchenDB } from "../../src/lib/db";

const opened: (KitchenDB | SyncDB)[] = [];
afterEach(async () => {
  for (const database of opened.splice(0)) await database.delete();
});

// A "device" is a pair of IndexedDB databases. Reopening with the same name simulates a reload.
function openDevice(name = `device-${crypto.randomUUID()}`) {
  const local = new KitchenDB(`${name}-local`);
  const metadata = new SyncDB(`${name}-sync`);
  opened.push(local, metadata);
  return { name, local, metadata, actions: createActions(local) };
}
function engineFor(
  device: ReturnType<typeof openDevice>,
  adapter: CloudAdapter,
) {
  return new SyncEngine(device.local, device.metadata, adapter);
}

class FakeCloud implements CloudAdapter {
  records = new Map<string, WireRecord>();
  applyCalls: WireRecord[] = [];
  // Per-call plan: return "ok", or throw the given error instead of committing.
  plan: ((record: WireRecord) => "ok" | "lose-ack" | Error | undefined)[] = [];
  offline = false;
  async apply(record: WireRecord) {
    this.applyCalls.push(structuredClone(record));
    if (this.offline) throw new Error("Offline");
    const step = this.plan.shift()?.(record);
    if (step instanceof Error) throw step;
    const key = `${record.entity}/${record.record_id}`;
    const previous = this.records.get(key);
    if (!previous || compareVersion(record, previous) > 0)
      this.records.set(key, structuredClone(record));
    if (step === "lose-ack")
      throw new Error("Response lost after server committed");
    return structuredClone(this.records.get(key)!);
  }
  async readAll() {
    if (this.offline) throw new Error("Offline");
    return [...this.records.values()].map((row) => structuredClone(row));
  }
}

const session = (id: string, notes: string) => ({
  id,
  updatedAt: 1,
  recipeId: "chicken",
  date: "2026-10-11",
  servingsPrepared: 2,
  servingsConsumed: 1,
  rating: 5,
  actualMinutes: null,
  ingredientChanges: "",
  temperatureC: null,
  timeChanges: "",
  notes,
  wouldCookAgain: true,
});

describe("offline queue durability and drain", () => {
  it("keeps offline edits across a reload and drains them once the network returns", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    await device.actions.patchRecipeState("chicken", {
      notes: "written offline",
    });
    cloud.offline = true;
    await expect(engineFor(device, cloud).run()).rejects.toThrow("Offline");

    // Reload: brand-new Dexie instances over the same databases.
    const reloaded = openDevice(device.name);
    const engine = engineFor(reloaded, cloud);
    expect(await engine.pendingCount()).toBe(1);
    cloud.offline = false;
    await engine.run();
    expect(cloud.records.size).toBe(1);
    expect(
      (cloud.records.values().next().value!.payload as { notes: string }).notes,
    ).toBe("written offline");
  });

  it("does not re-send or duplicate records on repeated drains", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("chicken", { notes: "once" });
    await engine.run();
    const sentAfterFirst = cloud.applyCalls.length;
    await engine.run();
    await engine.run();
    expect(cloud.applyCalls.length).toBe(sentAfterFirst);
    expect(await device.local.recipeStates.count()).toBe(1);
  });

  it("treats a duplicate delivery of an acknowledged operation as a no-op (append-only sessions)", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.local.sessions.put(session("session-1", "cooked once"));
    await engine.run();
    // The same operation arrives again, e.g. a retry after a lost acknowledgement.
    const replay = cloud.records.get("sessions/session-1")!;
    await engine.acceptRemote(replay);
    await engine.acceptRemote(replay);
    expect(await device.local.sessions.count()).toBe(1);
    expect(await engine.conflictCount()).toBe(0);
  });

  it("does not duplicate a session when the acknowledgement is lost and the write is retried", async () => {
    const cloud = new FakeCloud();
    cloud.plan = [() => "lose-ack"];
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.local.sessions.put(session("session-2", "retry me"));
    await expect(engine.run()).rejects.toThrow("Response lost");
    await engine.run();
    expect(cloud.records.size).toBe(1);
    expect(await device.local.sessions.count()).toBe(1);
    // Both attempts carried the same operation ID, so the server saw one logical write.
    expect(
      new Set(cloud.applyCalls.map((call) => call.operation_id)).size,
    ).toBe(1);
  });
});

describe("retry policy and failure classification", () => {
  it("bounds retry delays with exponential backoff capped at five minutes", () => {
    const delays = [0, 1, 2, 3, 4, 5, 50, -1].map(retryDelay);
    expect(delays).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000, 30_000,
    ]);
    for (const delay of delays) expect(delay).toBeLessThanOrEqual(300_000);
  });

  it("classifies errors so permanent data rejections are not retried and transient ones are", () => {
    expect(classifySyncError(new SyncError("x", "permanent"))).toBe(
      "permanent",
    );
    expect(classifySyncError(new SyncError("x", "auth"))).toBe("auth");
    expect(classifySyncError(new Error("Offline"))).toBe("transient");
    let invalid: unknown;
    try {
      validateWire({ entity: "sessions", record_id: "bad" });
    } catch (error) {
      invalid = error;
    }
    expect(classifySyncError(invalid)).toBe("permanent");
  });

  it("stops retrying a permanently rejected record but keeps it and reports it", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("chicken", {
      notes: "rejected by server",
    });
    cloud.plan = [
      () => new SyncError("Cloud write failed: check constraint", "permanent"),
    ];
    const result = await engine.run();
    expect(result.rejected).toBe(1);
    expect(result.pending).toBe(0);
    const callsAfterRejection = cloud.applyCalls.length;
    await engine.run();
    await engine.run();
    expect(cloud.applyCalls.length).toBe(callsAfterRejection);
    // The local value is never discarded for a rejection.
    expect((await device.local.recipeStates.get("chicken"))?.notes).toBe(
      "rejected by server",
    );
  });

  it("does not let one permanently rejected record block every other record (head-of-line)", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("bad-record", { notes: "too large" });
    await device.actions.patchRecipeState("good-record", { notes: "fine" });
    cloud.plan = [() => new SyncError("check constraint", "permanent")];
    await engine.run();
    expect(cloud.records.has("recipeStates/good-record")).toBe(true);
    expect(cloud.records.has("recipeStates/bad-record")).toBe(false);
  });

  it("stops the pass at a transient failure and does not pull over unsent work", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("first", { notes: "a" });
    await device.actions.patchRecipeState("second", { notes: "b" });
    cloud.plan = [() => "ok", () => new Error("Timeout")];
    let readAllCalls = 0;
    const originalReadAll = cloud.readAll.bind(cloud);
    cloud.readAll = async () => {
      readAllCalls++;
      return originalReadAll();
    };
    await expect(engine.run()).rejects.toThrow("Timeout");
    expect(readAllCalls).toBe(0);
    expect(await engine.pendingCount()).toBe(1);
    expect(cloud.records.has("recipeStates/first")).toBe(true);
  });

  it("surfaces an auth failure immediately so the caller can stop instead of retrying", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("chicken", {
      notes: "needs a session",
    });
    cloud.plan = [
      () =>
        new SyncError("Your session expired. Please sign in again.", "auth"),
    ];
    const error = await engine.run().catch((caught: unknown) => caught);
    expect(classifySyncError(error)).toBe("auth");
    expect(cloud.applyCalls).toHaveLength(1);
    expect(await engine.pendingCount()).toBe(1);
    // After re-authentication the same queued write drains without loss.
    await engine.run();
    expect(cloud.records.has("recipeStates/chicken")).toBe(true);
  });
});

describe("delete propagation", () => {
  it("propagates a deletion as a tombstone and removes the record on other devices", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    await a.actions.saveSession({
      recipeId: "chicken",
      date: "2026-10-11",
      servingsPrepared: 2,
      servingsConsumed: 1,
      rating: 4,
      actualMinutes: null,
      ingredientChanges: "",
      temperatureC: null,
      timeChanges: "",
      notes: "",
      wouldCookAgain: true,
    });
    const engineA = engineFor(a, cloud);
    const engineB = engineFor(b, cloud);
    await engineA.run();
    await engineB.run();
    const [sessionId] = (await b.local.sessions
      .toCollection()
      .primaryKeys()) as string[];
    await a.local.sessions.delete(sessionId);
    await engineA.run();
    await engineB.run();
    expect(await b.local.sessions.count()).toBe(0);
    expect(cloud.records.get(`sessions/${sessionId}`)?.deleted).toBe(true);
  });
});

describe("multi-device convergence (documented decisions)", () => {
  it("converges concurrent rating/favourite/notes edits on the same recipe to one winner on both devices", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    await a.actions.patchRecipeState("chicken", { rating: 4, favourite: true });
    await b.actions.patchRecipeState("chicken", { rating: 2, notes: "from B" });
    const engineA = engineFor(a, cloud);
    const engineB = engineFor(b, cloud);
    await engineA.run();
    await engineB.run();
    await engineA.run();
    await engineB.run();
    const stateA = await a.local.recipeStates.get("chicken");
    const stateB = await b.local.recipeStates.get("chicken");
    expect(stateA).toEqual(stateB);
    // Whole-record last-writer-wins: the winner is one device's complete edit, never a field-wise mix.
    const aWon = stateA?.rating === 4;
    expect(stateA).toMatchObject(
      aWon
        ? { rating: 4, favourite: true, notes: "" }
        : { rating: 2, favourite: false, notes: "from B" },
    );
  });

  it("keeps the displaced version of a concurrent same-record edit instead of dropping it", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    await a.actions.patchRecipeState("chicken", { notes: "A's careful note" });
    await b.actions.patchRecipeState("chicken", { notes: "B's note" });
    const engineA = engineFor(a, cloud);
    const engineB = engineFor(b, cloud);
    await engineA.run();
    await engineB.run();
    await engineA.run();
    const loserNotes = ["A's careful note", "B's note"];
    const survivor = (await a.local.recipeStates.get("chicken"))!.notes;
    const loser = loserNotes.find((note) => note !== survivor)!;
    const kept = (await engineA.listConflicts()).concat(
      await engineB.listConflicts(),
    );
    expect(
      kept.some(
        (conflict) =>
          (conflict.local as { notes?: string } | null)?.notes === loser ||
          (conflict.remote as { notes?: string } | null)?.notes === loser,
      ),
    ).toBe(true);
  });

  it("first sync on two devices with different recipe notes keeps the losing value as a conflict", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    await a.actions.patchRecipeState("chicken", { notes: "first sync A" });
    await b.actions.patchRecipeState("chicken", { notes: "first sync B" });
    const engineA = engineFor(a, cloud);
    const engineB = engineFor(b, cloud);
    await engineA.run();
    await engineB.run();
    await engineA.run();
    await engineB.run();
    const winnerNotes = (await a.local.recipeStates.get("chicken"))!.notes;
    expect((await b.local.recipeStates.get("chicken"))!.notes).toBe(
      winnerNotes,
    );
    const loserNotes =
      winnerNotes === "first sync A" ? "first sync B" : "first sync A";
    const kept = (await engineA.listConflicts()).concat(
      await engineB.listConflicts(),
    );
    const keptNotes = kept.flatMap((conflict) => [
      (conflict.local as { notes?: string } | null)?.notes,
      (conflict.remote as { notes?: string } | null)?.notes,
    ]);
    expect(keptNotes).toContain(loserNotes);
  });

  it("converges delete-versus-edit on the same revision and keeps the displaced side", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    await a.actions.patchRecipeState("chicken", { notes: "v1" });
    const engineA = engineFor(a, cloud);
    const engineB = engineFor(b, cloud);
    await engineA.run();
    await engineB.run();
    // Both devices now start from the same synced revision: A deletes, B edits, neither has seen the other.
    await a.actions.deleteRecipeState("chicken");
    await b.actions.patchRecipeState("chicken", {
      notes: "edit made while offline",
    });
    await engineA.run();
    await engineB.run();
    await engineA.run();
    await engineB.run();
    const onA = await a.local.recipeStates.get("chicken");
    const onB = await b.local.recipeStates.get("chicken");
    expect(onA).toEqual(onB);
    // Documented: the same-revision UUID tie-break decides; the displaced side is retained, never dropped.
    const kept =
      (await engineA.listConflicts()).length +
      (await engineB.listConflicts()).length;
    expect(kept).toBeGreaterThanOrEqual(1);
  });
});

describe("remote data validation", () => {
  it("normalises upper-case operation IDs so the local tie-break matches the server's uuid ordering", () => {
    const upper = validateWire({
      entity: "sessions",
      record_id: "x",
      revision: 1,
      operation_id: "ABCDEF00-0000-4000-8000-000000000000",
      deleted: true,
      payload: null,
    });
    expect(upper.operation_id).toBe("abcdef00-0000-4000-8000-000000000000");
  });
});

describe("local rows written before validation normalised them", () => {
  it("does not let a stale untrimmed local copy overwrite a newer remote change", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    // A legacy row with stray whitespace: zod's trim() normalises it, the raw row does not.
    await a.local.pantry.put({
      id: "flour",
      updatedAt: 1,
      name: "Flour ",
      quantity: 1,
      unit: "g",
      form: "powder",
    });
    const engineA = engineFor(a, cloud);
    const engineB = engineFor(b, cloud);
    await engineA.run();
    await engineB.run();
    await b.local.pantry.put({
      id: "flour",
      updatedAt: 2,
      name: "Bread flour",
      quantity: 1,
      unit: "g",
      form: "powder",
    });
    await engineB.run();
    await engineA.run();
    expect((await a.local.pantry.get("flour"))?.name).toBe("Bread flour");
    expect(cloud.records.get("pantry/flour")!.payload).toMatchObject({
      name: "Bread flour",
    });
  });
});

describe("invalid local rows", () => {
  it("keeps an invalid legacy row locally, never tombstones it, and still syncs the valid records", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("chicken", { notes: "valid" });
    // Written directly, bypassing validation, as an older app version could have done.
    await device.local.pantry.put({
      id: "legacy",
      updatedAt: 1,
      name: 123,
      quantity: 1,
      unit: "g",
      form: "x",
    } as never);
    const result = await engine.run();
    expect(result.rejected).toBe(1);
    expect(cloud.records.has("recipeStates/chicken")).toBe(true);
    expect(cloud.records.has("pantry/legacy")).toBe(false);
    expect(await device.local.pantry.count()).toBe(1);
    // A later pass must not turn the invalid row into a deletion either.
    await engine.run();
    expect(cloud.records.has("pantry/legacy")).toBe(false);
  });
});

describe("LOGIC-10 on singleton preferences", () => {
  it("first sync with different preferences on two devices keeps the losing value as a conflict", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    await a.actions.savePreferences({ name: "Alice kitchen" } as never);
    await b.actions.savePreferences({ name: "Bob kitchen" } as never);
    const engineA = engineFor(a, cloud);
    const engineB = engineFor(b, cloud);
    await engineA.run();
    await engineB.run();
    await engineA.run();
    await engineB.run();
    const winner = (await a.local.preferences.get("preferences"))!.name;
    expect((await b.local.preferences.get("preferences"))!.name).toBe(winner);
    const loser = winner === "Alice kitchen" ? "Bob kitchen" : "Alice kitchen";
    const kept = (await engineA.listConflicts()).concat(
      await engineB.listConflicts(),
    );
    expect(
      kept.map(
        (conflict) =>
          (conflict.local as { name?: string } | null)?.name ??
          (conflict.remote as { name?: string } | null)?.name,
      ),
    ).toContain(loser);
  });
});

describe("ARCH-2: clearing the sync cache must not overwrite a newer offline edit", () => {
  it("a newer offline edit survives a cache clear: it is kept as a conflict, not overwritten", async () => {
    const cloud = new FakeCloud();
    const laptop = openDevice();
    const phone = openDevice();
    const laptopEngine = engineFor(laptop, cloud);
    await laptop.actions.patchRecipeState("chicken", { notes: "v1" });
    await laptopEngine.run();
    await laptop.actions.patchRecipeState("chicken", { notes: "v2" });
    await laptopEngine.run();
    // The phone catches up to server revision 2, then edits offline without syncing.
    await engineFor(phone, cloud).run();
    await phone.actions.patchRecipeState("chicken", { notes: "v3" });
    await forgetSyncBaselines(phone.metadata);
    await engineFor(phone, cloud).run();
    const kept = (await phone.metadata.conflicts.toArray()).map(
      (conflict) => (conflict.local as { notes?: string } | null)?.notes,
    );
    expect(kept).toContain("v3");
    expect(cloud.records.get("recipeStates/chicken")!.payload).toMatchObject({
      notes: "v2",
    });
  });

  it("without a cache clear the same offline edit simply wins as revision 3", async () => {
    const cloud = new FakeCloud();
    const laptop = openDevice();
    const phone = openDevice();
    const laptopEngine = engineFor(laptop, cloud);
    await laptop.actions.patchRecipeState("chicken", { notes: "v1" });
    await laptopEngine.run();
    await laptop.actions.patchRecipeState("chicken", { notes: "v2" });
    await laptopEngine.run();
    await engineFor(phone, cloud).run();
    await phone.actions.patchRecipeState("chicken", { notes: "v3" });
    await engineFor(phone, cloud).run();
    expect(cloud.records.get("recipeStates/chicken")!.payload).toMatchObject({
      notes: "v3",
    });
  });

  it("refuses to clear the cache while conflicts are unresolved, and changes nothing", async () => {
    const cloud = new FakeCloud();
    const a = openDevice();
    const b = openDevice();
    await a.actions.patchRecipeState("chicken", { notes: "A" });
    await b.actions.patchRecipeState("chicken", { notes: "B" });
    await engineFor(a, cloud).run();
    await engineFor(b, cloud).run();
    await engineFor(a, cloud).run();
    const before = await b.metadata.conflicts.count();
    expect(
      before + (await a.metadata.conflicts.count()),
    ).toBeGreaterThanOrEqual(1);
    const target = (await b.metadata.conflicts.count()) ? b : a;
    await expect(forgetSyncBaselines(target.metadata)).rejects.toThrow(
      "Resolve the sync conflicts",
    );
    expect(await target.metadata.records.count()).toBeGreaterThan(0);
  });
});

describe("ARCH-23: configuration errors stop the pass without rejecting records, and rejected records can be retried", () => {
  it("classifies a row-level-security or grant denial (42501) as a config error that keeps the queue", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("chicken", {
      notes: "waiting for config",
    });
    cloud.plan = [() => new SyncError("Cloud write failed: denied", "config")];
    const error = await engine.run().catch((caught: unknown) => caught);
    expect(classifySyncError(error)).toBe("config");
    expect(await engine.pendingCount()).toBe(1);
    expect(await engine.rejectedCount()).toBe(0);
    // Once the project is fixed, the same queued change is sent without any manual step.
    const result = await engine.run();
    expect(result.pending).toBe(0);
    expect(cloud.records.has("recipeStates/chicken")).toBe(true);
  });

  it("retryRejected re-queues permanently rejected records after the cause is fixed, and keeps their values", async () => {
    const cloud = new FakeCloud();
    const device = openDevice();
    const engine = engineFor(device, cloud);
    await device.actions.patchRecipeState("chicken", {
      notes: "refused first",
    });
    cloud.plan = [() => new SyncError("check constraint", "permanent")];
    expect((await engine.run()).rejected).toBe(1);
    const cleared = await retryRejected(device.metadata);
    expect(cleared).toBe(1);
    const result = await engine.run();
    expect(result.rejected).toBe(0);
    expect(cloud.records.get("recipeStates/chicken")!.payload).toMatchObject({
      notes: "refused first",
    });
  });

  it("retryRejected does nothing when no record is rejected", async () => {
    const device = openDevice();
    expect(await retryRejected(device.metadata)).toBe(0);
  });
});
