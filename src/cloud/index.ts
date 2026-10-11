import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "../lib/db";
import { SyncDB, SyncEngine } from "./core";
import {
  createCloudClient,
  createSupabaseAdapter,
  parseCloudConfig,
} from "./supabase";

function configuration() {
  return parseCloudConfig(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}
export function cloudConfigured(): boolean {
  return configuration() !== null;
}
export interface CloudStatus {
  phase:
    "unconfigured" | "signed-out" | "ready" | "syncing" | "offline" | "error";
  email: string | null;
  enabled: boolean;
  pending: number;
  lastSyncedAt: number | null;
  message: string;
}
let status: CloudStatus = {
  phase: cloudConfigured() ? "signed-out" : "unconfigured",
  email: null,
  enabled: false,
  pending: 0,
  lastSyncedAt: null,
  message: cloudConfigured()
    ? "Cloud is optional. Sign in to continue."
    : "Cloud sync is not configured. Your data stays on this device.",
};
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function update(patch: Partial<CloudStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}
export function useCloudStatus(): CloudStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );
}
let client: SupabaseClient | undefined;
let engine: SyncEngine | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let running = false;
let enabledUserId: string | undefined;
const metadata = new SyncDB();
function getClient(): SupabaseClient {
  if (client) return client;
  const config = configuration();
  if (!config)
    throw new Error(
      "Configure a valid HTTPS Supabase URL and public publishable key first.",
    );
  client = createCloudClient(config);
  client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      stopLoop();
      engine = undefined;
      update({
        phase: "signed-out",
        enabled: false,
        email: null,
        message: "Signed out. Local data remain on this device.",
      });
    }
    if (
      event === "SIGNED_IN" &&
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
    throw new Error("Sign in before enabling sync.");
  let session = sessionData.session;
  if ((session.expires_at ?? 0) * 1000 < Date.now() + 60000) {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data.session)
      throw new Error("Your session expired. Please sign in again.");
    session = data.session;
  }
  const { data, error } = await supabase.auth.getUser(session.access_token);
  if (error || !data.user)
    throw new Error(
      "Could not verify your cloud account. Sign in again when online.",
    );
  return { user: data.user, accessToken: session.access_token };
}
export async function signIn(email: string, password: string): Promise<void> {
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
export async function enableSync(): Promise<void> {
  if (!navigator.locks)
    throw new Error(
      "This browser does not support the Web Locks required for safe multi-tab cloud sync.",
    );
  const { user, accessToken } = await authenticatedSession();
  const candidate = new SyncEngine(
    db,
    metadata,
    createSupabaseAdapter(
      createCloudClient(configuration()!, accessToken),
      user.id,
    ),
  );
  await candidate.bind(`${configuration()!.url}|${user.id}`);
  engine = candidate;
  enabledUserId = user.id;
  update({
    enabled: true,
    email: user.email ?? null,
    phase: "ready",
    message: "Cloud sync enabled for this browser session.",
  });
  window.addEventListener("online", onlineRetry);
  await syncNow();
}
function stopLoop() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (typeof window !== "undefined")
    window.removeEventListener("online", onlineRetry);
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
  timer = setTimeout(
    () => {
      void syncNow().catch(() => {
        /* Next retry is scheduled by syncNow. */
      });
    },
    Math.min(300000, 30000 * 2 ** Math.min(failures, 4)),
  );
}
export async function syncNow(): Promise<void> {
  if (!status.enabled || !engine) throw new Error("Enable cloud sync first.");
  if (running) return;
  if (!navigator.onLine) {
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
    await navigator.locks.request(
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
        // Pin this pass to its verified token so a different tab cannot switch its owner mid-write.
        const currentEngine = new SyncEngine(
          db,
          metadata,
          createSupabaseAdapter(
            createCloudClient(configuration()!, accessToken),
            user.id,
            () => status.enabled && enabledUserId === user.id,
          ),
        );
        await currentEngine.bind(`${configuration()!.url}|${user.id}`);
        update({ phase: "syncing", message: "Synchronising your kitchen…" });
        const result = await currentEngine.run();
        failures = 0;
        update({
          phase: "ready",
          pending: result.pending,
          lastSyncedAt: Date.now(),
          message: result.pending
            ? `${result.pending} recent changes queued for the next pass.`
            : "Synced with your configured project.",
        });
      },
    );
  } catch (error) {
    failures++;
    const message =
      error instanceof Error
        ? error.message
        : "Cloud sync failed. Your local data and pending changes are retained.";
    update({
      phase: "error",
      pending: await metadata.records
        .toArray()
        .then((rows) => rows.filter((row) => row.pending).length)
        .catch(() => status.pending),
      message,
    });
    throw new Error(message, { cause: error });
  } finally {
    running = false;
    schedule();
  }
}
export async function signOut(): Promise<void> {
  if (running)
    throw new Error("Wait for the current sync to finish before signing out.");
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
export async function forgetCloudCache(): Promise<void> {
  if (status.enabled || running)
    throw new Error("Sign out before clearing the cloud cache.");
  if (cloudConfigured()) {
    const { data, error } = await getClient().auth.getSession();
    if (error || data.session)
      throw new Error(
        "Sign out of the cloud account before clearing the cloud cache.",
      );
  }
  // Keep only the non-content account binding; discard notes duplicated in baselines/outbox.
  if (navigator.locks) {
    await navigator.locks.request(
      "airfuel-cloud-sync",
      { ifAvailable: true },
      async (lock) => {
        if (!lock)
          throw new Error(
            "Another tab is syncing. Wait before clearing the cloud cache.",
          );
        await metadata.records.clear();
      },
    );
  } else await metadata.records.clear();
  update({ pending: 0, lastSyncedAt: null });
}
