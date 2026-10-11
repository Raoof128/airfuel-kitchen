import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const phase = process.argv[2] || "before";
if (!["before", "after"].includes(phase))
  throw new Error("Use before or after.");
const baseURL = process.env.AIRFUEL_CAPTURE_URL || "http://127.0.0.1:4173";
const output = resolve(`docs/screenshots/upgrade-${phase}`);
const routes = [
  ["today", "/#/"],
  ["explore", "/#/explore"],
  ["recipe", "/#/recipe/air-fryer-chicken-fajitas"],
];
const records = [];
let browser;
try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch();
  for (const width of [375, 768, 1440]) {
    for (const theme of ["light", "dark"]) {
      // Disposable contexts preserve the user's existing browser and local data.
      const context = await browser.newContext({
        viewport: { width, height: width === 1440 ? 1000 : 900 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        for (const [name, route] of routes) {
          await page.goto(`${baseURL}${route}`);
          await page.locator("main h1").waitFor({ state: "visible" });
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(async () => {
            const images = [...document.images];
            for (const img of images) img.loading = "eager";
            await Promise.all(
              images.map((img) => img.decode().catch(() => {})),
            );
          });
          const file = `${width}-${theme}-${name}.png`;
          await page.screenshot({
            path: resolve(output, file),
            fullPage: true,
          });
          records.push({
            file,
            width,
            theme,
            route,
            ...(await page.evaluate(() => ({
              title: document.querySelector("main h1")?.textContent,
              documentWidth: document.documentElement.scrollWidth,
              pageHeight: document.documentElement.scrollHeight,
              theme: document.documentElement.dataset.theme,
            }))),
          });
        }
      } finally {
        await context.close();
      }
    }
  }
  await writeFile(
    resolve(output, "capture.json"),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        baseURL,
        phase,
        records,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Captured ${records.length} ${phase} screenshots in ${output}`);
} catch (error) {
  console.error("Upgrade screenshot capture failed:", error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
