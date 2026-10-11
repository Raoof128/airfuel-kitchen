// Presentational helpers behind the cloud sync panel: state labels, counts copy, conflict titles and
// readable conflict summaries. Pure functions only; no rendering and no network.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  conflictExplanation,
  conflictLines,
  conflictTitle,
  changedPreferenceFields,
  ENTITY_LABELS,
  excerpt,
  rejectedExplanation,
  SYNC_RULE_COPY,
  SYNC_STATE_LABELS,
  syncStateLabel,
} from "../../src/components/CloudSettings";
import {
  syncDisplayState,
  type CloudStatus,
  type ConflictRecord,
  type Entity,
  type SyncDisplayState,
} from "../../src/cloud/index";

const base: CloudStatus = {
  phase: "ready",
  email: "owner@example.com",
  enabled: true,
  pending: 0,
  rejected: 0,
  conflicts: 0,
  lastSyncedAt: 1,
  message: "Synced with your configured project.",
};

function conflict(
  entity: Entity,
  recordId: string,
  local: unknown,
  remote: unknown,
): ConflictRecord {
  return {
    key: JSON.stringify([entity, recordId, "op", "fp"]),
    entity,
    recordId,
    local,
    remote,
    remoteRevision: 3,
    remoteOperationId: "00000000-0000-4000-8000-000000000001",
    createdAt: 1,
  };
}

const ALL_STATES: SyncDisplayState[] = [
  "saved-locally",
  "waiting",
  "syncing",
  "synced",
  "failed",
  "conflict",
];

describe("sync state labels", () => {
  it("has a human label for every display state", () => {
    for (const state of ALL_STATES) {
      expect(syncStateLabel(state)).toBe(SYNC_STATE_LABELS[state]);
      expect(SYNC_STATE_LABELS[state].length).toBeGreaterThan(0);
    }
  });

  it("only says Synced when the sync API reports synced", () => {
    const samples: CloudStatus[] = [
      base,
      { ...base, enabled: false },
      { ...base, phase: "offline" },
      { ...base, phase: "syncing" },
      { ...base, pending: 2 },
      { ...base, rejected: 1, phase: "ready" },
      { ...base, phase: "error", enabled: false },
      { ...base, conflicts: 1 },
    ];
    for (const sample of samples) {
      const state = syncDisplayState(sample);
      const label = syncStateLabel(state);
      expect(label === "Synced").toBe(state === "synced");
    }
  });

  it("never reports synced while items are rejected or in conflict", () => {
    expect(syncDisplayState({ ...base, rejected: 1 })).toBe("failed");
    expect(syncStateLabel(syncDisplayState({ ...base, rejected: 1 }))).toBe(
      "Needs attention",
    );
    expect(syncStateLabel(syncDisplayState({ ...base, conflicts: 2 }))).toBe(
      "Conflict: choose a version",
    );
  });

  it("keeps the local-only wording when sync is off", () => {
    expect(
      syncStateLabel(
        syncDisplayState({ ...base, enabled: false, phase: "signed-out" }),
      ),
    ).toBe("Saved on this device");
  });
});

describe("counts copy", () => {
  it("uses singular and plural forms", () => {
    expect(rejectedExplanation(1)).toMatch(/^1 item could not be synced/);
    expect(rejectedExplanation(3)).toMatch(/^3 items could not be synced/);
    expect(conflictExplanation(1)).toMatch(/^1 item changed on two devices/);
    expect(conflictExplanation(2)).toMatch(/^2 items changed on two devices/);
  });

  it("explains that rejected copies stay on the device", () => {
    expect(rejectedExplanation(1)).toMatch(/stay on this device/);
  });
});

describe("conflict rule copy", () => {
  it("describes whole-record ordering, not the old 'supersede' wording", () => {
    expect(SYNC_RULE_COPY).not.toMatch(/supersede/i);
    expect(SYNC_RULE_COPY).toMatch(/whole version/);
    expect(SYNC_RULE_COPY).toMatch(/not merged field by field/);
    expect(SYNC_RULE_COPY).toMatch(/Deletions are kept/);
  });
});

