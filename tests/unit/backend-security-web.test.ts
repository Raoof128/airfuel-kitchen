// Web-surface guards: CSP hash drift, dangerous DOM sinks, link hygiene, logging and
// search cost. These are regression guards: they pass today and fail when a risky pattern
// is introduced. Findings: docs/backend/findings/security.md (SEC-*).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { filterRecipes } from "../../src/lib/engine";
import type { Recipe } from "../../src/lib/schema";
import savoury from "../../src/data/recipes-savoury.json";
import plant from "../../src/data/recipes-plant.json";

const root = new URL("../../", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(root, path), "utf8");
function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(root, dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(relative(root, path));
    return /\.(ts|tsx)$/.test(name) ? [relative(root, path)] : [];
  });
}

describe("CSP: inline script hash", () => {
  // Hash of the only inline script in index.html (the pre-paint theme script). A strict CSP
  // needs script-src 'self' 'sha256-…'. If this hash changes, update the CSP in the same change.
  const expected = "sha256-SWBdsqYEHBmK389/G9qy3RcvA1Yrg+dbSyD6dt+AbKs=";
  it("matches the inline theme script exactly and is the only inline script", () => {
    const html = read("index.html");
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline).toHaveLength(1);
    const hash = `sha256-${createHash("sha256").update(inline[0]).digest("base64")}`;
    expect(hash).toBe(expected);
  });
  it("has no inline event-handler attributes in the HTML shell", () => {
    expect(read("index.html")).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe("DOM sinks", () => {
  const sinks = /dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\(|new Function\(/;
  it("uses no HTML-injection sink anywhere in src", () => {
    const hits = sourceFiles("src").filter((file) => sinks.test(read(file)));
    expect(hits).toEqual([]);
  });
  it("has no markdown or HTML renderer dependency", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((n) => /markdown|marked|dompurify|sanitize|rehype|remark/i.test(n))).toEqual([]);
  });
});

describe("outbound links", () => {
  it("gives every target=_blank anchor rel=noopener or noreferrer", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      const text = read(file);
      for (const match of text.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g))
        if (!/rel="[^"]*(noopener|noreferrer)/.test(match[0])) offenders.push(`${file}: ${match[0].slice(0, 80)}`);
    }
    expect(offenders).toEqual([]);
  });
  it("uses only https for recipe source links (enforced by recipeSchema)", async () => {
    const { recipeSchema } = await import("../../src/lib/schema");
    const base = (savoury as Recipe[])[0];
    for (const url of ["javascript:alert(1)", "http://a.example", "ftp://a.example/x"])
      expect(
        recipeSchema.safeParse({ ...base, sources: [{ title: "t", url, verifiedAt: "2026-01-01" }] }).success,
      ).toBe(false);
  });
});

describe("logging and storage hygiene", () => {
  it("writes nothing to the console from src", () => {
    const hits = sourceFiles("src").filter((file) => /\bconsole\.(log|info|warn|error|debug|table|dir)\(/.test(read(file)));
    expect(hits).toEqual([]);
  });
  it("uses no third-party script, analytics or remote font in index.html", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/<script[^>]+src="https?:/i);
    expect(html).not.toMatch(/<link[^>]+href="https?:/i);
  });
});

describe("search cost stays bounded for a hostile query", () => {
  // A 64 KB query from a crafted #/explore?q= link. Measured at about 1 s on the dev machine
  // (SEC-5); the bound is generous so the test guards against a regression to quadratic work
  // rather than measuring machine speed.
  const catalogue = [...(savoury as Recipe[]), ...(plant as Recipe[])];
  it("finishes a 64 KB query within 5 s", () => {
    const query = "chicken ".repeat(8000);
    const started = performance.now();
    filterRecipes(catalogue, { query }, []);
    expect(performance.now() - started).toBeLessThan(5000);
  });
  it("treats an empty-token query as no filter", () => {
    expect(filterRecipes(catalogue, { query: "   " }, []).length).toBe(catalogue.length);
  });
});
