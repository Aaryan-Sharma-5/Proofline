/**
 * Screenshot pass for surfaces the capture suite does not drive: the idle
 * workspace, history, the landing page, and mobile widths. Purely observational
 * — it triggers no verification and therefore spends nothing.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { chromium } from "playwright";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";
const OUT = resolve("../screenshots");
mkdirSync(OUT, { recursive: true });

const SHOTS: { name: string; path: string; width: number; height: number }[] = [
  { name: "ux-app-idle", path: "/app", width: 1280, height: 1000 },
  { name: "ux-app-idle-1000", path: "/app", width: 1000, height: 1000 },
  { name: "ux-history", path: "/history", width: 1280, height: 1000 },
  { name: "ux-landing", path: "/", width: 1280, height: 1000 },
  { name: "ux-app-mobile", path: "/app", width: 375, height: 800 },
  { name: "ux-history-mobile", path: "/history", width: 375, height: 800 },
];

const browser = await chromium.launch();

for (const shot of SHOTS) {
  const page = await browser.newPage({
    viewport: { width: shot.width, height: shot.height },
  });
  await page.goto(`${GATEWAY}${shot.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  // Horizontal overflow is a layout defect, so measure it rather than eyeball it.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await page.screenshot({ path: resolve(OUT, `${shot.name}.png`), fullPage: true });
  console.log(
    `${shot.name.padEnd(22)} ${String(shot.width).padStart(5)}px  h-overflow=${overflow}px`,
  );
  await page.close();
}

await browser.close();
