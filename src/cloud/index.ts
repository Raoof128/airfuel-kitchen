import { useSyncExternalStore } from "react";
import { db } from "../lib/db";
import { SyncDB } from "./core";
import { createCloudController, type CloudStatus } from "./controller";
import { createCloudClient, parseCloudConfig } from "./supabase";

export type { ConflictRecord, Entity } from "./core";
export type { CloudStatus, SyncDisplayState } from "./controller";
export { syncDisplayState } from "./controller";

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

// One controller per browser page: the app's single cloud state.
const controller = createCloudController({
  local: db,
  metadata: new SyncDB(),
  configuration,
  createClient: createCloudClient,
  locks: typeof navigator !== "undefined" ? navigator.locks : undefined,
  isOnline: () => navigator.onLine,
  onOnline: (listener) => {
    window.addEventListener("online", listener);
    return () => window.removeEventListener("online", listener);
  },
});

export function useCloudStatus(): CloudStatus {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getStatus,
    controller.getStatus,
  );
}
export const signIn = controller.signIn;
export const enableSync = controller.enableSync;
export const syncNow = controller.syncNow;
export const signOut = controller.signOut;
export const listCloudConflicts = controller.listConflicts;
export const resolveCloudConflict = controller.resolveConflict;
export const retryRejectedCloudRecords = controller.retryRejected;
export const forgetCloudCache = controller.forgetCache;
// Delete-all flow: also removes unresolved conflict copies and the account binding on this device.
export const deleteLocalCloudState = controller.deleteLocalState;
