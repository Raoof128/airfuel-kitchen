const draftPrefix = "airfuel-note-draft:";
const resetKey = "airfuel-note-draft-reset";
const seenResetKey = "airfuel-note-draft-reset-seen";
const listeners = new Set<() => void>();
const seenMessages = new Set<string>();
let channel: BroadcastChannel | undefined;
let listeningForStorage = false;

interface DraftReset {
  type: "clear-note-drafts";
  version: 1;
  id: string;
}

function isReset(value: unknown): value is DraftReset {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<DraftReset>;
  return (
    message.type === "clear-note-drafts" &&
    message.version === 1 &&
    typeof message.id === "string" &&
    message.id.length > 0 &&
    message.id.length <= 100
  );
}

function parseReset(value: string | null): DraftReset | undefined {
  if (!value || value.length > 500) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isReset(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function clearLocalDrafts(resetId?: string): boolean {
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(draftPrefix)) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
    if (resetId) sessionStorage.setItem(seenResetKey, resetId);
    return true;
  } catch {
    return false;
  }
}

function receiveReset(message: DraftReset): boolean {
  if (seenMessages.has(message.id)) return true;
  seenMessages.add(message.id);
  if (seenMessages.size > 64)
    seenMessages.delete(seenMessages.values().next().value!);
  const cleared = clearLocalDrafts(message.id);
  for (const callback of listeners) callback();
  return cleared;
}

function syncResetMarker() {
  try {
    const reset = parseReset(localStorage.getItem(resetKey));
    // A suspended tab can miss broadcasts. The shared marker prevents its old
    // sessionStorage notes from returning when that tab next opens a recipe.
    if (reset && sessionStorage.getItem(seenResetKey) !== reset.id)
      clearLocalDrafts(reset.id);
  } catch {
    // Drafts remain optional when a browser does not provide local storage.
  }
}

export function readRecipeNoteDraft(
  recipeId: string | undefined,
): string | null {
  if (!recipeId) return null;
  syncResetMarker();
  try {
    const value = sessionStorage.getItem(`${draftPrefix}${recipeId}`);
    return value !== null && value.length <= 10000 ? value : null;
  } catch {
    return null;
  }
}

export function writeRecipeNoteDraft(recipeId: string, note: string): boolean {
  if (!recipeId || note.length > 10000) return false;
  syncResetMarker();
  try {
    sessionStorage.setItem(`${draftPrefix}${recipeId}`, note);
    return true;
  } catch {
    return false;
  }
}

export function removeRecipeNoteDraft(recipeId: string): boolean {
  try {
    sessionStorage.removeItem(`${draftPrefix}${recipeId}`);
    return true;
  } catch {
    return false;
  }
}

export function clearRecipeNoteDrafts({
  broadcast = true,
}: { broadcast?: boolean } = {}): boolean {
  const message: DraftReset = {
    type: "clear-note-drafts",
    version: 1,
    id: crypto.randomUUID(),
  };
  const cleared = receiveReset(message);
  if (!broadcast) return cleared;
  try {
    // This marker contains no note content and also reaches tabs without a
    // BroadcastChannel. Duplicate deliveries are ignored by message ID.
    localStorage.setItem(resetKey, JSON.stringify(message));
  } catch {
    // BroadcastChannel still reaches currently open tabs if storage is blocked.
  }
  let temporary: BroadcastChannel | undefined;
  try {
    const sender =
      channel ?? (temporary = new BroadcastChannel("airfuel-note-drafts"));
    sender.postMessage(message);
  } catch {
    // Local clearing and the storage marker do not depend on this optional API.
  } finally {
    temporary?.close();
  }
  return cleared;
}

function onStorage(event: StorageEvent) {
  if (event.key !== resetKey) return;
  const message = parseReset(event.newValue);
  if (message) receiveReset(message);
}

export function subscribeToDraftReset(callback: () => void): () => void {
  syncResetMarker();
  listeners.add(callback);
  if (!channel) {
    try {
      channel = new BroadcastChannel("airfuel-note-drafts");
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (isReset(event.data)) receiveReset(event.data);
      };
    } catch {
      // The storage event remains available as a fallback.
    }
  }
  if (!listeningForStorage && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    listeningForStorage = true;
  }
  return () => {
    listeners.delete(callback);
    if (listeners.size > 0) return;
    channel?.close();
    channel = undefined;
    if (listeningForStorage) {
      window.removeEventListener("storage", onStorage);
      listeningForStorage = false;
    }
  };
}
