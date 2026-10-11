import { useState } from "react";
import { Cloud, RefreshCw, LogOut } from "lucide-react";
import {
  cloudConfigured,
  useCloudStatus,
  signIn,
  signOut,
  enableSync,
  syncNow,
} from "../cloud";
import { useApp } from "./context";
export function CloudSettings() {
  const { run } = useApp();
  const status = useCloudStatus();
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const configured = cloudConfigured();
  return (
    <section className="settings-section">
      <h2>
        <Cloud size={23} />
        Cross-device sync
      </h2>
      {!configured ? (
        <>
          <p>
            This kitchen works fully on this device without an account. Optional
            Supabase sync is not configured. Setup and live verification
            requirements are documented in the application source.
          </p>
          <span className="status-badge">
            Local only · no data sent to a server
          </span>
        </>
      ) : (
        <>
          <p>
            Sync sends cooking notes, preferences and other personal records to
            your configured Supabase project. Export a backup first. Conflicting
            changes use whole-record revision ordering, so edits to the same
            record can supersede each other.
          </p>
          <p className="notice" role="status">
            {status.message}
            {status.email ? ` · ${status.email}` : ""}
          </p>
          <p className="small muted">
            {status.lastSyncedAt
              ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString("en-AU")}. `
              : ""}
            {status.pending} queued records. Live authorisation tests are
            required before relying on this deployment.
          </p>
          {!status.email && (
            <form
              className="stack-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const password = String(f.get("password"));
                const email = String(f.get("email"));
                e.currentTarget.reset();
                setBusy(true);
                await run(
                  () => signIn(email, password),
                  "Signed in. Enable sync below when you’re ready.",
                );
                setBusy(false);
              }}
            >
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={320}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                />
              </label>
              <button className="button" disabled={busy}>
                Sign in to an existing account
              </button>
            </form>
          )}
          {!status.enabled && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I want to sync this device’s personal data with my account.
              </label>
              <button
                className="button primary"
                disabled={!consent || busy}
                onClick={async () => {
                  setBusy(true);
                  await run(() => enableSync(), "Sync enabled");
                  setBusy(false);
                }}
              >
                Enable sync / reuse saved session
              </button>
            </>
          )}
          {status.enabled && (
            <div className="button-row">
              <button
                className="button"
                disabled={busy || status.phase === "syncing"}
                onClick={async () => {
                  setBusy(true);
                  await run(() => syncNow(), "Sync completed");
                  setBusy(false);
                }}
              >
                <RefreshCw size={17} />
                Sync now
              </button>
            </div>
          )}
          {(status.email || status.enabled) && (
            <button
              className="text-button"
              disabled={busy || status.phase === "syncing"}
              onClick={async () => {
                setBusy(true);
                await run(
                  () => signOut(),
                  "Signed out. Data stays on this device.",
                );
                setBusy(false);
                setConsent(false);
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          )}
          <p className="small muted">
            Sync must be enabled again after reopening the app. Deletions
            propagate while sync is enabled. A device-only reset signs out first
            and leaves remote data intact.
          </p>
        </>
      )}
    </section>
  );
}