describe("excerpt", () => {
  it("returns short text trimmed and unchanged", () => {
    expect(excerpt("  Less salt  ")).toBe("Less salt");
  });

  it("cuts long text with an ellipsis within the limit", () => {
    const long = "word ".repeat(100);
    const cut = excerpt(long, 50);
    expect(cut.length).toBeLessThanOrEqual(50);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("conflict titles", () => {
  const recipes = [{ id: "lentil-dal", title: "Lentil dal" }];

  it("resolves a recipe record title from the app's recipe list", () => {
    const title = conflictTitle(
      conflict(
        "recipeStates",
        "lentil-dal",
        { id: "lentil-dal" },
        { id: "lentil-dal" },
      ),
      recipes,
    );
    expect(title).toBe("Recipe rating and notes: Lentil dal");
  });

  it("falls back to the payload title, then the record id, for an unknown recipe", () => {
    const fromPayload = conflictTitle(
      conflict("overrides", "custom-soup", { recipe: { title: "Soup" } }, null),
      [],
    );
    expect(fromPayload).toBe("Recipe edits: Soup");
    const fromId = conflictTitle(
      conflict("recipeStates", "gone-recipe", {}, {}),
      [],
    );
    expect(fromId).toBe("Recipe rating and notes: gone-recipe");
  });

  it("resolves the recipe for a session through its recipeId", () => {
    const title = conflictTitle(
      conflict(
        "sessions",
        "s1",
        { recipeId: "lentil-dal", date: "2026-10-01" },
        null,
      ),
      recipes,
    );
    expect(title).toBe("Cooking log entry: Lentil dal");
  });

  it("names pantry and shopping items and labels preferences plainly", () => {
    expect(
      conflictTitle(conflict("pantry", "p1", { name: "Flour" }, null), []),
    ).toBe("Pantry item: Flour");
    expect(
      conflictTitle(conflict("preferences", "preferences", {}, {}), []),
    ).toBe(ENTITY_LABELS.preferences);
  });
});

describe("readable conflict summaries", () => {
  it("shows the notes text for a rating and notes conflict, not JSON", () => {
    const record = conflict(
      "recipeStates",
      "lentil-dal",
      {
        id: "lentil-dal",
        rating: 4,
        notes: "Less chilli next time.",
        favourite: true,
      },
      { id: "lentil-dal", rating: null, notes: "" },
    );
    const local = conflictLines(record, "local");
    const remote = conflictLines(record, "remote");
    expect(local).toContain("Rating: 4 of 5");
    expect(local).toContain("Notes: Less chilli next time.");
    expect(local).toContain("Marked as a favourite");
    expect(remote).toContain("No rating");
    expect(remote).toContain("No notes");
    for (const line of [...local, ...remote]) expect(line).not.toMatch(/[{}"]/);
  });

  it("lists only the changed preference fields on each side", () => {
    const local = {
      id: "preferences",
      updatedAt: 10,
      name: "Raouf",
      maxMinutes: 25,
      preferredProteins: ["tofu"],
      oilFree: true,
    };
    const remote = {
      id: "preferences",
      updatedAt: 5,
      name: "Raouf",
      maxMinutes: 35,
      preferredProteins: [],
      oilFree: true,
    };
    const record = conflict("preferences", "preferences", local, remote);
    expect(conflictLines(record, "local")).toEqual([
      "Maximum minutes: 25",
      "Preferred proteins: tofu",
    ]);
    expect(conflictLines(record, "remote")).toEqual([
      "Maximum minutes: 35",
      "Preferred proteins: None",
    ]);
  });

  it("ignores the timestamp and id when comparing preferences", () => {
    const a = { id: "preferences", updatedAt: 1, name: "A" };
    const b = { id: "preferences", updatedAt: 2, name: "A" };
    expect(changedPreferenceFields(a, b)).toEqual([]);
  });

  it("describes a deleted side in words", () => {
    const record = conflict("pantry", "p1", null, {
      name: "Rice",
      quantity: 1,
      unit: "kg",
    });
    expect(conflictLines(record, "local")).toEqual(["Deleted on this device"]);
    expect(conflictLines(record, "remote")).toEqual(["Rice 1 kg"]);
    const removedRemote = conflict(
      "pantry",
      "p2",
      { name: "Oats", quantity: 2, unit: "kg" },
      null,
    );
    expect(conflictLines(removedRemote, "remote")).toEqual([
      "Deleted in the cloud",
    ]);
  });

  it("summarises a plan entry without showing its raw fields", () => {
    const record = conflict(
      "plans",
      "plan-1",
      {
        recipeId: "lentil-dal",
        date: "2026-10-12",
        slot: "dinner",
        servings: 2,
      },
      null,
    );
    expect(conflictLines(record, "local")).toEqual([
      "2026-10-12 · dinner · 2 servings",
    ]);
  });

  it("truncates long notes in a conflict", () => {
    const record = conflict(
      "sessions",
      "s1",
      { recipeId: "x", date: "2026-10-01", notes: "a".repeat(600) },
      null,
    );
    const notesLine = conflictLines(record, "local").find((line) =>
      line.startsWith("Notes:"),
    );
    expect(notesLine).toBeDefined();
    expect(notesLine!.length).toBeLessThan(260);
  });
});
