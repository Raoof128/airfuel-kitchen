// Cloud controller (the stateful part of sync) with a fake Supabase client and fake Web Locks.
// No network. Covers sign-in and account-change detection (ARCH-7), enable and sync scheduling rules,
// offline behaviour, configuration errors (ARCH-23) and cache-clear refusal rules (ARCH-2).
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCloudController,
  type CloudController,
} from "../../src/cloud/controller";
import { SyncDB } from "../../src/cloud/core";
import { createActions, KitchenDB } from "../../src/lib/db";

const ALICE = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "alice@example.com",
};
const BOB = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "bob@example.com",
};
const CONFIG = {
  url: "https://example.supabase.co",
  publicKey: "sb_publishable_0123456789abcdefghijkl",
};

type AuthEvent = "SIGNED_IN" | "SIGNED_OUT";
interface Fake {
  client: SupabaseClient;
  user: { id: string; email: string } | null;
  emit(event: AuthEvent, session: { user: { id: string } } | null): void;
  rpcError: { code: string; message: string } | null;
  rpcCalls: number;
}

// Supabase emits SIGNED_IN during signInWithPassword and SIGNED_OUT during signOut. The fake does the same.
function fakeSupabase(): Fake {
  const listeners: ((
    event: AuthEvent,
    session: { user: { id: string } } | null,
  ) => void)[] = [];
  const fake: Fake = {
    client: undefined as unknown as SupabaseClient,
    user: null,
    rpcError: null,
    rpcCalls: 0,
    emit(event, session) {
      for (const listener of listeners) listener(event, session);
    },
  };
  const session = () =>
    fake.user
      ? {
          access_token: "token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: fake.user,
        }
      : null;
  const auth = {
    onAuthStateChange(
      listener: (
        event: AuthEvent,
        session: { user: { id: string } } | null,
      ) => void,
    ) {
      listeners.push(listener);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async getSession() {
      return { data: { session: session() }, error: null };
    },
    async refreshSession() {
      return { data: { session: session() }, error: null };
    },
    async getUser() {
      return { data: { user: fake.user }, error: null };
    },
    async signInWithPassword({ email }: { email: string }) {
      fake.user = email === ALICE.email ? ALICE : BOB;
      fake.emit("SIGNED_IN", { user: fake.user });
      return { data: { user: fake.user }, error: null };
    },
    async signOut() {
      fake.user = null;
      fake.emit("SIGNED_OUT", null);
      return { error: null };
    },
  };
  const rpc = async (_name: string, args: Record<string, unknown>) => {
    fake.rpcCalls++;
    if (fake.rpcError) return { data: null, error: fake.rpcError };
    const row = {
      user_id: fake.user!.id,
      entity: args.p_entity,
      record_id: args.p_record_id,
      revision: args.p_revision,
      operation_id: args.p_operation_id,
      deleted: args.p_deleted,
      payload: args.p_payload,
    };
    return { data: [row], error: null };
  };
  const from = () => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: async () => ({ data: [], error: null, count: 0 }),
    };
    return builder;
  };
  fake.client = { auth, rpc, from } as unknown as SupabaseClient;
  return fake;
}

const locks = {
  async request(
    _name: string,
    _options: unknown,
    callback: (lock: unknown) => Promise<void>,
  ) {
    await callback({ name: "airfuel-cloud-sync" });
  },
} as unknown as LockManager;

const opened: (KitchenDB | SyncDB)[] = [];
const controllers: CloudController[] = [];
afterEach(async () => {
  // Stop any scheduled retry timers before the databases are removed.
  for (const controller of controllers.splice(0)) {
    await controller.signOut().catch(() => undefined);
  }
  for (const database of opened.splice(0)) await database.delete();
});

function harness(options: { locks?: LockManager; online?: boolean } = {}) {
  const fake = fakeSupabase();
  const local = new KitchenDB(`controller-${crypto.randomUUID()}-local`);
  const metadata = new SyncDB(`controller-${crypto.randomUUID()}-sync`);
  opened.push(local, metadata);
  let online = options.online ?? true;
  const controller = createCloudController({
    local,
    metadata,
    configuration: () => CONFIG,
    createClient: () => fake.client,
    locks: "locks" in options ? options.locks : locks,
    isOnline: () => online,
  });
  controllers.push(controller);
  return {
    fake,
    local,
    metadata,
    controller,
    actions: createActions(local),
    goOffline: () => {
      online = false;
    },
  };
}

describe("ARCH-7: a new sign-in after sign-out is not an account change", () => {
  it("signing in as another account after sign-out does not show the account-changed error", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await h.controller.signOut();
    await h.controller.signIn(BOB.email, "pw");
    const status = h.controller.getStatus();
    expect(status.phase).toBe("ready");
    expect(status.message).not.toContain("account changed");
  });

  it("still stops sync when a different account signs in while sync is enabled", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    h.fake.emit("SIGNED_IN", { user: BOB });
    const status = h.controller.getStatus();
    expect(status.phase).toBe("error");
    expect(status.enabled).toBe(false);
    expect(status.message).toContain("account changed");
  });
});

