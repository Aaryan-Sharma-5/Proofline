/**
 * Screenshot pass for surfaces the capture suite does not drive: the idle
 * workspace, history, the landing page, history detail, and mobile widths.
 * Observational only — it triggers no verification and spends nothing.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { chromium, type Page } from "playwright";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const OUT = resolve("../screenshots");
mkdirSync(OUT, { recursive: true });

const WIDTHS = [375, 390, 768, 1000, 1280];

const SHOTS: { name: string; path: string; width: number; height: number }[] = [
  { name: "ux-app-idle", path: "/app", width: 1280, height: 1000 },
  { name: "ux-app-idle-1000", path: "/app", width: 1000, height: 1000 },
  { name: "ux-history", path: "/history", width: 1280, height: 1000 },
  { name: "ux-landing", path: "/", width: 1280, height: 1000 },
  { name: "ux-app-mobile", path: "/app", width: 375, height: 800 },
  { name: "ux-history-mobile", path: "/history", width: 375, height: 800 },
];

async function overflowOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
  });
  await page.goto(`${GATEWAY}${shot.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const overflow = await overflowOf(page);
  await page.screenshot({ path: resolve(OUT, `${shot.name}.png`), fullPage: true });
  console.log(
    `${shot.name.padEnd(22)} ${String(shot.width).padStart(5)}px  h-overflow=${overflow}px`,
  );
  await page.close();
}

// History detail: open the newest row and capture the verification artifact.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${GATEWAY}/history`, { waitUntil: "networkidle" });
  await page.waitForSelector("tbody tr", { timeout: 15000 });
  await page.click("tbody tr:first-child");
  await page.waitForSelector("#detail", { timeout: 15000 });
  await page.waitForTimeout(500);
  console.log(`ux-history-detail      1280px  h-overflow=${await overflowOf(page)}px`);
  await page.screenshot({
    path: resolve(OUT, "ux-history-detail.png"),
    fullPage: true,
  });
  await page.close();
}

{
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await page.goto(`${GATEWAY}/history`, { waitUntil: "networkidle" });
  // Below sm the table is hidden and the list is the real control.
  await page.waitForSelector("ul li button", { timeout: 15000 });
  await page.click("ul li button");
  await page.waitForSelector("#detail", { timeout: 15000 });
  await page.waitForTimeout(500);
  console.log(`ux-history-detail-mob   375px  h-overflow=${await overflowOf(page)}px`);
  await page.screenshot({
    path: resolve(OUT, "ux-history-detail-mobile.png"),
    fullPage: true,
  });
  await page.close();
}

// Overflow sweep across every required breakpoint, on every route.
console.log("\noverflow sweep:");
for (const path of ["/", "/app", "/history"]) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${GATEWAY}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const overflow = await overflowOf(page);
    console.log(
      `  ${path.padEnd(9)} ${String(width).padStart(5)}px  ${overflow === 0 ? "ok" : `OVERFLOW ${overflow}px`}`,
    );
    await page.close();
  }
}

await browser.close();
