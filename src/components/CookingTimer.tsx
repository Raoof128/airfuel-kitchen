import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Timer } from "lucide-react";
import { useApp } from "./context";
import { actions } from "../lib";
import type { ActiveCooking, Recipe } from "../lib/schema";
import "../styles/cook-mode.css";

type TimerPatch = Pick<ActiveCooking, "timerEndsAt" | "timerRemainingSeconds">;

export function remainingTimerSeconds(
  active:
    Pick<ActiveCooking, "timerEndsAt" | "timerRemainingSeconds"> | undefined,
  now: number,
) {
  return active?.timerEndsAt !== null && active?.timerEndsAt !== undefined
    ? Math.max(0, Math.ceil((active.timerEndsAt - now) / 1000))
    : Math.max(0, Math.ceil(active?.timerRemainingSeconds ?? 0));
}

export function cookingTimerTransition(
  active: Pick<ActiveCooking, "timerEndsAt" | "timerRemainingSeconds">,
  command: "start" | "pause" | "reset",
  minutes: number,
  now: number,
): TimerPatch {
  if (command === "reset")
    return { timerEndsAt: null, timerRemainingSeconds: 0 };
  if (command === "pause")
    return {
      timerEndsAt: null,
      timerRemainingSeconds: remainingTimerSeconds(active, now),
    };
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240)
    throw new Error("Choose a timer duration from 1 to 240 minutes.");
  // A paused duration resumes; a completed timer starts a fresh duration.
  const seconds =
    active.timerEndsAt === null && active.timerRemainingSeconds > 0
      ? active.timerRemainingSeconds
      : Math.ceil(minutes * 60);
  return { timerEndsAt: now + seconds * 1000, timerRemainingSeconds: 0 };
}

export function CookingTimer({
  recipe,
  servings,
}: {
  recipe: Recipe;
  servings: number;
}) {
  const { data, run } = useApp();
  const active =
    data.activeCooking?.recipeId === recipe.id ? data.activeCooking : undefined;
  const [now, setNow] = useState(Date.now);
  const [duration, setDuration] = useState(
    String(Math.max(1, Math.min(240, Math.ceil(recipe.cookMinutes)))),
  );
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const minutes = Number(duration);
  const validDuration = duration !== "" && minutes >= 1 && minutes <= 240;
  const remaining = remainingTimerSeconds(active, now);
  const running = Boolean(active?.timerEndsAt && remaining > 0);
  const paused = !active?.timerEndsAt && remaining > 0;
  const finished = Boolean(active?.timerEndsAt && remaining === 0);
  const shownSeconds =
    running || paused || finished
      ? remaining
      : validDuration
        ? minutes * 60
        : 0;

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    refresh();
    // Absolute deadlines survive sleeping tabs and reloads; ticks only redraw.
    const interval = active?.timerEndsAt
      ? window.setInterval(refresh, 1000)
      : null;
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      if (interval !== null) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [active?.timerEndsAt]);

  async function changeTimer(command: "start" | "pause" | "reset") {
    if (!active || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      await run(() =>
        actions.patchActiveCooking(
          recipe.id,
          cookingTimerTransition(active, command, minutes, Date.now()),
          servings,
          recipe.id,
        ),
      );
      setNow(Date.now());
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section
      className={`cook-timer ${finished ? "cook-timer-finished" : ""}`}
      aria-label="Cooking timer"
    >
      <div className="cook-timer-heading">
        <span className="cook-eyebrow">
          <Timer size={17} /> Kitchen timer
        </span>
        <span className="cook-timer-state">
          {running
            ? "Running"
            : paused
              ? "Paused"
              : finished
                ? "Time’s up"
                : "Ready when you are"}
        </span>
      </div>
      <div className="cook-timer-body">
        <output
          className="cook-timer-display"
          aria-label="Time remaining"
          aria-live="off"
        >
          {Math.floor(shownSeconds / 60)
            .toString()
            .padStart(2, "0")}
          <span>:</span>
          {Math.floor(shownSeconds % 60)
            .toString()
            .padStart(2, "0")}
        </output>
        <div className="cook-timer-actions">
          <button
            type="button"
            className="button primary"
            disabled={!active || (!running && !paused && !validDuration)}
            aria-disabled={busy || undefined}
            onClick={() => void changeTimer(running ? "pause" : "start")}
          >
            {running ? <Pause size={19} /> : <Play size={19} />}
            {running
              ? "Pause timer"
              : paused
                ? "Resume timer"
                : finished
                  ? "Start timer again"
                  : "Start timer"}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Reset timer"
            disabled={!active || (!remaining && !finished)}
            aria-disabled={busy || undefined}
            onClick={() => void changeTimer("reset")}
          >
            <RotateCcw size={19} />
          </button>
        </div>
      </div>
      <div className="cook-timer-duration">
        <label htmlFor="cooking-timer-minutes">Timer duration</label>
        <input
          id="cooking-timer-minutes"
          aria-describedby="cooking-timer-unit"
          inputMode="decimal"
          type="number"
          min="1"
          max="240"
          step="0.5"
          value={duration}
          disabled={busy || running || paused}
          onChange={(event) => setDuration(event.target.value)}
        />
        <span id="cooking-timer-unit">min</span>
      </div>
      <p className="cook-timer-status" role="status">
        {finished
          ? "Time to check your food. Use a food thermometer where required."
          : !active
            ? "Begin cooking to use the timer."
            : ""}
      </p>
      <p className="cook-timer-note">
        A reminder, never a food-safety check. No alarm sounds when the app is
        closed.
      </p>
    </section>
  );
}
