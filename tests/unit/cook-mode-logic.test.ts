import { describe, expect, it } from "vitest";
import {
  cookingTimerTransition,
  remainingTimerSeconds,
} from "../../src/components/CookingTimer";

describe("cooking timer deadlines", () => {
  it("computes remaining seconds from wall time after backgrounding or reload", () => {
    const started = cookingTimerTransition(
      { timerEndsAt: null, timerRemainingSeconds: 0 },
      "start",
      10,
      1_000_000,
    );
    expect(started.timerEndsAt).toBe(1_600_000);
    expect(remainingTimerSeconds(started, 1_359_500)).toBe(241);
    expect(remainingTimerSeconds(started, 1_900_000)).toBe(0);
    expect(started.timerEndsAt).toBe(1_600_000);
  });

  it("pauses at action time and resumes the saved remainder", () => {
    const active = { timerEndsAt: 1_600_000, timerRemainingSeconds: 0 };
    const paused = cookingTimerTransition(active, "pause", 10, 1_363_100);
    expect(paused).toEqual({ timerEndsAt: null, timerRemainingSeconds: 237 });
    expect(remainingTimerSeconds(paused, 5_000_000)).toBe(237);
    expect(cookingTimerTransition(paused, "start", 10, 5_000_000)).toEqual({
      timerEndsAt: 5_237_000,
      timerRemainingSeconds: 0,
    });
  });

  it("resets completely and restarts expired timers with the chosen duration", () => {
    const expired = { timerEndsAt: 1_000, timerRemainingSeconds: 0 };
    expect(cookingTimerTransition(expired, "reset", 3, 2_000)).toEqual({
      timerEndsAt: null,
      timerRemainingSeconds: 0,
    });
    expect(cookingTimerTransition(expired, "start", 3, 2_000)).toEqual({
      timerEndsAt: 182_000,
      timerRemainingSeconds: 0,
    });
  });

  it("rejects invalid timer durations instead of persisting invalid deadlines", () => {
    for (const minutes of [0, -1, 241, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        cookingTimerTransition(
          { timerEndsAt: null, timerRemainingSeconds: 0 },
          "start",
          minutes,
          1_000,
        ),
      ).toThrow("1 to 240");
    }
  });
});
