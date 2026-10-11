import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KitchenDB } from "../lib/db";
import {
  classifySyncError,
  deleteAllSyncState,
  forgetSyncBaselines,
  listConflicts,
  resolveConflict,
  retryDelay,
  retryRejected,
  SyncDB,
  SyncEngine,
  SyncError,
  type ConflictRecord,
} from "./core";
import { createSupabaseAdapter, type CloudConfig } from "./supabase";

export interface CloudStatus {
  phase:
    "unconfigured" | "signed-out" | "ready" | "syncing" | "offline" | "error";
  email: string | null;
  enabled: boolean;
  // Queued changes that will be sent on a later pass.
  pending: number;
  // Changes the server permanently refused, or remote rows this app cannot read. Local copies are kept.
  rejected: number;
  // Values displaced by a same-record conflict and kept on this device for the owner to choose.
  conflicts: number;
  lastSyncedAt: number | null;
  message: string;
}
export type SyncDisplayState =
  "saved-locally" | "waiting" | "syncing" | "synced" | "failed" | "conflict";
// What the owner should be told. Priority: failure first, then conflicts that need a decision.
export function syncDisplayState(value: CloudStatus): SyncDisplayState {
  if (value.phase === "error" || value.rejected > 0) return "failed";
  if (value.conflicts > 0) return "conflict";
  if (!value.enabled || value.phase === "offline") return "saved-locally";
  if (value.phase === "syncing") return "syncing";
  if (value.pending > 0) return "waiting";
  return "synced";
}

export interface CloudControllerOptions {
  local: KitchenDB;
  metadata: SyncDB;
  // Null when the build has no valid project configured.
  configuration: () => CloudConfig | null;
  createClient: (config: CloudConfig, accessToken?: string) => SupabaseClient;
  // Web Locks serialise passes across tabs. Undefined means sync cannot be enabled safely.
  locks: LockManager | undefined;
  isOnline: () => boolean;
  // Notified when the browser regains network. Optional so tests can run without a window.
  onOnline?: (listener: () => void) => () => void;
}