describe("controller rules (ARCH-19 seam)", () => {
  it("refuses to enable sync where Web Locks are unavailable", async () => {
    const h = harness({ locks: undefined });
    await h.controller.signIn(ALICE.email, "pw");
    await expect(h.controller.enableSync()).rejects.toThrow("Web Locks");
  });

  it("refuses a sync before sync is enabled", async () => {
    const h = harness();
    await expect(h.controller.syncNow()).rejects.toThrow(
      "Enable cloud sync first",
    );
  });

  it("while offline, reports waiting-to-sync without touching the network and keeps the queue", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    const callsBefore = h.fake.rpcCalls;
    await h.actions.patchRecipeState("chicken", { notes: "offline note" });
    h.goOffline();
    await h.controller.syncNow();
    const status = h.controller.getStatus();
    expect(status.phase).toBe("offline");
    expect(h.fake.rpcCalls).toBe(callsBefore);
    expect(status.enabled).toBe(true);
  });

  it("refuses to clear the cache while sync is enabled, and while conflicts are unresolved", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await expect(h.controller.forgetCache()).rejects.toThrow(
      "Sign out before clearing",
    );
    await h.controller.signOut();
    await h.metadata.conflicts.put({
      key: "k",
      entity: "recipeStates",
      recordId: "chicken",
      local: { id: "chicken", notes: "x" },
      remote: null,
      remoteRevision: 1,
      remoteOperationId: "00000000-0000-4000-8000-000000000009",
      createdAt: 1,
    });
    await expect(h.controller.forgetCache()).rejects.toThrow(
      "Resolve the sync conflicts",
    );
  });
});

describe("ARCH-23 through the controller", () => {
  it("a row-level-security denial stops the pass with setup guidance, keeps the queued change and stays enabled", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await h.actions.patchRecipeState("chicken", { notes: "queued" });
    h.fake.rpcError = {
      code: "42501",
      message: "new row violates row-level security policy",
    };
    await expect(h.controller.syncNow()).rejects.toThrow();
    const status = h.controller.getStatus();
    expect(status.phase).toBe("error");
    expect(status.message).toContain("row-level security");
    expect(status.enabled).toBe(true);
    expect(status.rejected).toBe(0);
    expect(status.pending).toBe(1);
  });

  it("retryRejectedCloudRecords re-queues refused records through the controller and updates the counts", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await h.actions.patchRecipeState("chicken", { notes: "too big" });
    h.fake.rpcError = { code: "23514", message: "bounded_payload" };
    await h.controller.syncNow().catch(() => undefined);
    // A permanent rejection is marked on the record, not raised as a whole-pass failure.
    expect(h.controller.getStatus().rejected).toBe(1);
    h.fake.rpcError = null;
    const cleared = await h.controller.retryRejected();
    expect(cleared).toBe(1);
    const status = h.controller.getStatus();
    expect(status.rejected).toBe(0);
    expect(status.pending).toBe(1);
  });

  it("an expired session stops automatic sync and asks for sign-in", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await h.actions.patchRecipeState("chicken", { notes: "needs sign-in" });
    h.fake.rpcError = { code: "PGRST301", message: "JWT expired" };
    await expect(h.controller.syncNow()).rejects.toThrow();
    const status = h.controller.getStatus();
    expect(status.enabled).toBe(false);
    expect(status.message).toContain("sign in again");
  });
});

describe("delete-all with unresolved conflicts", () => {
  it("deleteLocalCloudState leaves the sync database empty, while the plain reset still refuses", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await h.actions.patchRecipeState("chicken", { notes: "personal" });
    await h.controller.syncNow();
    await h.metadata.conflicts.put({
      key: "personal-conflict",
      entity: "recipeStates",
      recordId: "chicken",
      local: { id: "chicken", notes: "kept personal copy" },
      remote: { id: "chicken", notes: "cloud copy" },
      remoteRevision: 2,
      remoteOperationId: "00000000-0000-4000-8000-000000000009",
      createdAt: 1,
    });
    await h.controller.signOut();
    await expect(h.controller.forgetCache()).rejects.toThrow(
      "Resolve the sync conflicts",
    );
    expect(await h.metadata.conflicts.count()).toBe(1);
    await h.controller.deleteLocalState();
    expect(await h.metadata.records.count()).toBe(0);
    expect(await h.metadata.conflicts.count()).toBe(0);
    expect(await h.metadata.meta.count()).toBe(0);
  });

  it("deleteLocalCloudState refuses while sync is enabled", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await expect(h.controller.deleteLocalState()).rejects.toThrow(
      "Sign out before deleting",
    );
  });
});

describe("quota refusal reaches the owner", () => {
  it("a storage-quota refusal is shown as a rejected record with its reason in the status message", async () => {
    const h = harness();
    await h.controller.signIn(ALICE.email, "pw");
    await h.controller.enableSync();
    await h.actions.patchRecipeState("chicken", { notes: "too much" });
    h.fake.rpcError = {
      code: "53400",
      message:
        "Storage quota exceeded: this account would exceed the 64 MiB sync storage limit",
    };
    await h.controller.syncNow();
    const status = h.controller.getStatus();
    expect(status.rejected).toBe(1);
    expect(status.message).toContain("Storage quota exceeded");
    expect(status.enabled).toBe(true);
  });
});
