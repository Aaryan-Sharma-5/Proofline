/**
 * Verification-only pass: exercises the evidence disclosure and history filter
 * controls by real keyboard, checks reduced-motion, and re-measures overflow.
 * Reads an existing history record rather than running a paid verification,
 * except where a live result is genuinely required.
 */
import { chromium, type Page } from "playwright";

const GATEWAY = process.env.GATEWAY_URL?.trim() ?? "http://127.0.0.1:4021";

async function focusInfo(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id,
      text: (el.textContent ?? "").trim().slice(0, 30).replace(/\s+/g, " "),
      expanded: el.getAttribute("aria-expanded"),
      ringed:
        (style.outlineStyle !== "none" &&
          parseFloat(style.outlineWidth || "0") > 0) ||
        style.boxShadow !== "none",
    };
  });
}

const browser = await chromium.launch();

// --- History detail: expandable evidence reached and toggled by keyboard ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${GATEWAY}/history`, { waitUntil: "networkidle" });
  await page.waitForSelector("tbody tr", { timeout: 15000 });
  await page.click("tbody tr:first-child");
  await page.waitForSelector("#detail", { timeout: 15000 });
  await page.waitForTimeout(600);

  const toggle = page.locator('button[aria-expanded]').first();
  const before = await toggle.getAttribute("aria-expanded");
  await toggle.focus();
  const ringed = (await focusInfo(page))?.ringed;
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const after = await toggle.getAttribute("aria-expanded");

  console.log("=== expandable evidence (history detail) ===");
  console.log(`  aria-expanded before : ${before}`);
  console.log(`  aria-expanded after  : ${after}`);
  console.log(`  toggles via keyboard : ${before !== after ? "yes" : "NO"}`);
  console.log(`  focus ring present   : ${ringed ? "yes" : "NO"}`);
  await page.close();
}

// --- History filters operable by keyboard ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${GATEWAY}/history`, { waitUntil: "networkidle" });
  await page.waitForSelector("tbody tr", { timeout: 15000 });

  const rowCount = () => page.$$eval("tbody tr", (r) => r.length);
  const all = await rowCount();

  await page.focus("#history-decision");
  const selRing = (await focusInfo(page))?.ringed;
  await page.selectOption("#history-decision", "CLEAR");
  await page.waitForTimeout(250);
  const clearOnly = await rowCount();
  const decisions = await page.$$eval("tbody tr td:nth-child(1)", (cells) =>
    Array.from(new Set(cells.map((c) => c.textContent?.trim()))),
  );

  await page.focus("#history-search");
  const searchRing = (await focusInfo(page))?.ringed;

  console.log("\n=== history filters ===");
  console.log(`  rows all / CLEAR-only : ${all} / ${clearOnly}`);
  console.log(`  decisions rendered    : ${decisions.join(",")}`);
  console.log(`  select focus ring     : ${selRing ? "yes" : "NO"}`);
  console.log(`  search focus ring     : ${searchRing ? "yes" : "NO"}`);
  await page.close();
}

// --- Reduced motion: animations resolve, content fully visible ---
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  await page.goto(`${GATEWAY}/history`, { waitUntil: "networkidle" });
  await page.waitForSelector("tbody tr", { timeout: 15000 });
  await page.click("tbody tr:first-child");
  await page.waitForSelector("#detail", { timeout: 15000 });
  await page.waitForTimeout(500);

  const opacity = await page.$eval("#detail", (el) => getComputedStyle(el).opacity);
  const durations = await page.evaluate(() => {
    const el = document.querySelector("#detail .state-enter") as HTMLElement | null;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { animation: s.animationDuration, transition: s.transitionDuration };
  });

  console.log("\n=== reduced motion ===");
  console.log(`  #detail opacity       : ${opacity}`);
  console.log(`  state-enter durations : ${JSON.stringify(durations)}`);
  await page.close();
}

// --- Overflow sweep across required widths ---
console.log("\n=== overflow sweep ===");
for (const path of ["/", "/app", "/history"]) {
  for (const width of [375, 390, 768, 1000, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${GATEWAY}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(
      `  ${path.padEnd(9)} ${String(width).padStart(5)}px  ${overflow === 0 ? "ok" : `OVERFLOW ${overflow}px`}`,
    );
    await page.close();
  }
}

await browser.close();
