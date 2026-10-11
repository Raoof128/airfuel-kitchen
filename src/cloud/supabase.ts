import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  compareVersion,
  validateWire,
  type CloudAdapter,
  type WireRecord,
} from "./core";

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
function remoteRecord(
  row: Record<string, unknown>,
  userId: string,
): WireRecord {
  if (row.user_id !== userId)
    throw new Error("Cloud returned a record belonging to another account.");
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
      throw new Error(
        "Cloud sync stopped because the signed-in account changed.",
      );
  };
  return {
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
      if (error) throw new Error(`Cloud write failed: ${error.message}`);
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
      for (let page = 0; page < 400; page++) {
        ensureActive();
        const { data, error, count } = await client
          .from("airfuel_user_records")
          .select("*", { count: "exact" })
          .eq("user_id", userId)
          .order("entity")
          .order("record_id")
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw new Error(`Cloud read failed: ${error.message}`);
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
        records.push(...data.map((row) => remoteRecord(row, userId)));
        if (data.length < pageSize) return records;
      }
      throw new Error("Cloud data exceeds the supported 200,000-record limit.");
    },
  };
}