export interface CloudController {
  getStatus(): CloudStatus;
  subscribe(listener: () => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  enableSync(): Promise<void>;
  syncNow(): Promise<void>;
  signOut(): Promise<void>;
  listConflicts(): Promise<ConflictRecord[]>;
  resolveConflict(key: string, side: "local" | "remote"): Promise<void>;
  retryRejected(): Promise<number>;
  forgetCache(): Promise<void>;
  deleteLocalState(): Promise<void>;
}

export function createCloudController(
  options: CloudControllerOptions,
): CloudController {
  const { local, metadata } = options;
  const configured = options.configuration() !== null;
  let status: CloudStatus = {
    phase: configured ? "signed-out" : "unconfigured",
    email: null,
    enabled: false,
    pending: 0,
    rejected: 0,
    conflicts: 0,
    lastSyncedAt: null,
    message: configured
      ? "Cloud is optional. Sign in to continue."
      : "Cloud sync is not configured. Your data stays on this device.",
  };
  const listeners = new Set<() => void>();
  function update(patch: Partial<CloudStatus>) {
    status = { ...status, ...patch };
    listeners.forEach((listener) => listener());
  }
  let client: SupabaseClient | undefined;
  let engine: SyncEngine | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let running = false;
  // The account this browser enabled sync for. Only meaningful while sync is enabled.
  let enabledUserId: string | undefined;
  let stopOnline: (() => void) | undefined;

  function configurationOrThrow(): CloudConfig {
    const config = options.configuration();
    if (!config)
      throw new Error(
        "Configure a valid HTTPS Supabase URL and public publishable key first.",
      );
    return config;
  }
  function getClient(): SupabaseClient {
    if (client) return client;
    client = options.createClient(configurationOrThrow());
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        stopLoop();
        engine = undefined;
        // A later sign-in is a fresh choice, not a change of the account this browser had enabled.
        enabledUserId = undefined;
        update({
          phase: "signed-out",
          enabled: false,
          email: null,
          message: "Signed out. Local data remain on this device.",
        });
      }
      // Only an account change while sync is enabled is a conflict. Before enabling, a new sign-in is normal.
      if (
        event === "SIGNED_IN" &&
        status.enabled &&
        enabledUserId &&
        session?.user.id !== enabledUserId
      ) {
        stopLoop();
        engine = undefined;
        update({
          phase: "error",
          enabled: false,
          message:
            "The account changed in another tab. Cloud sync stopped to protect account isolation.",
        });
      }
    });
    return client;
  }
  async function authenticatedSession() {
    const supabase = getClient();
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();
    if (sessionError || !sessionData.session)
      throw new SyncError("Sign in before enabling sync.", "auth");
    let session = sessionData.session;
    if ((session.expires_at ?? 0) * 1000 < Date.now() + 60000) {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session)
        throw new SyncError(
          "Your session expired. Please sign in again.",
          "auth",
        );
      session = data.session;
    }
    const { data, error } = await supabase.auth.getUser(session.access_token);
    if (error || !data.user)
      throw new Error(
        "Could not verify your cloud account. Sign in again when online.",
      );
    return { user: data.user, accessToken: session.access_token };
  }
  function stopLoop() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    stopOnline?.();
    stopOnline = undefined;
  }
  function onlineRetry() {
    if (status.enabled)
      void syncNow().catch(() => {
        /* Status exposes failures; queued edits are retained. */
      });
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    if (!status.enabled) return;
    timer = setTimeout(() => {
      void syncNow().catch(() => {
        /* Next retry is scheduled by syncNow. */
      });
    }, retryDelay(failures));
  }

  async function signIn(email: string, password: string): Promise<void> {
    if (running)
      throw new Error("Wait for the current sync before changing accounts.");
    z.email().max(320).parse(email);
    z.string().min(1).max(1024).parse(password);
    stopLoop();
    engine = undefined;
    update({ enabled: false });
    const { data, error } = await getClient().auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) {
      update({
        phase: "error",
        message: "Sign-in failed. Check your details and connection.",
      });
      throw new Error("Sign-in failed. Check your details and connection.");
    }
    update({
      phase: "ready",
      email: data.user.email ?? email,
      message:
        "Signed in. Enable sync explicitly to send and receive your kitchen data.",
    });
  }

  async function enableSync(): Promise<void> {
    if (!options.locks)
      throw new Error(
        "This browser does not support the Web Locks required for safe multi-tab cloud sync.",
      );
    const { user, accessToken } = await authenticatedSession();
    const config = configurationOrThrow();
    const candidate = new SyncEngine(
      local,
      metadata,
      createSupabaseAdapter(options.createClient(config, accessToken), user.id),
    );
    await candidate.bind(`${config.url}|${user.id}`);
    engine = candidate;
    enabledUserId = user.id;
    update({
      enabled: true,
      email: user.email ?? null,
      phase: "ready",
      message: "Cloud sync enabled for this browser session.",
    });
    stopOnline?.();
    stopOnline = options.onOnline?.(onlineRetry);
    await syncNow();
  }

  async function syncNow(): Promise<void> {
    if (!status.enabled || !engine) throw new Error("Enable cloud sync first.");
    if (running) return;
    if (!options.isOnline()) {
      update({
        phase: "offline",
        message:
          "Offline. Changes stay on this device and will retry when connected.",
      });
      schedule();
      return;
    }
    running = true;
    try {
      await options.locks!.request(
        "airfuel-cloud-sync",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            update({
              phase: "ready",
              message: "Another tab is syncing. This tab will retry shortly.",
            });
            return;
          }
          const { user, accessToken } = await authenticatedSession();
          const config = configurationOrThrow();
          // Pin this pass to its verified token so a different tab cannot switch its owner mid-write.
          const currentEngine = new SyncEngine(
            local,
            metadata,
            createSupabaseAdapter(
              options.createClient(config, accessToken),
              user.id,
              () => status.enabled && enabledUserId === user.id,
            ),
          );
          await currentEngine.bind(`${config.url}|${user.id}`);
          update({ phase: "syncing", message: "Synchronising your kitchen…" });
          const result = await currentEngine.run();
          failures = 0;
          const rejected = result.rejected + result.unreadable;
          update({
            phase: "ready",
            pending: result.pending,
            rejected,
            conflicts: result.conflicts,
            lastSyncedAt: Date.now(),
            message:
              rejected > 0
                ? `${rejected} item(s) could not be synced. Your copies are kept on this device.`
                : result.conflicts > 0
                  ? `${result.conflicts} conflict(s) need a decision. Both versions are kept on this device.`
                  : result.pending
                    ? `${result.pending} recent changes queued for the next pass.`
                    : "Synced with your configured project.",
          });
        },
      );
    } catch (error) {
      const kind = classifySyncError(error);
      const authFailure = kind === "auth";
      // An expired or revoked session cannot succeed on retry. Stop the loop until the owner signs in.
      if (authFailure) {
        stopLoop();
        engine = undefined;
        failures = 0;
      } else failures++;
      const message = authFailure
        ? "Your cloud session needs you to sign in again. Changes stay on this device and will sync after you enable sync."
        : kind === "config"
          ? "The cloud project refused this sync (permissions or row-level security). Local changes are kept and will retry automatically. Check the project's sync setup."
          : error instanceof Error
            ? error.message
            : "Cloud sync failed. Your local data and pending changes are retained.";
      update({
        phase: "error",
        ...(authFailure ? { enabled: false } : {}),
        pending: await metadata.records
          .toArray()
          .then(
            (rows) => rows.filter((row) => row.pending && !row.blocked).length,
          )
          .catch(() => status.pending),
        message,
      });
      throw new Error(message, { cause: error });
    } finally {
      running = false;
      schedule();
    }
  }

  async function signOut(): Promise<void> {
    if (running)
      throw new Error(
        "Wait for the current sync to finish before signing out.",
      );
    stopLoop();
    engine = undefined;
    update({ enabled: false });
    const { error } = await getClient().auth.signOut({ scope: "local" });
    if (error) {
      update({
        phase: "error",
        message:
          "Could not sign out. Sync has stopped; retry sign-out when connected.",
      });
      throw new Error(
        "Could not sign out. Sync has stopped; retry when connected.",
      );
    }
    update({
      phase: "signed-out",
      email: null,
      message:
        "Signed out. Local data and account binding remain on this device.",
    });
  }

  async function resolveLocalConflict(
    key: string,
    side: "local" | "remote",
  ): Promise<void> {
    if (running)
      throw new Error("Wait for the current sync before resolving a conflict.");
    await resolveConflict(local, metadata, key, side);
    update({
      conflicts: await metadata.conflicts.count().catch(() => status.conflicts),
    });
  }

  // Re-queues refused records after the owner has fixed the cause (for example a project setting).
  async function retryRejectedRecords(): Promise<number> {
    if (running)
      throw new Error(
        "Wait for the current sync before retrying rejected changes.",
      );
    const cleared = await retryRejected(metadata);
    update({
      rejected: await metadata.records
        .filter((row) => !!row.blocked)
        .count()
        .catch(() => status.rejected),
      pending: await metadata.records
        .filter((row) => !!row.pending && !row.blocked)
        .count()
        .catch(() => status.pending),
    });
    return cleared;
  }

  // Shared guard: a cache clear needs sync off, no pass running, and no signed-in session.
  async function assertIdleAndSignedOut(message: string): Promise<void> {
    if (status.enabled || running) throw new Error(message);
    if (options.configuration() !== null) {
      const { data, error } = await getClient().auth.getSession();
      if (error || data.session)
        throw new Error(
          "Sign out of the cloud account before clearing the cloud cache.",
        );
    }
  }
  async function clearUnderLock(clear: () => Promise<void>): Promise<void> {
    if (options.locks) {
      await options.locks.request(
        "airfuel-cloud-sync",
        { ifAvailable: true },
        async (lock) => {
          if (!lock)
            throw new Error(
              "Another tab is syncing. Wait before clearing the cloud cache.",
            );
          await clear();
        },
      );
    } else await clear();
  }
  // Plain reset: keeps local values and refuses while conflicts are unresolved.
  async function forgetCache(): Promise<void> {
    await assertIdleAndSignedOut("Sign out before clearing the cloud cache.");
    await clearUnderLock(() => forgetSyncBaselines(metadata));
    update({ pending: 0, rejected: 0, lastSyncedAt: null });
  }
  // Delete-all: removes every sync record on this device, conflicts and account binding included.
  async function deleteLocalState(): Promise<void> {
    await assertIdleAndSignedOut(
      "Sign out before deleting cloud data on this device.",
    );
    await clearUnderLock(() => deleteAllSyncState(metadata));
    update({
      pending: 0,
      rejected: 0,
      conflicts: 0,
      lastSyncedAt: null,
    });
  }

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signIn,
    enableSync,
    syncNow,
    signOut,
    listConflicts: () => listConflicts(metadata),
    resolveConflict: resolveLocalConflict,
    retryRejected: retryRejectedRecords,
    forgetCache,
    deleteLocalState,
  };
}
