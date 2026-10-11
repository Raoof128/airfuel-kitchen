// Route × viewport × theme screenshot sweep with console/network error capture.
// Usage: node scripts/frontend-audit/capture.mjs <outDir> [baseURL] [routeFilter]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.argv[2] || "docs/frontend/screenshots/final";
const base = process.argv[3] || "http://127.0.0.1:5180";
const filter = process.argv[4];
const routes = [
  ["dashboard", "/"], ["explore", "/explore"], ["favourites", "/favourites"],
  ["recipe", "/recipe/air-fryer-chicken-thighs"], ["cook", "/cook/air-fryer-chicken-thighs"],
  ["planner", "/planner"], ["shopping", "/shopping"], ["pantry", "/pantry"],
  ["journal", "/journal"], ["settings", "/settings"], ["help", "/help"],
  ["custom", "/custom"], ["notfound", "/does-not-exist"],
].filter(([n]) => !filter || filter.split(",").includes(n));
const viewports = [["320", 320, 640], ["375", 375, 812], ["430", 430, 932], ["768", 768, 1024], ["1024", 1024, 768], ["1440", 1440, 900], ["1920", 1920, 1080]];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const theme of ["light", "dark"]) {
  for (const [vn, w, h] of viewports) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    for (const [name, path] of routes) {
      const errors = [];
      page.removeAllListeners("console"); page.removeAllListeners("pageerror"); page.removeAllListeners("requestfailed");
      page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`${m.type()}: ${m.text().slice(0, 200)}`));
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
      page.on("requestfailed", (r) => errors.push(`requestfailed: ${r.url()}`));
      await page.goto(`${base}/#${path}`);
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.screenshot({ path: `${out}/${name}-${vn}-${theme}.png`, fullPage: true });
      report.push({ name, vp: vn, theme, overflow, errors });
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.overflow > 0 || r.errors.length);
console.log(`${report.length} captures, ${bad.length} with overflow/errors`);
for (const b of bad) console.log(b.name, b.vp, b.theme, "overflow=" + b.overflow, b.errors.join(" | "));
