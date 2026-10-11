import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  compareVersion,
  SyncError,
  validateWire,
  type CloudAdapter,
  type SyncErrorKind,
  type WireRecord,
} from "./core";

// Per-account row quota enforced by airfuel_apply_change (migration 202610110003, SEC-9). Keep equal to it.
// Reads must reach every row an account is allowed to hold, tombstones included (RT-B6).
export const SYNC_RECORD_QUOTA = 224_006;
export interface CloudConfig {
  url: string;
  publicKey: string;
}
export function parseCloudConfig(
  url: unknown,
  key: unknown,
): CloudConfig | null {
  if (typeof url !== "string" || typeof key !== "string" || !url || !key)
    return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    )
      return null;
    if (key.startsWith("sb_publishable_") && key.length > 20)
      return { url: parsed.origin, publicKey: key };
    // Legacy anon JWTs are public. Reject role-bearing privileged keys explicitly.
    const segments = key.split(".");
    if (segments.length !== 3) return null;
    const payload = JSON.parse(
      atob(segments[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: unknown };
    return payload.role === "anon"
      ? { url: parsed.origin, publicKey: key }
      : null;
  } catch {
    return null;
  }
}
export function createCloudClient(
  config: CloudConfig,
  accessToken?: string,
): SupabaseClient {
  return createClient(config.url, config.publicKey, {
    ...(accessToken ? { accessToken: async () => accessToken } : {}),
    auth: {
      persistSession: !accessToken,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `airfuel-supabase-auth:${new URL(config.url).hostname}`,
    },
    global: {
      // Bound stalled requests so the retry loop and multi-tab lock can recover.
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal
            ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
            : AbortSignal.timeout(20000),
        }),
    },
  });
}
// Maps a PostgREST/Postgres error to a retry policy. Unknown errors are transient, so a network blip is retried.
export function postgrestErrorKind(error: {
  code?: string;
  message?: string;
}): SyncErrorKind {
  const code = error.code ?? "";
  const message = error.message ?? "";
  // PGRST301/302 are JWT rejections; the raised "Authentication required" carries 42501 but is an auth fault.
  if (
    code === "PGRST301" ||
    code === "PGRST302" ||
    message === "Authentication required" ||
    /jwt/i.test(message)
  )
    return "auth";
  // A privilege or row-level-security denial is a project setup fault, not a bad record. It is fixed by
  // changing the setup, so it is retried with backoff and never marks records as rejected.
  if (code === "42501") return "config";
  // Data and constraint violations cannot succeed on retry.
  if (/^(22|23)/.test(code) || code === "P0001") return "permanent";
  // The account's sync record quota (SEC-9) is reached. Only this record is refused; retrying cannot help.
  if (code === "53400") return "permanent";
  return "transient";
}
function remoteRecord(
  row: Record<string, unknown>,
  userId: string,
): WireRecord {
  if (row.user_id !== userId)
    // Stops the pass: returned data may belong to someone else, so nothing from it is trusted.
    throw new SyncError(
      "Cloud returned a record belonging to another account.",
      "auth",
    );
  return validateWire({
    entity: row.entity,
    record_id: row.record_id,
    revision: row.revision,
    operation_id: row.operation_id,
    deleted: row.deleted,
    payload: row.payload,
  });
}
export function createSupabaseAdapter(
  client: SupabaseClient,
  userId: string,
  isActive = () => true,
): CloudAdapter {
  const ensureActive = () => {
    if (!isActive())
      throw new SyncError(
        "Cloud sync stopped because the signed-in account changed.",
        "auth",
      );
  };
  let unreadable = 0;
  return {
    unreadableCount: () => unreadable,
    async apply(input) {
      ensureActive();
      const record = validateWire(input);
      const { data, error } = await client.rpc("airfuel_apply_change", {
        p_entity: record.entity,
        p_record_id: record.record_id,
        p_revision: record.revision,
        p_operation_id: record.operation_id,
        p_deleted: record.deleted,
        p_payload: record.payload,
      });
      ensureActive();
      if (error)
        throw new SyncError(
          `Cloud write failed: ${error.message}`,
          postgrestErrorKind(error),
        );
      if (!Array.isArray(data) || data.length !== 1)
        throw new Error("Cloud returned an unexpected write response.");
      const winner = remoteRecord(data[0], userId);
      if (
        winner.entity !== record.entity ||
        winner.record_id !== record.record_id ||
        compareVersion(winner, record) < 0
      )
        throw new Error(
          "Cloud returned an inconsistent write acknowledgement.",
        );
      return winner;
    },
    async readAll() {
      const records: WireRecord[] = [];
      const pageSize = 500;
      // Two pages of margin on top of the quota, so a full account is read to completion.
      const maxPages = Math.ceil(SYNC_RECORD_QUOTA / pageSize) + 2;
      unreadable = 0;
      for (let page = 0; page < maxPages; page++) {
        ensureActive();
        const { data, error, count } = await client
          .from("airfuel_user_records")
          .select("*", { count: "exact" })
          .eq("user_id", userId)
          .order("entity")
          .order("record_id")
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error)
          throw new SyncError(
            `Cloud read failed: ${error.message}`,
            postgrestErrorKind(error),
          );
        ensureActive();
        if (!Array.isArray(data))
          throw new Error("Cloud returned an unexpected read response.");
        if (
          data.length < pageSize &&
          count !== null &&
          page * pageSize + data.length < count
        )
          throw new Error(
            "Configure the Supabase API row limit to at least 500 before syncing.",
          );
        for (const row of data) {
          // One invalid remote row (for example from a newer app version) is skipped and counted,
          // so it cannot stall every other record. The row stays in the cloud untouched.
          try {
            records.push(remoteRecord(row, userId));
          } catch (rowError) {
            if (rowError instanceof z.ZodError) unreadable++;
            else throw rowError;
          }
        }
        if (data.length < pageSize) return records;
      }
      throw new Error(
        `Cloud data exceeds the supported ${SYNC_RECORD_QUOTA.toLocaleString("en-US")}-record limit.`,
      );
    },
  };
}
