import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  exploreReturnLocation,
  forgetExploreLocation,
  rememberExplore,
} from "../../src/lib/navigation";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

describe("explore location memory", () => {
  beforeEach(() => vi.stubGlobal("sessionStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("forgets the remembered search when personal data is deleted (SEC-11)", () => {
    rememberExplore("#/explore?q=peanut");
    expect(exploreReturnLocation()).toBe("#/explore?q=peanut");
    forgetExploreLocation();
    expect(exploreReturnLocation()).toBe("#/explore");
    expect(sessionStorage.getItem("airfuel-explore-location")).toBeNull();
  });

  it("never remembers a location outside the catalogue", () => {
    rememberExplore("#/settings");
    rememberExplore("javascript:alert(1)");
    expect(exploreReturnLocation()).toBe("#/explore");
  });

  it("stays usable when session storage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => forgetExploreLocation()).not.toThrow();
    expect(exploreReturnLocation()).toBe("#/explore");
  });
});
